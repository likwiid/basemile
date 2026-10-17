// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Micro-benchmark of the History / Routes / Run-detail JS work on real data.
 * Skipped unless PERF=1 and the data fixture exists:
 *
 *   PERF=1 npx vitest run test/perf/history.perf.test.ts
 *
 * Node on a laptop is ~5-10x faster than Hermes on a Galaxy S10+/A55, and the
 * fixture db only models JS-side row materialisation (not SQLite I/O), so read
 * the numbers as relative. `rows` is the number of SQLite rows each path pulls.
 */
import { describe, expect, it } from 'vitest';

import { boundsForPoints } from '@/components/map/maplibre';
import { CHART_MAX_POINTS, extent, lttb } from '@/lib/charts/downsample';
import { buildElevationProfile, buildTerrainSeries, linePath } from '@/lib/charts/series';
import { decouplingForRun, stampDecoupling } from '@/lib/metrics/decoupling';
import { elevationPerSplit } from '@/lib/metrics/elevation';
import { decouplingTrendLoadingMissing, hasCurrentDecoupling } from '@/lib/metrics/historyTrends';
import { INJURY_RISK_LOOKBACK_MS, injuryRiskWarnings } from '@/lib/metrics/injuryRisk';
import { runReport } from '@/lib/metrics/insights';
import { loadSeries } from '@/lib/metrics/load';
import { weeklyMafDrift, weeklyZ2Minutes } from '@/lib/metrics/maf';
import { summarizeTerrainForDisplay } from '@/lib/metrics/terrain';
import { latestVdotFromRuns } from '@/lib/metrics/vdot';
import { aggregateZoneDistribution } from '@/lib/metrics/zones';
import {
  buildHeatTrack,
  createHeatTrackCache,
  mergeExtents,
  type HeatTrack,
} from '@/lib/route/heatTracks';
import { routeZoneSegments } from '@/lib/route/intelligence';
import { groupTracksByRun } from '@/lib/storage/tracks';
import type { CompletedRun, GpsPointRecord, HRSampleRecord, UserProfile, ZoneConfig } from '@/types';

import { loadFixture, type FixtureDb } from './fixture';
import {
  heatMapDerived,
  legacyElevationPath,
  legacyHistoryFocus,
  legacyHrPath,
  legacyRoutesTracks,
  legacyRunDetailLoad,
  legacyTerrainPaths,
  legacyTerrainSeries,
} from './legacy';

const fixture = process.env.PERF ? loadFixture() : null;
const WIDTH = 343; // 375 dp phone minus the 16 dp screen gutters
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function bench(label: string, fn: () => unknown, iterations = 30): number {
  for (let i = 0; i < 3; i++) fn();
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t = performance.now();
    fn();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)] ?? 0;
  console.log(`${label.padEnd(58)} ${median.toFixed(3).padStart(9)} ms`);
  return median;
}

function rowsFor(db: FixtureDb, fn: () => unknown): number {
  db.rowsRead = 0;
  fn();
  return db.rowsRead;
}

function startOfDay(ms: number): Date {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** History focus after: only runs when the data version moved. */
function optimizedHistoryReload(db: FixtureDb, profile: UserProfile, now: number, trends: boolean) {
  const runs = db.getAllRuns();
  const today = startOfDay(now);
  const drift = weeklyMafDrift(runs);
  const weeklyZ2 = weeklyZ2Minutes(runs, today);
  const load = loadSeries(runs, profile, today);
  const vdot = latestVdotFromRuns(runs);
  const decoupling = trends ? decouplingTrendLoadingMissing(runs, db.getHRSamples, db.getGpsPoints) : [];
  const cutoff = now - SEVEN_DAYS_MS;
  const z2 = runs.filter((r) => r.started_at >= cutoff).reduce((a, r) => a + r.zone_distribution.z2_sec, 0);
  return { drift, weeklyZ2, load, vdot, decoupling, z2 };
}

function enrichSplits(run: CompletedRun, gps: GpsPointRecord[]) {
  if (run.splits.length === 0 || gps.length < 2) return run.splits;
  const perKm = elevationPerSplit(gps);
  const byKm = new Map(perKm.map((e) => [e.km, e]));
  return run.splits.map((s) => {
    const e = byKm.get(s.km);
    return e ? { ...s, ascent_m: s.ascent_m ?? e.gain_m, descent_m: s.descent_m ?? e.loss_m } : s;
  });
}

/** Everything run/[id].tsx recomputed in its render body (no memo). */
function runDetailRenderMetrics(
  db: FixtureDb,
  run: CompletedRun,
  hr: HRSampleRecord[],
  gps: GpsPointRecord[],
  zones: ZoneConfig
) {
  const dist = hr.length > 1 ? aggregateZoneDistribution(hr, zones, run.pause_intervals ?? []) : run.zone_distribution;
  const withZones = { ...run, zone_distribution: dist };
  const risk = injuryRiskWarnings({ runs: db.getAllRuns(), now: run.ended_at });
  const terrain = summarizeTerrainForDisplay(gps, hr);
  const splits = enrichSplits(run, gps);
  const report = runReport(withZones, zones, hr, []);
  const decoupling = hasCurrentDecoupling(run) ? run.decoupling : stampDecoupling(decouplingForRun(hr, gps));
  return { dist, risk, terrain, splits, report, decoupling };
}

describe.skipIf(!fixture)('history perf harness (PERF=1)', () => {
  it('times the before/after paths on the real fixture', () => {
    const { db, profile, counts } = fixture!;
    console.log(`fixture: ${JSON.stringify(counts)}`);
    const now = Date.now();
    const nowDate = new Date(now);

    console.log('\n-- History tab focus --');
    const hBefore = bench('before: every focus (reads + all trends)', () =>
      legacyHistoryFocus(db, profile, nowDate)
    );
    const hRowsBefore = rowsFor(db, () => legacyHistoryFocus(db, profile, nowDate));
    const hAfterRuns = bench('after: data changed, Runs tab (no sample reads)', () =>
      optimizedHistoryReload(db, profile, now, false)
    );
    const hAfterTrends = bench('after: data changed, Trends tab (missing-only reads)', () =>
      optimizedHistoryReload(db, profile, now, true)
    );
    const hRowsAfter = rowsFor(db, () => optimizedHistoryReload(db, profile, now, true));
    console.log(`rows read per focus: before ${hRowsBefore}, after ${hRowsAfter} (changed) / 0 (unchanged)`);
    const missing = db.getAllRuns().filter((r) => !hasCurrentDecoupling(r)).length;
    console.log(`runs without persisted decoupling: ${missing}/${counts.runs}`);

    console.log('\n-- Routes tab focus --');
    const rBefore = bench('before: getAllRuns + getGpsPoints per run + heat map', () =>
      heatMapDerived(legacyRoutesTracks(db))
    );
    const rRowsBefore = rowsFor(db, () => legacyRoutesTracks(db));
    const rAfter = bench('after: data changed, lean track query + heat map', () =>
      heatMapDerived(groupTracksByRun(db.getRunIds(), db.getTrackRows()))
    );
    const rRowsAfter = rowsFor(db, () => groupTracksByRun(db.getRunIds(), db.getTrackRows()));
    console.log(`rows read per focus: before ${rRowsBefore}, after ${rRowsAfter} (changed) / 0 (unchanged)`);

    console.log('\n-- Run detail (longest GPS run) --');
    const runs = db.getAllRuns();
    const run = [...runs].sort(
      (a, b) => (db.gpsByRun.get(b.id)?.length ?? 0) - (db.gpsByRun.get(a.id)?.length ?? 0)
    )[0]!;
    const hr = db.getHRSamples(run.id);
    const gps = db.getGpsPoints(run.id);
    const cadence = db.getCadenceSamples(run.id);
    console.log(`run ${run.id}: ${hr.length} hr, ${gps.length} gps, ${cadence.length} cadence`);
    console.log(`RunMap zone segments (one GeoJSON source + layer each): ${routeZoneSegments(gps, hr, profile.zones).length}`);

    const series = legacyTerrainSeries(gps, hr, cadence);
    const series2 = buildTerrainSeries(gps, hr, cadence);
    const chartsBefore = () => {
      legacyHrPath(hr, WIDTH, 180);
      legacyElevationPath(gps, WIDTH, 180);
      legacyTerrainPaths(series, WIDTH, 190);
    };
    const chartsAfter = () => {
      const drawnHr = lttb(hr, CHART_MAX_POINTS, (s) => s.timestamp, (s) => s.bpm);
      extent(hr, (s) => s.bpm);
      linePath(drawnHr, (s) => s.timestamp, (s) => s.bpm);
      const profilePts = buildElevationProfile(gps);
      extent(profilePts, (p) => p.elevationM);
      linePath(lttb(profilePts, CHART_MAX_POINTS, (p) => p.distanceM, (p) => p.elevationM), (p) => p.distanceM, (p) => p.elevationM);
      // TerrainRunChart's series was already memoised before; only paths are compared.
      for (const lane of [series2.hr, series2.elevation, series2.pace, series2.cadence]) {
        extent(lane, (p) => p.value);
        linePath(lttb(lane, CHART_MAX_POINTS, (p) => p.timestamp, (p) => p.value), (p) => p.timestamp, (p) => p.value);
      }
    };
    const perRenderBefore = bench('before: per render (metrics + DB reads + chart paths)', () => {
      runDetailRenderMetrics(db, run, hr, gps, profile.zones);
      chartsBefore();
    });
    const chartBefore = bench('before: chart path building alone', chartsBefore);
    const chartAfter = bench('after: first render chart geometry (<=300 pts/path)', chartsAfter);
    const firstAfter = bench('after: first render (metrics + chart geometry)', () => {
      runDetailRenderMetrics(db, run, hr, gps, profile.zones);
      chartsAfter();
    });
    console.log('after: every later render (keystroke, toggle) — memo hits, ~0 ms');
    const hrPathLen = legacyHrPath(hr, WIDTH, 180).pathD.length;
    console.log(`HR path string: ${hrPathLen} chars before, <= ${CHART_MAX_POINTS} points after`);

    console.log('\n-- Summary (median ms, node) --');
    console.table({
      'History focus (unchanged data)': { before: hBefore, after: 0 },
      'History focus (changed, Runs tab)': { before: hBefore, after: hAfterRuns },
      'History focus (changed, Trends tab)': { before: hBefore, after: hAfterTrends },
      'Routes focus (unchanged data)': { before: rBefore, after: 0 },
      'Routes focus (changed)': { before: rBefore, after: rAfter },
      'Run detail re-render': { before: perRenderBefore, after: 0 },
      'Run detail chart geometry': { before: chartBefore, after: chartAfter },
      'Run detail first render': { before: perRenderBefore, after: firstAfter },
    });
    expect(hAfterTrends).toBeLessThan(hBefore);
  }, 120_000);

  it('times the run detail load, run map layers and the thinned heat map', () => {
    const { db, profile } = fixture!;
    const runs = db.getAllRuns();
    const run = [...runs].sort(
      (a, b) => (db.gpsByRun.get(b.id)?.length ?? 0) - (db.gpsByRun.get(a.id)?.length ?? 0)
    )[0]!;

    console.log('\n-- Run detail load (longest GPS run) --');
    const leanLoad = () => {
      const r = db.getRun(run.id)!;
      db.getHRSamples(run.id);
      db.getGpsPoints(run.id);
      db.getCadenceSamples(run.id);
      db.getRunsBefore(r.started_at, 3);
      db.getRunsSince(r.ended_at - INJURY_RISK_LOOKBACK_MS);
    };
    const loadBefore = bench('before: getRun + samples + getAllRuns x2 (every focus)', () =>
      legacyRunDetailLoad(db, run.id)
    );
    const loadAfter = bench('after: getRun + samples + windowed runs (once per id)', leanLoad);
    const loadRowsBefore = rowsFor(db, () => legacyRunDetailLoad(db, run.id));
    const loadRowsAfter = rowsFor(db, leanLoad);
    console.log(`rows read per open: before ${loadRowsBefore}, after ${loadRowsAfter}; per refocus: before ${loadRowsBefore}, after 0`);
    const riskBefore = bench('before: risk warnings per run change (getAllRuns)', () =>
      injuryRiskWarnings({ runs: db.getAllRuns(), now: run.ended_at })
    );
    const riskRuns = db.getRunsSince(run.ended_at - INJURY_RISK_LOOKBACK_MS);
    const riskAfter = bench('after: risk warnings on a context edit (windowed, no read)', () =>
      injuryRiskWarnings({ runs: riskRuns, now: run.ended_at })
    );

    console.log('\n-- RunMap native sources + layers --');
    let maxSegments = 0;
    let totalSegments = 0;
    for (const r of runs) {
      const n = routeZoneSegments(db.getGpsPoints(r.id), db.getHRSamples(r.id), profile.zones).length;
      maxSegments = Math.max(maxSegments, n);
      totalSegments += n;
    }
    console.log(`zone segments: max ${maxSegments} / run, ${totalSegments} over ${runs.length} runs; layers before = segments, after = 1`);

    console.log('\n-- Routes heat map (data changed) --');
    const ids = db.getRunIds();
    const heatBefore = bench('before: lean full-res tracks + GeoJSON', () =>
      heatMapDerived(groupTracksByRun(db.getRunIds(), db.getTrackRows()))
    );
    const heatCold = bench('after: cold cache (thinned rows + simplify + GeoJSON)', () =>
      heatMapFromTracks(createHeatTrackCache(db.getThinTrackRows)(db.getRunIds()))
    );
    const warm = createHeatTrackCache(db.getThinTrackRows);
    warm(ids);
    const heatWarm = bench('after: warm cache, no new run (ids query, same array)', () =>
      warm(db.getRunIds())
    );
    const newest = ids[0]!;
    const heatNewRun = bench('after: one new run saved (thin + build it, regroup GeoJSON)', () => {
      const rows = db.getThinTrackRows([newest]);
      buildHeatTrack(newest, rows);
      heatMapFromTracks(warm(ids));
    });
    const heatRowsBefore = rowsFor(db, () => groupTracksByRun(db.getRunIds(), db.getTrackRows()));
    const heatRowsCold = rowsFor(db, () => createHeatTrackCache(db.getThinTrackRows)(db.getRunIds()));
    const heatRowsWarm = rowsFor(db, () => warm(db.getRunIds()));
    const legacy = heatMapDerived(groupTracksByRun(ids, db.getTrackRows()));
    const tracks = warm(ids);
    const now = heatMapFromTracks(tracks);
    const lineCoords = (fc: { features: { geometry: { coordinates: unknown[] } }[] }) =>
      fc.features.reduce((acc, f) => acc + f.geometry.coordinates.length, 0);
    console.log(`rows across JSI: before ${heatRowsBefore}, after cold ${heatRowsCold}, warm ${heatRowsWarm}`);
    console.log(`heat point features to native: before ${legacy.heat.features.length}, after ${now.heat.features.length}`);
    console.log(`trace line coordinates to native: before ${lineCoords(legacy.lines)}, after ${lineCoords(now.lines)}`);

    console.log('\n-- This round (median ms, node) --');
    console.table({
      'Run detail open: reads': { before: loadBefore, after: loadAfter },
      'Run detail refocus': { before: loadBefore + riskBefore, after: 0 },
      'Run detail context edit: risk': { before: riskBefore, after: riskAfter },
      'Routes first focus (cold cache)': { before: heatBefore, after: heatCold },
      'Routes focus (new run saved)': { before: heatBefore, after: heatNewRun },
      'Routes focus (route rename etc.)': { before: heatBefore, after: heatWarm },
      'Routes focus (run viewed, notes)': { before: heatBefore, after: 0 },
    });
    expect(now.heat.features.length).toBeLessThan(legacy.heat.features.length);
    expect(loadRowsAfter).toBeLessThan(loadRowsBefore);
  }, 120_000);
});

/** RouteHeatMap's memos over cached heat tracks. */
function heatMapFromTracks(tracks: readonly HeatTrack[]) {
  const ext = mergeExtents(tracks);
  const bounds = ext
    ? boundsForPoints([
        { latitude: ext.minLat, longitude: ext.minLon },
        { latitude: ext.maxLat, longitude: ext.maxLon },
      ])
    : null;
  const heat = { type: 'FeatureCollection', features: tracks.flatMap((t) => t.heat) };
  const lines = { type: 'FeatureCollection', features: tracks.map((t) => t.line) };
  return { bounds, heat, lines };
}
