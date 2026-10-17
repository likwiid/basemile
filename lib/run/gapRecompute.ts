// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Shared GAP recompute for a single run — the missing link that caused the
 * root elevation/GAP bug: run finalize computed terrain/GAP while
 * groundElevation was still null (raw sawtooth GPS altitude → ~20% phantom
 * grade credit), and the later elevation correction fixed the TOTALS but never
 * re-ran terrain. Every path that (re)writes a run's elevation series must now
 * call `recomputeGapForRun` so avg GAP, MAF-GAP and per-split GAP always
 * derive from the same series as the stored elevation.
 *
 * Import discipline: this module may import ONLY db + terrain + zones +
 * profile. It must never import lib/elevation/correct.ts or
 * lib/elevation/routeCanonical.ts — they call INTO this module, and a reverse
 * import would create a cycle.
 */
import { computeRunTerrainMetrics } from '@/lib/metrics/terrain';
import { useProfileStore } from '@/lib/storage/profile';
import { mafWindowFromCeiling } from '@/lib/zones';
import {
  getCadenceSamples,
  getGpsPoints,
  getHRSamples,
  getRun,
  updateRunGapMetrics,
} from '@/lib/storage/db';
import type { SplitMetric } from '@/types';

export function mergeSplitGap(
  existing: readonly SplitMetric[],
  recomputed: readonly SplitMetric[]
): SplitMetric[] {
  if (existing.length === 0) return [...recomputed];
  // Same distance → same km count; keep DEM ascent/HR/cadence, swap GAP only.
  return existing.map((split, i) => ({
    ...split,
    gap_sec_per_km: recomputed[i]?.gap_sec_per_km ?? split.gap_sec_per_km,
  }));
}

/**
 * Recompute GAP / MAF-GAP / per-split GAP for one run from its stored GPS
 * (which the caller just corrected) and persist them. Uses the MAF ceiling
 * stamped on the run at save time so a later ceiling change can't rewrite
 * history. Never throws; returns true when metrics were persisted.
 */
export function recomputeGapForRun(run_id: string): boolean {
  try {
    const run = getRun(run_id);
    if (!run) return false;
    const gps = getGpsPoints(run_id);
    if (gps.length < 2) return false;

    const terrain = computeRunTerrainMetrics(
      gps,
      getHRSamples(run_id),
      getCadenceSamples(run_id),
      mafWindowFromCeiling(
        run.maf_ceiling ?? useProfileStore.getState().profile.mafCeiling
      )
    );
    updateRunGapMetrics(
      run_id,
      terrain.avg_gap_sec_per_km,
      terrain.maf_gap_pace_sec_per_km,
      mergeSplitGap(run.splits, terrain.splits)
    );
    return true;
  } catch {
    return false;
  }
}
