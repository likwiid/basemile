// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * One-time recompute of grade-adjusted pace after the steep-climb GAP inflation
 * fix (terrain.ts). The stored avg_gap / maf_gap / per-split GAP were produced
 * by the buggy convex-on-noisy-grade method, so the GAP-MAF trend chart reads
 * too fast on hilly runs. This recomputes them from each run's GPS with the
 * fixed method.
 *
 * DEM-corrected ascent/descent/elevation are preserved — only the GAP fields
 * are rewritten (and only the per-split GAP within each split). Idempotent, so
 * re-running is harmless; an AsyncStorage flag skips the work once applied.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { correctRunElevation } from '@/lib/elevation/correct';
import { computeRunTerrainMetrics } from '@/lib/metrics/terrain';
import { mergeSplitGap } from '@/lib/run/gapRecompute';
import { useProfileStore } from '@/lib/storage/profile';
import { mafWindowFromCeiling } from '@/lib/zones';
import {
  getAllRuns,
  getCadenceSamples,
  getGpsPoints,
  getHRSamples,
  getRun,
  updateRunGapMetrics,
} from '@/lib/storage/db';
import type { GpsPointRecord } from '@/types';

// mergeSplitGap moved to gapRecompute.ts (shared with the elevation chain);
// re-exported here so existing importers keep working.
export { mergeSplitGap } from '@/lib/run/gapRecompute';

// DEM-correct runs lacking ground elevation, retrying across launches until the
// correction actually succeeds (the flag is only set once every run is
// corrected), so a transient open-meteo failure can't leave a run on raw GPS
// altitude. Version is bumped whenever the elevation/GAP math changes so stored
// values are recomputed: v4 = DEM reliability, v5 = corrected downhill GAP curve
// + elevation deadband hysteresis.
const GAP_MIGRATION_FLAG = 'migration:gap-v5';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function hasDemElevation(points: readonly GpsPointRecord[]): boolean {
  return points.some(
    (p) => p.groundElevation != null && Number.isFinite(p.groundElevation)
  );
}

/** Returns the number of runs recomputed (0 if already fully applied). */
export async function recomputeGapMetricsOnce(): Promise<number> {
  let flagDone = false;
  try {
    flagDone = (await AsyncStorage.getItem(GAP_MIGRATION_FLAG)) != null;
  } catch {
    // If the flag can't be read, treat as not-done — the recompute is idempotent.
  }

  let updated = 0;
  let allCorrected = true;
  for (const run of getAllRuns()) {
    try {
      let gps = getGpsPoints(run.id);
      if (gps.length < 2) continue;

      // Backfill DEM ground elevation when missing so GAP/ascent are computed
      // from the corrected series. correctRunElevation is robust (429 backoff)
      // and also reconciles run/per-split ascent from the DEM summary.
      const lacksDem = !hasDemElevation(gps);
      if (lacksDem) {
        await correctRunElevation(run.id);
        gps = getGpsPoints(run.id);
        if (!hasDemElevation(gps)) allCorrected = false; // still failed → retry next launch
        await delay(400); // pace open-meteo between runs
      }

      // Recompute GAP if we haven't applied the migration yet, or if we just
      // changed this run's elevation by correcting it.
      if (!flagDone || lacksDem) {
        const terrain = computeRunTerrainMetrics(
          gps,
          getHRSamples(run.id),
          getCadenceSamples(run.id),
          // Prefer the ceiling stamped on the run at save time so a later
          // ceiling change (birthday, adjustment) can't rewrite history.
          mafWindowFromCeiling(
            run.maf_ceiling ?? useProfileStore.getState().profile.mafCeiling
          )
        );
        // Reload: correctRunElevation may have rewritten the run's splits.
        const current = getRun(run.id) ?? run;
        const splits = mergeSplitGap(current.splits, terrain.splits);
        updateRunGapMetrics(
          run.id,
          terrain.avg_gap_sec_per_km,
          terrain.maf_gap_pace_sec_per_km,
          splits
        );
        updated += 1;
      }
    } catch {
      // One bad run must not abort the migration; retry it next launch.
      allCorrected = false;
    }
  }

  // Only mark done once every run is DEM-corrected, so a transient failure
  // self-heals on a future launch instead of being frozen on raw altitude.
  if (allCorrected) {
    try {
      await AsyncStorage.setItem(GAP_MIGRATION_FLAG, '1');
    } catch {
      // Best-effort flag; recompute is idempotent if it re-runs.
    }
  }
  return updated;
}
