// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Pure core of route-canonical elevation — NO db/expo imports so it stays
 * node-testable (mirrors the elevation.ts / dem.ts split). The db-touching
 * orchestrator lives in routeCanonical.ts.
 */

import type { GpsPointRecord } from '@/types';

/** Coverage of non-null altitudes a series needs before it can be judged. */
const MIN_ALT_COVERAGE = 0.9;
/** A run's altitude span beyond this is sensor noise, not any real road. */
const MAX_PLAUSIBLE_SPAN_M = 200;
/** p95 of per-step |Δaltitude| — barometric series are far smoother than this. */
const MAX_P95_STEP_M = 3;
/** Steps longer than this (dropouts) are excluded from the noise measure. */
const MAX_STEP_DT_MS = 5_000;
/** A target point further than this from every donor point gets no altitude. */
const MAX_MATCH_DISTANCE_M = 35;
/**
 * A target point further than this from every canonical PROFILE position keeps
 * groundElevation null (normal datum fallback) and reads as off-route.
 */
export const MAX_PROFILE_MATCH_DISTANCE_M = 25;
/** Arc-length spacing of the resampled canonical profile. */
export const PROFILE_SPACING_M = 10;
/** Moving-average window (samples) for the profile's light low-pass. */
export const PROFILE_SMOOTH_WINDOW = 5;
/** Only fixes at least this accurate participate in the profile fit metric. */
const FIT_MAX_ACCURACY_M = 10;
/** Below this many qualifying fixes the fit median is statistically useless. */
const FIT_MIN_SAMPLES = 20;

const M_PER_DEG_LAT = 111_320;

export interface AltitudeTrust {
  trusted: boolean;
  coverage: number;
  span_m: number;
  p95_step_m: number;
}

/**
 * Judge whether a track's RAW altitude series is barometric-quality.
 * Fold-era runs pass (span ~35-60 m, sub-meter steps); A55 runs fail hard
 * (span 300+ m, multi-meter steps).
 */
export function altitudeTrustScore(points: readonly GpsPointRecord[]): AltitudeTrust {
  const alts: number[] = [];
  for (const p of points) {
    if (p.altitude != null && Number.isFinite(p.altitude)) alts.push(p.altitude);
  }
  const coverage = points.length > 0 ? alts.length / points.length : 0;
  if (alts.length < 10) {
    return { trusted: false, coverage, span_m: 0, p95_step_m: 0 };
  }

  let min = Infinity;
  let max = -Infinity;
  for (const a of alts) {
    if (a < min) min = a;
    if (a > max) max = a;
  }
  const span = max - min;

  const steps: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (!prev || !curr) continue;
    if (prev.altitude == null || curr.altitude == null) continue;
    const dt = curr.timestamp - prev.timestamp;
    if (dt <= 0 || dt > MAX_STEP_DT_MS) continue;
    steps.push(Math.abs(curr.altitude - prev.altitude));
  }
  steps.sort((a, b) => a - b);
  const p95 = steps.length > 0 ? (steps[Math.floor(steps.length * 0.95)] ?? 0) : Infinity;

  return {
    trusted:
      coverage >= MIN_ALT_COVERAGE &&
      span <= MAX_PLAUSIBLE_SPAN_M &&
      p95 <= MAX_P95_STEP_M,
    coverage,
    span_m: span,
    p95_step_m: p95,
  };
}

interface DonorPoint {
  x: number; // lon scaled by cos(lat), degrees
  y: number; // lat, degrees
  alt: number;
}

/** Precompute a planar index of the donor's altitude-bearing points. */
export function buildDonorIndex(points: readonly GpsPointRecord[]): DonorPoint[] {
  const out: DonorPoint[] = [];
  for (const p of points) {
    if (p.altitude == null || !Number.isFinite(p.altitude)) continue;
    const cosLat = Math.cos((p.latitude * Math.PI) / 180);
    out.push({ x: p.longitude * cosLat, y: p.latitude, alt: p.altitude });
  }
  return out;
}

/**
 * Sample the donor track at each target point: nearest donor point within
 * MAX_MATCH_DISTANCE_M, else null (off-donor detours hold the reference in the
 * elevation engine instead of inventing values).
 */
export function mapDonorAltitudes(
  donor: readonly DonorPoint[],
  targets: readonly GpsPointRecord[]
): (number | null)[] {
  const maxDeg = MAX_MATCH_DISTANCE_M / M_PER_DEG_LAT;
  const maxDegSq = maxDeg * maxDeg;

  return targets.map((t) => {
    const cosLat = Math.cos((t.latitude * Math.PI) / 180);
    const tx = t.longitude * cosLat;
    const ty = t.latitude;
    let best = Infinity;
    let bestAlt: number | null = null;
    for (const d of donor) {
      const dx = d.x - tx;
      const dy = d.y - ty;
      const distSq = dx * dx + dy * dy;
      if (distSq < best) {
        best = distSq;
        bestAlt = d.alt;
      }
    }
    return best <= maxDegSq ? bestAlt : null;
  });
}

// ============================================================================
// Canonical route profile — a compact, resampled, low-passed elevation profile
// built ONCE from the single cleanest donor run and stored on the route.
// Averaging across runs is deliberately avoided: misregistered tracks
// mean-revert and compress the elevation band.
// ============================================================================

/** One resampled profile position. x = longitude (deg), y = latitude (deg). */
export interface CanonicalProfilePoint {
  x: number;
  y: number;
  alt: number;
}

/** Persisted shape of routes.canonical_profile_json. */
export interface CanonicalProfile {
  positions: CanonicalProfilePoint[];
  spacing_m: number;
  donor_run_id: string;
  built_at: number;
}

/**
 * Project the donor track onto the route geometry (the donor's own polyline —
 * the truest available registration of the road) and resample it at a fixed
 * arc-length spacing, linearly interpolating altitude between fixes, then
 * apply a light moving-average low-pass. Amplitude-preserving: one donor, a
 * small window — no cross-run averaging.
 */
export function projectAndResample(
  donorPoints: readonly GpsPointRecord[],
  spacingM: number = PROFILE_SPACING_M,
  smoothWindow: number = PROFILE_SMOOTH_WINDOW
): CanonicalProfilePoint[] {
  const pts = donorPoints.filter(
    (p) => p.altitude != null && Number.isFinite(p.altitude)
  );
  if (pts.length < 2 || spacingM <= 0) return [];

  const first = pts[0]!;
  const raw: CanonicalProfilePoint[] = [
    { x: first.longitude, y: first.latitude, alt: first.altitude! },
  ];
  // Walk the polyline, emitting a sample every `spacingM` metres of arc length.
  let sinceLast = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const seg = planarMeters(a, b);
    if (seg <= 0) continue;
    let pos = 0;
    while (sinceLast + (seg - pos) >= spacingM) {
      const need = spacingM - sinceLast;
      const t = (pos + need) / seg;
      raw.push({
        x: a.longitude + t * (b.longitude - a.longitude),
        y: a.latitude + t * (b.latitude - a.latitude),
        alt: a.altitude! + t * (b.altitude! - a.altitude!),
      });
      pos += need;
      sinceLast = 0;
    }
    sinceLast += seg - pos;
  }
  // Close the profile at the route's end so the final stretch is covered too.
  if (sinceLast >= spacingM / 2) {
    const last = pts[pts.length - 1]!;
    raw.push({ x: last.longitude, y: last.latitude, alt: last.altitude! });
  }
  if (raw.length < 2) return [];

  // Light low-pass: centered moving average, clamped at the ends.
  const half = Math.floor(Math.max(1, smoothWindow) / 2);
  return raw.map((p, i) => {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(raw.length - 1, i + half); j += 1) {
      sum += raw[j]!.alt;
      count += 1;
    }
    return { x: p.x, y: p.y, alt: sum / count };
  });
}

/**
 * Sample the canonical profile at each target point: nearest profile position
 * within `maxDistanceM`, else null — the run left the route there, so the
 * elevation engine's normal datum fallback applies and the stretch shows as
 * an uncorrected (off-route) segment in the quality strip.
 */
export function mapProfileAltitudes(
  positions: readonly CanonicalProfilePoint[],
  targets: readonly GpsPointRecord[],
  maxDistanceM: number = MAX_PROFILE_MATCH_DISTANCE_M
): (number | null)[] {
  const maxDeg = maxDistanceM / M_PER_DEG_LAT;
  const maxDegSq = maxDeg * maxDeg;
  const planar = positions.map((p) => {
    const cosLat = Math.cos((p.y * Math.PI) / 180);
    return { px: p.x * cosLat, py: p.y, alt: p.alt };
  });

  return targets.map((t) => {
    const cosLat = Math.cos((t.latitude * Math.PI) / 180);
    const tx = t.longitude * cosLat;
    const ty = t.latitude;
    let best = Infinity;
    let bestAlt: number | null = null;
    for (const d of planar) {
      const dx = d.px - tx;
      const dy = d.py - ty;
      const distSq = dx * dx + dy * dy;
      if (distSq < best) {
        best = distSq;
        bestAlt = d.alt;
      }
    }
    return best <= maxDegSq ? bestAlt : null;
  });
}

/**
 * Profile-vs-GPS fit: median |profileAlt − rawAlt| over target points that
 * matched the profile AND carry a good fix (altitudeAccuracy ≤ 10 m and
 * horizontal accuracy ≤ 10 m). Null when too few qualifying fixes exist.
 * Stored per run; the elevation card warns when it exceeds 8 m.
 */
export function elevationFitMedianM(
  profileAlts: readonly (number | null)[],
  targets: readonly GpsPointRecord[]
): number | null {
  const diffs: number[] = [];
  for (let i = 0; i < targets.length; i += 1) {
    const profAlt = profileAlts[i];
    const p = targets[i];
    if (profAlt == null || !p) continue;
    if (p.altitude == null || !Number.isFinite(p.altitude)) continue;
    if (p.altitudeAccuracy == null || p.altitudeAccuracy > FIT_MAX_ACCURACY_M) continue;
    if (p.accuracy == null || p.accuracy > FIT_MAX_ACCURACY_M) continue;
    diffs.push(Math.abs(profAlt - p.altitude));
  }
  if (diffs.length < FIT_MIN_SAMPLES) return null;
  diffs.sort((a, b) => a - b);
  const mid = diffs[Math.floor(diffs.length / 2)] ?? null;
  return mid === null ? null : Math.round(mid * 100) / 100;
}

/** Median vertical-accuracy estimate of a track, or null when unreported. */
export function medianAltitudeAccuracy(
  points: readonly GpsPointRecord[]
): number | null {
  const accs = points
    .map((p) => p.altitudeAccuracy)
    .filter((v): v is number => v != null && Number.isFinite(v))
    .sort((a, b) => a - b);
  const mid = accs[Math.floor(accs.length / 2)];
  return mid ?? null;
}

/** Parse a stored canonical profile; null on any malformed input. Never throws. */
export function parseCanonicalProfile(raw: string | null | undefined): CanonicalProfile | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CanonicalProfile>;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.positions)) return null;
    const positions = parsed.positions.filter(
      (p): p is CanonicalProfilePoint =>
        !!p &&
        typeof p === 'object' &&
        Number.isFinite((p as CanonicalProfilePoint).x) &&
        Number.isFinite((p as CanonicalProfilePoint).y) &&
        Number.isFinite((p as CanonicalProfilePoint).alt)
    );
    if (positions.length < 2) return null;
    return {
      positions,
      spacing_m: typeof parsed.spacing_m === 'number' ? parsed.spacing_m : PROFILE_SPACING_M,
      donor_run_id: typeof parsed.donor_run_id === 'string' ? parsed.donor_run_id : '',
      built_at: typeof parsed.built_at === 'number' ? parsed.built_at : 0,
    };
  } catch {
    return null;
  }
}

/** Planar (equirectangular) distance in metres — cheap and exact enough at run scale. */
function planarMeters(
  a: Pick<GpsPointRecord, 'latitude' | 'longitude'>,
  b: Pick<GpsPointRecord, 'latitude' | 'longitude'>
): number {
  const cosLat = Math.cos((a.latitude * Math.PI) / 180);
  const dx = (b.longitude - a.longitude) * cosLat * M_PER_DEG_LAT;
  const dy = (b.latitude - a.latitude) * M_PER_DEG_LAT;
  return Math.sqrt(dx * dx + dy * dy);
}

