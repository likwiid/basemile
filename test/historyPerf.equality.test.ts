// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Proves every computation restructured for performance returns exactly what
 * the original code returned, on a real data dump. Skips cleanly when
 * the fixture file is absent (e.g. CI).
 */
import { describe, expect, it } from 'vitest';

import { boundsForPoints } from '@/components/map/maplibre';
import { CHART_MAX_POINTS, extent, lttb } from '@/lib/charts/downsample';
import { buildElevationProfile, buildTerrainSeries, linePath } from '@/lib/charts/series';
import { decouplingTrend } from '@/lib/metrics/decoupling';
import { decouplingTrendLoadingMissing, hasCurrentDecoupling } from '@/lib/metrics/historyTrends';
import { INJURY_RISK_LOOKBACK_MS, injuryRiskWarnings } from '@/lib/metrics/injuryRisk';
import { loadSeries } from '@/lib/metrics/load';
import { weeklyZ2Minutes } from '@/lib/metrics/maf';
import { createHeatTrackCache, mergeExtents } from '@/lib/route/heatTracks';
import { groupTracksByRun, type TrackRow } from '@/lib/storage/tracks';
import type { GpsPointRecord, HRSampleRecord } from '@/types';

import { loadFixture } from './perf/fixture';
import {
  heatMapDerived,
  legacyBuildProfile,
  legacyElevationPath,
  legacyHrPath,
  legacyRoutesTracks,
  legacyRunDetailLoad,
  legacyTerrainPaths,
  legacyTerrainSeries,
} from './perf/legacy';

const fixture = loadFixture();

function startOfDay(ms: number): Date {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d;
}

describe('groupTracksByRun', () => {
  it('orders tracks by the given run ids and fills gaps with empty tracks', () => {
    const rows: TrackRow[] = [
      { run_id: 'a', timestamp: 1, latitude: 1, longitude: 2 },
      { run_id: 'a', timestamp: 2, latitude: 3, longitude: 4 },
      { run_id: 'c', timestamp: 5, latitude: 5, longitude: 6 },
    ];
    expect(groupTracksByRun(['c', 'b', 'a'], rows)).toEqual([
      [{ timestamp: 5, latitude: 5, longitude: 6 }],
      [],
      [
        { timestamp: 1, latitude: 1, longitude: 2 },
        { timestamp: 2, latitude: 3, longitude: 4 },
      ],
    ]);
  });
});

describe.skipIf(!fixture)('perf restructuring is output-identical on the real fixture', () => {
  // Resolved lazily: describe bodies still run when the suite is skipped.
  const ctx = () => {
    const { db, profile } = fixture!;
    return { db, profile, runs: db.getAllRuns() };
  };

  it('decoupling trend: loading only missing runs == loading every run', () => {
    const { db, runs } = ctx();
    const allHr = new Map<string, HRSampleRecord[]>();
    const allGps = new Map<string, GpsPointRecord[]>();
    for (const run of runs) {
      allHr.set(run.id, db.getHRSamples(run.id));
      allGps.set(run.id, db.getGpsPoints(run.id));
    }
    const original = decouplingTrend(runs, allHr, allGps);

    const loaded: string[] = [];
    const lean = decouplingTrendLoadingMissing(
      runs,
      (id) => {
        loaded.push(id);
        return db.getHRSamples(id);
      },
      db.getGpsPoints
    );
    expect(lean).toStrictEqual(original);
    expect(loaded).toEqual(runs.filter((r) => !hasCurrentDecoupling(r)).map((r) => r.id));
    expect(original.length).toBeGreaterThan(0);

    // Also with nothing persisted: every run must then be computed from samples.
    const stripped = runs.map((r) => {
      const { decoupling: _unused, ...rest } = r;
      return rest;
    });
    expect(decouplingTrendLoadingMissing(stripped, db.getHRSamples, db.getGpsPoints)).toStrictEqual(
      decouplingTrend(stripped, allHr, allGps)
    );
  });

  it('day-keyed load and weekly Z2 == computing with the live clock', () => {
    const { profile, runs } = ctx();
    const base = runs[0]!.started_at;
    const probes = [
      Date.now(),
      base,
      base + 30 * 60_000,
      startOfDay(base).getTime() + 1,
      startOfDay(base).getTime() + 24 * 3600_000 - 1,
      base + 45 * 24 * 3600_000 + 12_345,
    ];
    for (const now of probes) {
      expect(loadSeries(runs, profile, startOfDay(now))).toStrictEqual(
        loadSeries(runs, profile, new Date(now))
      );
      expect(weeklyZ2Minutes(runs, startOfDay(now))).toStrictEqual(
        weeklyZ2Minutes(runs, new Date(now))
      );
    }
  });

  it('lean route tracks draw the same heat map as full getGpsPoints tracks', () => {
    const { db } = ctx();
    const legacy = legacyRoutesTracks(db);
    const lean = groupTracksByRun(db.getRunIds(), db.getTrackRows());
    expect(lean.length).toBe(legacy.length);
    lean.forEach((track, i) => {
      expect(track).toStrictEqual(
        (legacy[i] ?? []).map((p) => ({
          timestamp: p.timestamp,
          latitude: p.latitude,
          longitude: p.longitude,
        }))
      );
    });
    expect(heatMapDerived(lean)).toStrictEqual(heatMapDerived(legacy));
  });

  it('run detail windowed reads give the same previous runs and risk warnings', () => {
    const { db, runs } = ctx();
    for (const run of runs) {
      const legacy = legacyRunDetailLoad(db, run.id);
      expect(db.getRunsBefore(run.started_at, 3)).toStrictEqual(legacy.previousRuns);
      const windowed = db.getRunsSince(run.ended_at - INJURY_RISK_LOOKBACK_MS);
      expect(windowed.length).toBeLessThanOrEqual(legacy.riskRuns.length);
      expect(injuryRiskWarnings({ runs: windowed, now: run.ended_at })).toStrictEqual(
        injuryRiskWarnings({ runs: legacy.riskRuns, now: run.ended_at })
      );
    }
  });

  it('thinned heat tracks keep every raw sample as weight and the same frame', () => {
    const { db } = ctx();
    const runIds = db.getRunIds();
    const all = legacyRoutesTracks(db);
    const legacy = all.filter((t) => t.length >= 2);
    const legacyIds = runIds.filter((_, i) => (all[i]?.length ?? 0) >= 2);
    const tracks = createHeatTrackCache(db.getThinTrackRows)(runIds);
    expect(tracks.map((t) => t.runId)).toEqual(legacyIds);
    tracks.forEach((track, i) => {
      const raw = legacy[i]!;
      expect(track.heat.reduce((acc, f) => acc + f.properties.w, 0)).toBe(raw.length);
      expect(track.heat.length).toBeLessThanOrEqual(raw.length);
      const line = track.line.geometry.coordinates;
      expect(line[0]).toEqual([raw[0]!.longitude, raw[0]!.latitude]);
    });
    const before = heatMapDerived(legacy).bounds!;
    const extent = mergeExtents(tracks)!;
    const after = boundsForPoints([
      { latitude: extent.minLat, longitude: extent.minLon },
      { latitude: extent.maxLat, longitude: extent.maxLon },
    ])!;
    // Thinning only drops interior samples of a bucket; the frame barely moves.
    after.forEach((v, i) => expect(Math.abs(v - before[i]!)).toBeLessThan(0.002));
  });

  it('chart series builders and axis extents are unchanged; paths only thin out', () => {
    const { db, runs } = ctx();
    for (const run of runs) {
      const hr = db.getHRSamples(run.id);
      const gps = db.getGpsPoints(run.id);
      const cadence = db.getCadenceSamples(run.id);

      const profilePts = buildElevationProfile(gps);
      expect(profilePts).toStrictEqual(legacyBuildProfile(gps));
      const series = buildTerrainSeries(gps, hr, cadence);
      expect(series).toStrictEqual(legacyTerrainSeries(gps, hr, cadence));

      if (hr.length >= 2) {
        const legacyHr = legacyHrPath(hr, 343, 180);
        const [lo, hi] = extent(hr, (s) => s.bpm);
        expect([lo - 5, hi + 5]).toEqual([legacyHr.minBpm, legacyHr.maxBpm]);
        // Same scale + same formatter on the full trace reproduces the old path exactly.
        const innerW = 343 - 36 - 12;
        const innerH = 180 - 8 - 24;
        const t0 = hr[0]!.timestamp;
        const tSpan = Math.max(1, hr[hr.length - 1]!.timestamp - t0);
        const minBpm = lo - 5;
        const bpmSpan = Math.max(1, hi + 5 - minBpm);
        const x = (s: HRSampleRecord) => 36 + ((s.timestamp - t0) / tSpan) * innerW;
        const y = (s: HRSampleRecord) => 8 + innerH - ((s.bpm - minBpm) / bpmSpan) * innerH;
        expect(linePath(hr, x, y)).toBe(legacyHr.pathD);
        const drawn = lttb(hr, CHART_MAX_POINTS, (s) => s.timestamp, (s) => s.bpm);
        expect(drawn.length).toBe(Math.min(hr.length, CHART_MAX_POINTS));
        expect(drawn[0]).toBe(hr[0]);
        expect(drawn[drawn.length - 1]).toBe(hr[hr.length - 1]);
      }

      if (profilePts.length >= 2) {
        const legacyEl = legacyElevationPath(gps, 343, 180);
        const [minElev, maxElev] = extent(profilePts, (p) => p.elevationM);
        const pad = Math.max(2, (maxElev - minElev) * 0.08);
        expect([minElev - pad, maxElev + pad]).toEqual([legacyEl.yLo, legacyEl.yHi]);
      }

      if (series.startMs !== null && series.endMs !== null && series.elevation.length >= 2) {
        const legacyPaths = legacyTerrainPaths(series, 343, 190);
        for (const [lane, path] of [
          [series.hr, legacyPaths.hr],
          [series.elevation, legacyPaths.elevation],
          [series.pace, legacyPaths.pace],
        ] as const) {
          const values = lane.map((p) => p.value);
          expect(extent(lane, (p) => p.value)).toEqual([Math.min(...values), Math.max(...values)]);
          expect(path.split(' L ').length).toBe(Math.max(1, lane.length));
        }
      }
    }
  });
});
