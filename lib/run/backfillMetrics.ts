// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * One-time terrain + elevation backfill for runs that predate those features.
 *
 * Such runs have `avg_gap_sec_per_km == null` (terrain was never computed at
 * save time), which breaks the continuity of the GAP and elevation trend
 * charts. This recomputes GAP / ascent / per-split / elevation from each run's
 * stored GPS — exactly like the run-save flow — so every run plots. Idempotent
 * (a run with GAP already set is skipped), so it is safe to run on every start.
 *
 * Note: ascent/elevation here are GPS-based; opening a run still runs the DEM
 * correction, which reconciles all three readings (see Bug 1).
 */
import {
  applyPerSplitElevation,
  computeElevationStats,
  elevationPerSplit,
} from '@/lib/metrics/elevation';
import { computeRunTerrainMetrics } from '@/lib/metrics/terrain';
import {
  getAllRuns,
  getCadenceSamples,
  getGpsPoints,
  getHRSamples,
  updateRunBackfill,
} from '@/lib/storage/db';
import { useProfileStore } from '@/lib/storage/profile';
import { mafWindowFromCeiling } from '@/lib/zones';

/** Returns the number of runs backfilled. */
export function backfillRunMetrics(): number {
  let updated = 0;
  for (const run of getAllRuns()) {
    try {
      const gps = getGpsPoints(run.id);
      if (gps.length < 2) continue;

      const elevStats = computeElevationStats(gps);
      const ascent = Math.round(elevStats.total_gain_m);
      const descent = Math.round(elevStats.total_loss_m);

      const staleTerrain = run.avg_gap_sec_per_km == null;
      // Bug 1 retroactive: a run whose stored ascent disagrees with its
      // elevation summary needs reconciling even if terrain already ran.
      const mismatch =
        Math.abs((run.ascent_m ?? 0) - ascent) > 2 ||
        Math.abs((run.descent_m ?? 0) - descent) > 2;
      if (!staleTerrain && !mismatch) continue; // already consistent

      let avgGap = run.avg_gap_sec_per_km ?? null;
      let mafGap = run.maf_gap_pace_sec_per_km ?? null;
      let baseSplits = run.splits;
      if (staleTerrain) {
        const terrain = computeRunTerrainMetrics(
          gps,
          getHRSamples(run.id),
          getCadenceSamples(run.id),
          // The run's own ceiling when stamped; today's only for legacy runs.
          mafWindowFromCeiling(
            run.maf_ceiling ?? useProfileStore.getState().profile.mafCeiling
          )
        );
        avgGap = terrain.avg_gap_sec_per_km;
        mafGap = terrain.maf_gap_pace_sec_per_km;
        baseSplits = terrain.splits.length > 0 ? terrain.splits : run.splits;
      }
      const splits = applyPerSplitElevation(baseSplits, elevationPerSplit(gps));
      updateRunBackfill(run.id, {
        avg_gap_sec_per_km: avgGap,
        maf_gap_pace_sec_per_km: mafGap,
        ascent_m: ascent,
        descent_m: descent,
        splits,
        elevation: elevStats,
      });
      updated++;
    } catch {
      // One bad run must not abort the backfill.
    }
  }
  return updated;
}
