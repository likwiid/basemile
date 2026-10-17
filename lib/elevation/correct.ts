// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Run-level elevation correction orchestrator.
 *
 * This is the ONLY file in the elevation engine that touches the database
 * (lib/storage/db.ts) — keep all pure math in lib/metrics/elevation.ts and all
 * pure network shaping in lib/elevation/dem.ts so they stay node-testable.
 *
 * `correctRunElevation` is the "always cloud-corrected" entry point. It is
 * called post-run (once GPS points are persisted) and on-demand (e.g. a
 * pull-to-refresh on the run detail screen). It backfills DEM ground
 * elevation onto the stored GPS points, recomputes the full ElevationStats
 * from the now-corrected track, persists the summary, and returns it.
 */

import {
  getGpsPoints,
  getRun,
  updateGpsGroundElevations,
  updateRunElevation,
  updateRunElevationMetrics,
} from '@/lib/storage/db';
import {
  applyPerSplitElevation,
  computeElevationStats,
  elevationPerSplit,
} from '@/lib/metrics/elevation';
import { fetchGroundElevations, fillElevationGaps } from '@/lib/elevation/dem';
import { applyCanonicalElevation } from '@/lib/elevation/routeCanonical';
import { recomputeGapForRun } from '@/lib/run/gapRecompute';
import type { ElevationStats, GpsPointRecord } from '@/types';

/**
 * Minimum share of coordinates that must come back with a REAL DEM value
 * before the correction is applied. Below this, gap interpolation would be
 * inventing most of the series (worst case: one successful batch of 100 and
 * everything after it carried as a constant → gain flattened to ~0, persisted
 * as `source:'dem'` — and the migration's self-heal would never retry because
 * some points carry a groundElevation). Bailing keeps the run on GPS altitude
 * and, critically, leaves ZERO groundElevation written so every retry path
 * (run-detail open, gap migration) tries again next time.
 */
const MIN_DEM_COVERAGE = 0.7;

/**
 * Cloud-correct and recompute a run's elevation.
 *
 * Flow:
 *  1. Load the run's GPS points.
 *  2. Fetch DEM ground elevation for every coordinate (batched, never throws).
 *  3. Persist any successful lookups onto the points (matched by timestamp).
 *  4. Recompute ElevationStats over the in-memory corrected points.
 *  5. Persist the summary and return it.
 *
 * Degrades gracefully: if there are no points, returns null (and clears any
 * stale summary). If the network fully fails, every ground elevation is null
 * so `computeElevationStats` simply falls back to raw GPS altitude — the
 * stats are still computed and persisted, just flagged `source: 'gps'` /
 * `corrected: false`.
 *
 * @param run_id The run to correct.
 * @returns The persisted ElevationStats, or null when the run has no GPS.
 */
export async function correctRunElevation(
  run_id: string
): Promise<ElevationStats | null> {
  const points = getGpsPoints(run_id);
  if (points.length === 0) {
    updateRunElevation(run_id, null);
    return null;
  }

  // Trusted barometric elevation (own or from a matched-route donor run)
  // beats DEM: it tracks the ROAD profile, while 90 m DEM samples the
  // surrounding terrain (~750 m "gain" on the usual hillside loop).
  if (applyCanonicalElevation(run_id)) {
    return getRun(run_id)?.elevation ?? null;
  }

  const coords = points.map((p) => ({
    latitude: p.latitude,
    longitude: p.longitude,
  }));

  // Never throws — fully-failed lookups come back as nulls.
  const elevations = await fetchGroundElevations(coords);

  // Real (non-interpolated) DEM coverage. Partial rate-limit failures are the
  // norm on long runs (36+ sequential batches); only correct when most of the
  // series is genuine, otherwise bail and retry on a future open/migration.
  const realCount = elevations.filter((v) => v != null).length;
  const realCoverage = realCount / elevations.length;
  if (realCoverage > 0 && realCoverage < MIN_DEM_COVERAGE) {
    const run = getRun(run_id);
    return run?.elevation ?? null;
  }

  // Fill failed-lookup gaps by interpolation so the corrected series stays on a
  // SINGLE datum. Mixing DEM ground elevation with raw GPS altitude at
  // partial-correction boundaries produces phantom cliffs in gain/loss. If DEM
  // fully failed, every entry stays null and we fall back to GPS altitude.
  const filled = fillElevationGaps(elevations);

  // Backfill onto the points (interpolated where the raw lookup failed).
  const updates: { timestamp: number; ground_elevation: number | null }[] = [];
  const corrected: GpsPointRecord[] = points.map((p, i) => {
    const ground = filled[i] ?? null;
    if (ground !== null) {
      updates.push({ timestamp: p.timestamp, ground_elevation: ground });
      return { ...p, groundElevation: ground };
    }
    return p;
  });

  if (updates.length > 0) {
    updateGpsGroundElevations(run_id, updates);
  }

  const computed = computeElevationStats(corrected);
  // The filled series makes every point "usable", so the computed coverage
  // reads ~1.0 even when up to 30% was interpolated — persist the REAL DEM
  // share instead so the quality strip can't overstate confidence.
  const stats: ElevationStats =
    realCoverage > 0 && realCoverage < computed.coverage_pct
      ? { ...computed, coverage_pct: Math.round(realCoverage * 1000) / 1000 }
      : computed;
  // Reconcile run-level + per-split ascent/descent with the DEM summary so all
  // three readings (runs.ascent_m, sum(splits.ascent_m), elevation_json) agree.
  const run = getRun(run_id);
  if (run) {
    const splits = applyPerSplitElevation(run.splits, elevationPerSplit(corrected));
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
  // The elevation series changed → every grade changed → GAP must follow (the
  // root bug was finalize-time GAP surviving a later correction untouched).
  if (updates.length > 0) {
    recomputeGapForRun(run_id);
  }
  return stats;
}
