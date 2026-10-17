// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Persist aerobic decoupling so the displayed value stops drifting across app
 * versions. decouplingForRun is otherwise recomputed on every open, so the same
 * run reads differently after any method change. resolveDecoupling reads the
 * stored value (computing + persisting once when absent/stale), and
 * recomputeDecouplingOnce backfills every existing run a single time onto the
 * current method — the same self-healing pattern as the GAP migration.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DECOUPLING_METHOD_VERSION,
  decouplingForRun,
  stampDecoupling,
} from '@/lib/metrics/decoupling';
import {
  getAllRuns,
  getGpsPoints,
  getHRSamples,
  updateRunDecoupling,
} from '@/lib/storage/db';
import type {
  CompletedRun,
  GpsPointRecord,
  HRSampleRecord,
  StoredDecoupling,
} from '@/types';

const DECOUPLING_MIGRATION_FLAG = 'migration:decoupling-v1';

function isCurrent(stored: StoredDecoupling | null | undefined): stored is StoredDecoupling {
  return stored != null && stored.method_version === DECOUPLING_METHOD_VERSION;
}

/**
 * Returns the run's persisted decoupling, computing + persisting it once when
 * absent or produced by an older method version. Display reads this rather than
 * the raw recompute, so the number is stable across app versions.
 */
export function resolveDecoupling(
  run: CompletedRun,
  hr: HRSampleRecord[],
  gps: GpsPointRecord[]
): StoredDecoupling {
  if (isCurrent(run.decoupling)) return run.decoupling;
  const stamped = stampDecoupling(decouplingForRun(hr, gps));
  try {
    updateRunDecoupling(run.id, stamped);
  } catch {
    // Persisting is best-effort; the freshly computed value is still displayed.
  }
  return stamped;
}

/** Backfills decoupling for every run once. Returns the number updated (0 if already applied). */
export async function recomputeDecouplingOnce(): Promise<number> {
  let flagDone = false;
  try {
    flagDone = (await AsyncStorage.getItem(DECOUPLING_MIGRATION_FLAG)) != null;
  } catch {
    // Treat an unreadable flag as not-done; the backfill is idempotent.
  }
  if (flagDone) return 0;

  let updated = 0;
  let allDone = true;
  for (const run of getAllRuns()) {
    try {
      if (isCurrent(run.decoupling)) continue;
      const stamped = stampDecoupling(
        decouplingForRun(getHRSamples(run.id), getGpsPoints(run.id))
      );
      updateRunDecoupling(run.id, stamped);
      updated += 1;
    } catch {
      allDone = false; // one bad run must not abort the backfill; retry next launch
    }
  }

  if (allDone) {
    try {
      await AsyncStorage.setItem(DECOUPLING_MIGRATION_FLAG, '1');
    } catch {
      // Best-effort flag; the backfill is idempotent if it re-runs.
    }
  }
  return updated;
}
