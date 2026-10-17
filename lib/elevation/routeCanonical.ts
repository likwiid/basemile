// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Route-canonical elevation: reuse barometric-quality altitude from older runs
 * as the elevation source for matched routes.
 *
 * Why: the previous phone (Z Fold 3) has a barometer, so its fused GPS
 * altitude tracks the ROAD profile (~160-200 m gain on the usual routes). The
 * current phone (A55) has none — its raw altitude spans hundreds of meters of
 * noise — and open-meteo DEM samples the hillside TERRAIN (~750-1000 m), not
 * the road. A trusted older run on the same route is therefore the best
 * available ground truth.
 *
 * The canonical source is a per-route PROFILE built once from the single
 * cleanest donor (lowest median vertical accuracy — NOT an average across
 * runs, which mean-reverts misregistered tracks and compresses the elevation
 * band), resampled at ~10 m spacing with a light low-pass, and stored on the
 * route (`routes.canonical_profile_json`). New runs sample it by nearest
 * position (≤ 25 m, else off-route → null → normal datum fallback).
 *
 * Pure helpers live in routeCanonicalCore.ts (node-testable); this file is the
 * db-touching orchestrator, mirroring lib/elevation/correct.ts.
 */

import {
  getGpsPoints,
  getRoute,
  getRun,
  getRunsForRoute,
  updateGpsGroundElevations,
  updateRouteCanonicalProfile,
  updateRunElevation,
  updateRunElevationFit,
  updateRunElevationMetrics,
} from '@/lib/storage/db';
import {
  applyPerSplitElevation,
  computeElevationStats,
  elevationPerSplit,
} from '@/lib/metrics/elevation';
import {
  altitudeTrustScore,
  elevationFitMedianM,
  mapProfileAltitudes,
  medianAltitudeAccuracy,
  parseCanonicalProfile,
  projectAndResample,
  PROFILE_SPACING_M,
  type CanonicalProfile,
} from '@/lib/elevation/routeCanonicalCore';
import { recomputeGapForRun } from '@/lib/run/gapRecompute';
import type { ElevationStats, GpsPointRecord } from '@/types';

export {
  altitudeTrustScore,
  buildDonorIndex,
  elevationFitMedianM,
  mapDonorAltitudes,
  mapProfileAltitudes,
  parseCanonicalProfile,
  projectAndResample,
  type AltitudeTrust,
  type CanonicalProfile,
} from '@/lib/elevation/routeCanonicalCore';

export type CanonicalApplied = 'own' | 'donor';

/**
 * A run must land on the canonical profile for at least this share of its
 * points, otherwise the profile belongs to a diverging route and must not win.
 */
const MIN_PROFILE_COVERAGE = 0.7;

/**
 * Apply route-canonical elevation to a run when a trusted source exists:
 *  - the run's OWN raw altitude if it is barometric-quality, else
 *  - the route's canonical profile (built from the cleanest donor on first
 *    need; a variant route falls back to its parent's profile).
 *
 * Writes ground_elevation onto the points (null where off-route, so the
 * quality strip shows those stretches as uncorrected), recomputes the
 * elevation summary (tagged source 'route'), reconciles run/per-split ascent,
 * persists the profile-fit metric, and chains the GAP recompute so grade
 * credit always derives from the same series. Returns which source applied,
 * or null when there is no trusted source (caller falls back to DEM).
 * Never throws.
 */
export function applyCanonicalElevation(run_id: string): CanonicalApplied | null {
  try {
    const run = getRun(run_id);
    if (!run) return null;
    const points = getGpsPoints(run_id);
    if (points.length < 2) return null;

    let canonical: (number | null)[] | null = null;
    let applied: CanonicalApplied | null = null;
    let fit: number | null = null;

    if (altitudeTrustScore(points).trusted) {
      canonical = points.map((p) =>
        p.altitude != null && Number.isFinite(p.altitude) ? p.altitude : null
      );
      applied = 'own';
    } else if (run.route_id) {
      const profile = resolveCanonicalProfile(run.route_id);
      if (profile) {
        const mapped = mapProfileAltitudes(profile.positions, points);
        const matched = mapped.filter((v) => v != null).length;
        // Require solid overlap — a profile from a diverging route must not win.
        if (matched / points.length >= MIN_PROFILE_COVERAGE) {
          canonical = mapped;
          applied = 'donor';
          fit = elevationFitMedianM(mapped, points);
        }
      }
    }

    if (!canonical || !applied) return null;

    const updates: { timestamp: number; ground_elevation: number | null }[] = [];
    const corrected: GpsPointRecord[] = points.map((p, i) => {
      const alt = canonical[i] ?? null;
      if (alt !== null) {
        updates.push({ timestamp: p.timestamp, ground_elevation: alt });
        return { ...p, groundElevation: alt };
      }
      // Clear any stale DEM value so the terrain profile can't bleed through;
      // the null marks the stretch off-route (datum fallback applies).
      updates.push({ timestamp: p.timestamp, ground_elevation: null });
      return { ...p, groundElevation: null };
    });
    updateGpsGroundElevations(run_id, updates);

    const computed = computeElevationStats(corrected);
    const stats: ElevationStats = { ...computed, source: 'route' };
    const current = getRun(run_id);
    if (current) {
      const splits = applyPerSplitElevation(current.splits, elevationPerSplit(corrected));
      updateRunElevationMetrics(
        run_id,
        stats,
        Math.round(stats.total_gain_m),
        Math.round(stats.total_loss_m),
        splits
      );
    } else {
      updateRunElevation(run_id, stats);
    }
    // Fit is only meaningful when a profile was sampled; clear it otherwise so
    // an own-trusted re-base can't leave a stale warning behind.
    updateRunElevationFit(run_id, applied === 'donor' ? fit : null);
    // Elevation series changed → grades changed → GAP/MAF-GAP/per-split GAP
    // must be recomputed from the same series (never throws).
    recomputeGapForRun(run_id);
    return applied;
  } catch {
    return null;
  }
}

/**
 * The route's stored canonical profile, building + persisting it on first
 * need. A variant (sub-route) without a trusted donor of its own borrows its
 * parent's profile — the on-route stretches coincide, and off-parent portions
 * simply map to null.
 */
function resolveCanonicalProfile(
  route_id: string,
  depth = 0
): CanonicalProfile | null {
  if (depth > 1) return null; // at most one parent hop — no cycles
  const route = getRoute(route_id);
  if (!route) return null;

  const stored = parseCanonicalProfile(route.canonical_profile_json);
  if (stored) return stored;

  const built = buildAndPersistProfile(route_id);
  if (built) return built;

  return route.parent_route_id
    ? resolveCanonicalProfile(route.parent_route_id, depth + 1)
    : null;
}

/**
 * Build the route's canonical profile from its best donor: among trusted
 * (barometric-quality) runs, the one with the LOWEST median vertical accuracy
 * wins (ties → oldest). Do NOT average across donors — averaging
 * misregistered tracks mean-reverts and compresses the elevation band.
 */
function buildAndPersistProfile(route_id: string): CanonicalProfile | null {
  const candidates = getRunsForRoute(route_id)
    .map((run) => ({ run, points: getGpsPoints(run.id) }))
    .filter((c) => altitudeTrustScore(c.points).trusted)
    .sort((a, b) => {
      const accA = medianAltitudeAccuracy(a.points) ?? Number.POSITIVE_INFINITY;
      const accB = medianAltitudeAccuracy(b.points) ?? Number.POSITIVE_INFINITY;
      if (accA !== accB) return accA - accB;
      return a.run.started_at - b.run.started_at;
    });

  for (const donor of candidates) {
    const positions = projectAndResample(donor.points);
    if (positions.length < 10) continue; // degenerate track — try the next donor
    const profile: CanonicalProfile = {
      positions,
      spacing_m: PROFILE_SPACING_M,
      donor_run_id: donor.run.id,
      built_at: Date.now(),
    };
    updateRouteCanonicalProfile(route_id, JSON.stringify(profile));
    return profile;
  }
  return null;
}
