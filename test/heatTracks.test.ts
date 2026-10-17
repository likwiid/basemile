// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import {
  buildHeatTrack,
  createHeatTrackCache,
  mergeExtents,
  thinTrackRows,
  type ThinTrackRow,
} from '@/lib/route/heatTracks';

function raw(runId: string, count: number, startMs = 0, stepMs = 1000) {
  return Array.from({ length: count }, (_, i) => ({
    run_id: runId,
    timestamp: startMs + i * stepMs,
    latitude: 45 + i * 0.0001,
    longitude: 7 + (i % 2) * 0.0001,
  }));
}

describe('thinTrackRows', () => {
  it('keeps the first sample of each run/bucket and counts the bucket', () => {
    const rows = [...raw('a', 12), ...raw('b', 3, 4000)];
    const thin = thinTrackRows(rows, 5000);
    expect(thin.map((r) => [r.run_id, r.timestamp, r.n])).toEqual([
      ['a', 0, 5],
      ['a', 5000, 5],
      ['a', 10000, 2],
      ['b', 4000, 1],
      ['b', 5000, 2],
    ]);
    expect(thin[1]!.latitude).toBe(rows[5]!.latitude);
  });

  it('preserves the total sample count as weight', () => {
    const rows = raw('a', 3601);
    const thin = thinTrackRows(rows);
    expect(thin.reduce((acc, r) => acc + r.n, 0)).toBe(3601);
    expect(thin.length).toBe(Math.ceil(3601 / 5));
  });
});

describe('buildHeatTrack', () => {
  it('returns null under two points', () => {
    expect(buildHeatTrack('a', thinTrackRows(raw('a', 1)))).toBeNull();
  });

  it('builds weighted heat points, a simplified line and the extent', () => {
    const rows: ThinTrackRow[] = [
      { run_id: 'a', timestamp: 0, latitude: 45, longitude: 7, n: 5 },
      { run_id: 'a', timestamp: 5000, latitude: 45.0001, longitude: 7, n: 5 },
      { run_id: 'a', timestamp: 10000, latitude: 45.0002, longitude: 7, n: 3 },
    ];
    const track = buildHeatTrack('a', rows, 5)!;
    expect(track.heat.map((f) => f.properties.w)).toEqual([5, 5, 3]);
    expect(track.heat[0]!.geometry.coordinates).toEqual([7, 45]);
    // Collinear middle point is dropped from the trace, kept in the heat.
    expect(track.line.geometry.coordinates).toEqual([
      [7, 45],
      [7, 45.0002],
    ]);
    expect(track.extent).toEqual({ minLat: 45, maxLat: 45.0002, minLon: 7, maxLon: 7 });
  });
});

describe('createHeatTrackCache', () => {
  const source = [...raw('a', 20), ...raw('b', 20, 100_000), ...raw('c', 1)];
  const loadRows = (ids: readonly string[]) =>
    thinTrackRows(source.filter((r) => ids.includes(r.run_id)));

  it('loads only runs it has not built and keeps array identity when unchanged', () => {
    const spy = vi.fn(loadRows);
    const load = createHeatTrackCache(spy);

    const first = load(['b', 'a', 'c']);
    expect(first.map((t) => t.runId)).toEqual(['b', 'a']);
    expect(spy).toHaveBeenLastCalledWith(['b', 'a', 'c']);

    const second = load(['b', 'a', 'c']);
    expect(second).toBe(first);
    // 'c' has too little GPS to cache, so it is re-checked.
    expect(spy).toHaveBeenLastCalledWith(['c']);
  });

  it('drops deleted runs and reuses built tracks', () => {
    const spy = vi.fn(loadRows);
    const load = createHeatTrackCache(spy);
    const first = load(['b', 'a']);
    const after = load(['a']);
    expect(after.map((t) => t.runId)).toEqual(['a']);
    expect(after[0]).toBe(first[1]);
    expect(spy).toHaveBeenCalledTimes(1);

    const back = load(['b', 'a']);
    expect(back[0]).not.toBe(first[0]);
    expect(spy).toHaveBeenLastCalledWith(['b']);
  });
});

describe('mergeExtents', () => {
  it('is null without tracks and the union otherwise', () => {
    expect(mergeExtents([])).toBeNull();
    const a = buildHeatTrack('a', thinTrackRows(raw('a', 20)))!;
    const b = buildHeatTrack('b', [
      { run_id: 'b', timestamp: 0, latitude: 44, longitude: 8, n: 1 },
      { run_id: 'b', timestamp: 5000, latitude: 44.5, longitude: 8.5, n: 1 },
    ])!;
    expect(mergeExtents([a, b])).toEqual({
      minLat: 44,
      maxLat: a.extent.maxLat,
      minLon: 7,
      maxLon: 8.5,
    });
  });
});
