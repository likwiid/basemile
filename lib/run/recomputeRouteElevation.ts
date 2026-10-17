// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * One-time re-base of stored elevation onto route-canonical (barometric)
 * profiles, plus a GAP recompute for every run whose elevation changed
 * (chained inside applyCanonicalElevation).
 *
 * Why: all stored runs were DEM-corrected, and 90 m DEM tracks the hillside
 * TERRAIN (~750-1000 m gain) instead of the ROAD (~160-200 m). The Fold-era
 * runs carry barometric-quality raw altitude, so they (or a run's own trusted
 * altitude) take precedence via applyCanonicalElevation.
 *
 * v2: the canonical source is now the stored per-route PROFILE built from the
 * single cleanest donor (lowest median vertical accuracy — Jun 8, not the
 * oldest run), so every run is re-based — including ones already tagged
 * source:'route' by the v1 pass, whose grades came from a worse donor.
 *
 * Self-healing: the flag is only set when every eligible run was re-based, so
 * a transient failure retries on the next launch. Runs with no trusted source
 * (unmatched routes) keep their DEM values — that is still the best available.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { applyCanonicalElevation } from '@/lib/elevation/routeCanonical';
import { refreshRouteAggregates } from '@/lib/route/backfill';
import { getAllRuns } from '@/lib/storage/db';

const FLAG = 'migration:route-elevation-v2';

/** Returns the number of runs re-based (0 when already applied). */
export async function recomputeRouteElevationOnce(): Promise<number> {
  try {
    if ((await AsyncStorage.getItem(FLAG)) != null) return 0;
  } catch {
    // Unreadable flag → treat as not-done; the whole pass is idempotent.
  }

  let updated = 0;
  let clean = true;
  for (const run of getAllRuns()) {
    try {
      // applyCanonicalElevation chains the GAP/MAF-GAP/per-split recompute
      // internally (recomputeGapForRun) — elevation and GAP stay in lockstep.
      // No skip for source:'route': v2 re-bases those onto the new profile.
      if (applyCanonicalElevation(run.id)) updated += 1;
      // No trusted source → DEM stays; that's still the best available.
    } catch {
      clean = false; // retry this run on the next launch
    }
  }

  // Re-based ascent values feed the per-route averages → refresh them.
  if (updated > 0) {
    try {
      refreshRouteAggregates();
    } catch {
      // Aggregates self-heal on the next route write; never block the pass.
    }
  }

  if (clean) {
    try {
      await AsyncStorage.setItem(FLAG, '1');
    } catch {
      // Best-effort; the pass is idempotent.
    }
  }
  return updated;
}
