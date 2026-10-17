// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Launch-time maintenance gate. The full-history passes (terrain backfill,
 * zone redistribution) read every run's samples; at ~20 hour-long runs that
 * is tens of thousands of rows on the JS thread, on every launch, for a
 * result that only changes when the history or the zones change. They now run
 * only when this fingerprint moves.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { getDb } from '@/lib/storage/db';

const KEY = 'maintenance:launch-fingerprint-v1';

export function launchFingerprint(zonesJson: string): string | null {
  try {
    const row = getDb().getFirstSync<{ f: string }>(
      `SELECT (SELECT COUNT(*) FROM runs) || ':' ||
              (SELECT COALESCE(SUM(started_at), 0) FROM runs) || ':' ||
              (SELECT COUNT(*) FROM hr_samples) || ':' ||
              (SELECT COUNT(*) FROM gps_points) AS f`
    );
    return row ? `${row.f}|${zonesJson}` : null;
  } catch {
    return null;
  }
}

export async function maintenanceIsCurrent(fingerprint: string | null): Promise<boolean> {
  if (fingerprint === null) return false;
  try {
    return (await AsyncStorage.getItem(KEY)) === fingerprint;
  } catch {
    return false;
  }
}

export async function markMaintenanceDone(fingerprint: string | null): Promise<void> {
  if (fingerprint === null) return;
  try {
    await AsyncStorage.setItem(KEY, fingerprint);
  } catch {
    // Best-effort: the passes are idempotent, a miss only costs one rerun.
  }
}
