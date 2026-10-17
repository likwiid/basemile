// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Display-only tracks for the Routes heat map. Nothing here feeds a saved
 * metric.
 *
 * The heat map used to pull every GPS row ever recorded (~1 Hz, tens of
 * thousands of rows) across JSI and push one GeoJSON feature per row to
 * native. Instead each run is thinned to one point per {@link HEAT_BUCKET_MS}
 * bucket (in SQL, see getThinTrackRows) carrying the bucket's raw sample count
 * as its heat weight, so the density the heat layer sums stays the same. The
 * faint per-run trace is Douglas-Peucker simplified on top of that.
 *
 * A saved run's lat/lon never change (elevation correction only rewrites
 * ground elevation), so built tracks are cached per run id for the session.
 */
import { simplifyTrack, type LngLat } from '@/lib/run/liveTrack';

/** One heat point per run per this many milliseconds. */
export const HEAT_BUCKET_MS = 5000;
/** Max deviation of the simplified trace. A heat-map pixel is well over 5 m. */
export const HEAT_LINE_TOLERANCE_M = 5;

/** A thinned gps_points row: the first sample of a bucket plus its size. */
export interface ThinTrackRow {
  run_id: string;
  timestamp: number;
  latitude: number;
  longitude: number;
  /** Raw samples folded into this bucket. */
  n: number;
}

export interface HeatPointProperties {
  /** Heat weight: raw GPS samples this point stands for. */
  w: number;
}

export interface TrackExtent {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface HeatTrack {
  runId: string;
  heat: GeoJSON.Feature<GeoJSON.Point, HeatPointProperties>[];
  line: GeoJSON.Feature<GeoJSON.LineString>;
  extent: TrackExtent;
}

/**
 * JS mirror of the SQL thinning, for tests: rows must be
 * ordered by (run_id, timestamp); each (run_id, floor(timestamp / bucketMs))
 * group keeps its first row and counts its members.
 */
export function thinTrackRows(
  rows: readonly Omit<ThinTrackRow, 'n'>[],
  bucketMs: number = HEAT_BUCKET_MS
): ThinTrackRow[] {
  const out: ThinTrackRow[] = [];
  let lastRun: string | null = null;
  let lastBucket = Number.NaN;
  for (const row of rows) {
    const bucket = Math.trunc(row.timestamp / bucketMs);
    const current = out[out.length - 1];
    if (current && row.run_id === lastRun && bucket === lastBucket) {
      current.n += 1;
      continue;
    }
    lastRun = row.run_id;
    lastBucket = bucket;
    out.push({
      run_id: row.run_id,
      timestamp: row.timestamp,
      latitude: row.latitude,
      longitude: row.longitude,
      n: 1,
    });
  }
  return out;
}

/** Build one run's heat points, simplified trace and extent. Null below two points. */
export function buildHeatTrack(
  runId: string,
  rows: readonly ThinTrackRow[],
  toleranceM: number = HEAT_LINE_TOLERANCE_M
): HeatTrack | null {
  if (rows.length < 2) return null;
  const extent: TrackExtent = {
    minLat: Infinity,
    maxLat: -Infinity,
    minLon: Infinity,
    maxLon: -Infinity,
  };
  const heat: HeatTrack['heat'] = [];
  for (const r of rows) {
    if (r.latitude < extent.minLat) extent.minLat = r.latitude;
    if (r.latitude > extent.maxLat) extent.maxLat = r.latitude;
    if (r.longitude < extent.minLon) extent.minLon = r.longitude;
    if (r.longitude > extent.maxLon) extent.maxLon = r.longitude;
    heat.push({
      type: 'Feature',
      properties: { w: r.n },
      geometry: { type: 'Point', coordinates: [r.longitude, r.latitude] },
    });
  }
  const coordinates: LngLat[] = simplifyTrack(rows, toleranceM);
  return {
    runId,
    heat,
    line: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } },
    extent,
  };
}

/** Group `ORDER BY run_id, timestamp` rows by run. */
function groupByRun(rows: readonly ThinTrackRow[]): Map<string, ThinTrackRow[]> {
  const byRun = new Map<string, ThinTrackRow[]>();
  for (const row of rows) {
    let list = byRun.get(row.run_id);
    if (!list) {
      list = [];
      byRun.set(row.run_id, list);
    }
    list.push(row);
  }
  return byRun;
}

export type HeatTrackLoader = (runIds: readonly string[]) => HeatTrack[];

/**
 * Session cache of built heat tracks keyed by run id. Each call only loads
 * runs it has not built yet, drops runs that no longer exist, and returns the
 * previous array (same identity) when the visible set did not change, so the
 * map's GeoJSON is not rebuilt or re-sent to native.
 *
 * Runs without enough GPS are not cached; they are cheap to re-check and
 * leave room for a track that lands after the run row.
 */
export function createHeatTrackCache(
  loadRows: (runIds: readonly string[]) => readonly ThinTrackRow[],
  toleranceM: number = HEAT_LINE_TOLERANCE_M
): HeatTrackLoader {
  const cache = new Map<string, HeatTrack>();
  let last: HeatTrack[] = [];

  return (runIds) => {
    const missing = runIds.filter((id) => !cache.has(id));
    if (missing.length > 0) {
      for (const [id, rows] of groupByRun(loadRows(missing))) {
        const track = buildHeatTrack(id, rows, toleranceM);
        if (track) cache.set(id, track);
      }
    }
    const live = new Set(runIds);
    for (const id of cache.keys()) {
      if (!live.has(id)) cache.delete(id);
    }

    const next: HeatTrack[] = [];
    for (const id of runIds) {
      const track = cache.get(id);
      if (track) next.push(track);
    }
    const unchanged = next.length === last.length && next.every((t, i) => t === last[i]);
    if (!unchanged) last = next;
    return last;
  };
}

/** Merge per-track extents; null when there are no tracks. */
export function mergeExtents(tracks: readonly HeatTrack[]): TrackExtent | null {
  if (tracks.length === 0) return null;
  const out: TrackExtent = { minLat: Infinity, maxLat: -Infinity, minLon: Infinity, maxLon: -Infinity };
  for (const { extent } of tracks) {
    out.minLat = Math.min(out.minLat, extent.minLat);
    out.maxLat = Math.max(out.maxLat, extent.maxLat);
    out.minLon = Math.min(out.minLon, extent.minLon);
    out.maxLon = Math.max(out.maxLon, extent.maxLon);
  }
  return out;
}
