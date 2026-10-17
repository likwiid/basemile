// SPDX-License-Identifier: GPL-3.0-or-later

import { haversineMeters } from '@/lib/run/distance';
import type { CompletedRun, GpsPoint, RouteSummary } from '@/types';

const SIMPLIFY_TOLERANCE_M = 50;
const ROUTE_COLORS = ['#10b981', '#3b82f6', '#f97316', '#facc15', '#ef4444'];

/** A run point / track sample within this distance counts as on-route. */
const COVERAGE_RADIUS_M = 30;
/** Track resampling step when measuring how much of the route a run covered. */
const TRACK_SAMPLE_STEP_M = 25;
/** Same route: ≥90% of the run must lie on the track… */
const SAME_ROUTE_MIN_RUN_COVERAGE = 0.9;
/** …AND the run must cover ≥70% of the track's length. */
const SAME_ROUTE_MIN_TRACK_COVERAGE = 0.7;
/** Counted start-point passes must be at least this share of a lap apart. */
const LAP_GATE_FRACTION = 0.6;

interface RouteTrackPoint {
  latitude: number;
  longitude: number;
}

/**
 * Recompute a route's aggregate stats from the runs assigned to it. Pure.
 * Extracted from the run-save flow so route backfill can reuse it.
 * Multi-lap runs are normalized per lap so a double loop doesn't double the
 * route's representative distance/gain.
 */
export function routeWithRunStats(
  route: RouteSummary,
  runs: readonly CompletedRun[]
): RouteSummary {
  if (runs.length === 0) return route;
  const perLap = (value: number, run: CompletedRun): number =>
    value / Math.max(1, run.lap_count ?? 1);
  const totalDistance = runs.reduce((sum, run) => sum + perLap(run.distance_m, run), 0);
  // Average elevation gain only over runs that actually have elevation data
  // (DEM coverage > 0). Dividing by every run — including ones with no altitude
  // — understates it; null means "no elevation data" (rendered as such, not 0).
  const withElevation = runs.filter((run) => (run.elevation?.coverage_pct ?? 0) > 0);
  const avgElevationGain =
    withElevation.length > 0
      ? withElevation.reduce((sum, run) => sum + perLap(run.ascent_m ?? 0, run), 0) /
        withElevation.length
      : null;
  const firstRunDate = runs.reduce(
    (earliest, run) => Math.min(earliest, run.started_at),
    runs[0]?.started_at ?? route.first_run_date
  );
  return {
    ...route,
    total_distance_m: totalDistance / runs.length,
    avg_elevation_gain_m: avgElevationGain,
    first_run_date: firstRunDate,
    run_count: runs.length,
  };
}

export interface TwoWayCoverage {
  /** Share (0..1) of run points within COVERAGE_RADIUS_M of the route track. */
  a: number;
  /** Share (0..1) of the route track's length covered by the run. */
  b: number;
}

/**
 * Two-way coverage between a run and a route track. `a` answers "did the run
 * stay on the route?"; `b` answers "did the run cover the whole route?".
 * A high with B low = the run is a partial traversal (sub-route variant).
 */
export function twoWayCoverage(
  points: readonly GpsPoint[],
  track: readonly RouteTrackPoint[]
): TwoWayCoverage {
  if (points.length === 0 || track.length < 2) return { a: 0, b: 0 };

  let nearRun = 0;
  for (const point of points) {
    if (minDistanceToTrack(point, track) <= COVERAGE_RADIUS_M) nearRun += 1;
  }

  const samples = resampleTrack(track, TRACK_SAMPLE_STEP_M);
  let covered = 0;
  for (const sample of samples) {
    for (const point of points) {
      if (pointDistanceMeters(sample, point) <= COVERAGE_RADIUS_M) {
        covered += 1;
        break;
      }
    }
  }

  return {
    a: nearRun / points.length,
    b: samples.length > 0 ? covered / samples.length : 0,
  };
}

/**
 * Number of route traversals in a run: passes within COVERAGE_RADIUS_M of the
 * track's START point, counted only when at least LAP_GATE_FRACTION of the
 * track length has been run since the previous counted pass. Simple and
 * deterministic; a matched run always reports at least 1.
 */
export function detectLapCount(
  points: readonly GpsPoint[],
  track: readonly RouteTrackPoint[]
): number {
  const start = track[0];
  if (!start || points.length === 0) return 1;
  const lapLength = trackLengthMeters(track);
  if (lapLength <= 0) return 1;

  let cumulative = 0;
  let passes = 0;
  let lastPassAt = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    if (!curr) continue;
    if (i > 0 && prev) cumulative += haversineMeters(prev, curr);
    if (
      pointDistanceMeters(curr, start) <= COVERAGE_RADIUS_M &&
      cumulative - lastPassAt >= LAP_GATE_FRACTION * lapLength
    ) {
      passes += 1;
      lastPassAt = cumulative;
    }
  }
  return Math.max(1, passes - 1);
}

export interface RouteMatchResult {
  route: RouteSummary;
  isNew: boolean;
  /** Route traversals detected in this run (≥ 1). */
  lapCount: number;
}

export function matchOrCreateRoute(args: {
  runId: string;
  runStartedAt: number;
  distanceM: number;
  ascentM: number;
  points: readonly GpsPoint[];
  existingRoutes: readonly RouteSummary[];
}): RouteMatchResult | null {
  const simplified = simplifyRoute(args.points, SIMPLIFY_TOLERANCE_M);
  if (simplified.length < 2) return null;

  // Two-way coverage against every known route (variants are routes too, so a
  // repeat of "Route 3 · short" matches the variant directly).
  let bestFull: { route: RouteSummary; track: RouteTrackPoint[]; cov: TwoWayCoverage } | null =
    null;
  let bestBase: { route: RouteSummary; cov: TwoWayCoverage } | null = null;
  for (const route of args.existingRoutes) {
    const track = parseRouteTrack(route);
    if (track.length < 2) continue;
    const cov = twoWayCoverage(args.points, track);
    if (cov.a < SAME_ROUTE_MIN_RUN_COVERAGE) continue;
    if (cov.b >= SAME_ROUTE_MIN_TRACK_COVERAGE) {
      if (!bestFull || cov.a + cov.b > bestFull.cov.a + bestFull.cov.b) {
        bestFull = { route, track, cov };
      }
    } else if (!bestBase || cov.b > bestBase.cov.b) {
      // On the route but covering < 70% of it — a sub-route variant candidate.
      bestBase = { route, cov };
    }
  }

  if (bestFull) {
    return {
      route: bestFull.route,
      isNew: false,
      lapCount: detectLapCount(args.points, bestFull.track),
    };
  }

  const fingerprint = fingerprintFor(simplified);
  const ownTrack = toTrack(simplified);
  const count = args.existingRoutes.length + 1;

  if (bestBase) {
    // Auto-create a linked variant (e.g. "Route 3 · short"): its runs must not
    // pool into the base route's stats or "vs similar runs".
    const base = bestBase.route;
    const route: RouteSummary = {
      id: `route-${args.runId}-${hashString(fingerprint)}`,
      name: variantNameFor(base.name),
      fingerprint,
      total_distance_m: args.distanceM,
      avg_elevation_gain_m: args.ascentM,
      color: base.color,
      first_run_date: args.runStartedAt,
      run_count: 1,
      track_json: JSON.stringify(ownTrack),
      parent_route_id: base.parent_route_id ?? base.id,
    };
    return { route, isNew: true, lapCount: detectLapCount(args.points, ownTrack) };
  }

  const route: RouteSummary = {
    id: `route-${args.runId}-${hashString(fingerprint)}`,
    name: `Route ${count}`,
    fingerprint,
    total_distance_m: args.distanceM,
    avg_elevation_gain_m: args.ascentM,
    color: ROUTE_COLORS[(count - 1) % ROUTE_COLORS.length] ?? '#10b981',
    first_run_date: args.runStartedAt,
    run_count: 1,
    track_json: JSON.stringify(ownTrack),
  };
  return { route, isNew: true, lapCount: detectLapCount(args.points, ownTrack) };
}

/** "Route 3" → "Route 3 · short"; never stacks the suffix on nested variants. */
function variantNameFor(baseName: string): string {
  return `${baseName.replace(/ · short$/u, '')} · short`;
}

export function parseRouteTrack(route: RouteSummary): RouteTrackPoint[] {
  if (!route.track_json) return [];
  try {
    const parsed = JSON.parse(route.track_json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const point = item as Partial<RouteTrackPoint>;
        if (
          typeof point.latitude !== 'number' ||
          typeof point.longitude !== 'number' ||
          !Number.isFinite(point.latitude) ||
          !Number.isFinite(point.longitude)
        ) {
          return null;
        }
        return { latitude: point.latitude, longitude: point.longitude };
      })
      .filter((point): point is RouteTrackPoint => point !== null);
  } catch {
    return [];
  }
}

function minDistanceToTrack(point: GpsPoint, track: readonly RouteTrackPoint[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < track.length; i += 1) {
    const a = track[i - 1];
    const b = track[i];
    if (!a || !b) continue;
    const distance = distanceToSegmentMeters(point, a, b);
    if (distance < best) best = distance;
  }
  return best;
}

/** Total polyline length in metres. */
function trackLengthMeters(track: readonly RouteTrackPoint[]): number {
  let total = 0;
  for (let i = 1; i < track.length; i += 1) {
    const a = track[i - 1];
    const b = track[i];
    if (!a || !b) continue;
    total += pointDistanceMeters(a, b);
  }
  return total;
}

/**
 * Points every `stepM` metres along the track polyline (plus the start), so
 * coverage is measured by LENGTH — a sparse simplified track must not let two
 * far-apart vertices stand in for the whole stretch between them.
 */
function resampleTrack(
  track: readonly RouteTrackPoint[],
  stepM: number
): RouteTrackPoint[] {
  const first = track[0];
  if (!first || stepM <= 0) return [];
  const out: RouteTrackPoint[] = [{ latitude: first.latitude, longitude: first.longitude }];
  let sinceLast = 0;
  for (let i = 1; i < track.length; i += 1) {
    const a = track[i - 1];
    const b = track[i];
    if (!a || !b) continue;
    const seg = pointDistanceMeters(a, b);
    if (seg <= 0) continue;
    let pos = 0;
    while (sinceLast + (seg - pos) >= stepM) {
      const need = stepM - sinceLast;
      const t = (pos + need) / seg;
      out.push({
        latitude: a.latitude + t * (b.latitude - a.latitude),
        longitude: a.longitude + t * (b.longitude - a.longitude),
      });
      pos += need;
      sinceLast = 0;
    }
    sinceLast += seg - pos;
  }
  return out;
}

function simplifyRoute(points: readonly GpsPoint[], toleranceM: number): GpsPoint[] {
  if (points.length <= 2) return [...points];
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return [...points];

  let maxDistance = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const point = points[i];
    if (!point) continue;
    const distance = distanceToSegmentMeters(point, first, last);
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }

  if (maxDistance > toleranceM) {
    const left = simplifyRoute(points.slice(0, index + 1), toleranceM);
    const right = simplifyRoute(points.slice(index), toleranceM);
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
}

function fingerprintFor(points: readonly GpsPoint[]): string {
  return points
    .map((point) => `${bucket(point.latitude)},${bucket(point.longitude)}`)
    .join('|');
}

function toTrack(points: readonly GpsPoint[]): RouteTrackPoint[] {
  return points.map((point) => ({
    latitude: point.latitude,
    longitude: point.longitude,
  }));
}

function bucket(value: number): number {
  return Math.round(value * 1000);
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function distanceToSegmentMeters(
  point: Pick<GpsPoint, 'latitude' | 'longitude'>,
  a: RouteTrackPoint,
  b: RouteTrackPoint
): number {
  // Project in a locally metric space: 1° of longitude is cos(lat) shorter
  // than 1° of latitude, so raw-degree projection picked a suboptimal point on
  // diagonal segments and over-reported distance (+25% at lat 60°, +8% at 48°).
  const cosLat = Math.cos((a.latitude * Math.PI) / 180);
  const ax = a.longitude * cosLat;
  const ay = a.latitude;
  const bx = b.longitude * cosLat;
  const by = b.latitude;
  const px = point.longitude * cosLat;
  const py = point.latitude;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return haversineMeters(
      { timestamp: 0, latitude: point.latitude, longitude: point.longitude },
      { timestamp: 0, latitude: a.latitude, longitude: a.longitude }
    );
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  // Interpolate back in raw degrees with the metric-space t.
  const projected = {
    timestamp: 0,
    latitude: a.latitude + t * (b.latitude - a.latitude),
    longitude: a.longitude + t * (b.longitude - a.longitude),
  };
  return haversineMeters(
    { timestamp: 0, latitude: point.latitude, longitude: point.longitude },
    projected
  );
}

function pointDistanceMeters(
  a: Pick<GpsPoint, 'latitude' | 'longitude'>,
  b: Pick<GpsPoint, 'latitude' | 'longitude'>
): number {
  return haversineMeters(
    { timestamp: 0, latitude: a.latitude, longitude: a.longitude },
    { timestamp: 0, latitude: b.latitude, longitude: b.longitude }
  );
}
