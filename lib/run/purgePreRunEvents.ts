// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * One-time purge of event-shaped pre_run_state blobs (Fix: onPress passed the
 * RN press event as the pre-run state, persisting ~0.5 MB fiber JSON onto the
 * run). Nulling the column is strictly better than keeping garbage: the run
 * simply shows "no pre-run state logged", matching what actually happened.
 *
 * Idempotent + self-healing: the AsyncStorage flag is only written after a
 * clean pass, so a transient failure retries on the next launch.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { isPurgeablePreRunJson } from '@/lib/run/preRun';
import { purgeInvalidPreRunStates } from '@/lib/storage/db';

const FLAG = 'migration:purge-prerun-events-v1';

/** Returns the number of runs whose pre_run_json was nulled (0 when done). */
export async function purgePreRunEventsOnce(): Promise<number> {
  try {
    if ((await AsyncStorage.getItem(FLAG)) != null) return 0;
  } catch {
    // Unreadable flag → treat as not-done; the purge is idempotent.
  }

  let purged = 0;
  try {
    purged = purgeInvalidPreRunStates(isPurgeablePreRunJson);
  } catch {
    return purged; // leave the flag unset so the next launch retries
  }

  try {
    await AsyncStorage.setItem(FLAG, '1');
  } catch {
    // Best-effort flag; the purge is idempotent.
  }
  return purged;
}
