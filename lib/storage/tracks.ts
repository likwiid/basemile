// SPDX-License-Identifier: GPL-3.0-or-later

import type { GpsPoint } from '@/types';

/** The lean gps_points projection the route heat map needs. */
export interface TrackRow {
  run_id: string;
  timestamp: number;
  latitude: number;
  longitude: number;
}

/**
 * Group one `ORDER BY run_id, timestamp` scan into per-run tracks, emitted in
 * `runIds` order (newest run first) with an empty track for runs that have no
 * GPS — the same shape as `runIds.map(getGpsPoints)` but from a single query.
 */
export function groupTracksByRun(
  runIds: readonly string[],
  rows: readonly TrackRow[]
): GpsPoint[][] {
  const byRun = new Map<string, GpsPoint[]>();
  for (const row of rows) {
    let track = byRun.get(row.run_id);
    if (!track) {
      track = [];
      byRun.set(row.run_id, track);
    }
    track.push({ timestamp: row.timestamp, latitude: row.latitude, longitude: row.longitude });
  }
  return runIds.map((id) => byRun.get(id) ?? []);
}
