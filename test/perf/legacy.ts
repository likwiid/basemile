// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Verbatim copies of the pre-optimisation screen/chart code paths, kept only
 * as the "before" side of the perf harness and the reference for the equality
 * tests. Do not import from app code.
 */
import {
  boundsForPoints,
  lineString,
  pointsCollection,
  toLngLat,
} from '@/components/map/maplibre';
import { decouplingTrend } from '@/lib/metrics/decoupling';
import { loadSeries } from '@/lib/metrics/load';
import { weeklyMafDrift, weeklyZ2Minutes } from '@/lib/metrics/maf';
import { latestVdotFromRuns } from '@/lib/metrics/vdot';
import { haversineMeters, paceFromPoints } from '@/lib/run/distance';
import type {
  CadenceSampleRecord,
  CompletedRun,
  GpsPoint,
  GpsPointRecord,
  HRSampleRecord,
  UserProfile,
} from '@/types';

import type { FixtureDb } from './fixture';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** app/(tabs)/history.tsx before: every focus re-read + re-derived everything. */
export function legacyHistoryFocus(db: FixtureDb, profile: UserProfile, now: Date) {
  const runs = db.getAllRuns();
  const drift = weeklyMafDrift(runs);
  const weeklyZ2 = weeklyZ2Minutes(runs, now);
  const load = loadSeries(runs, profile, now);
  const vdot = latestVdotFromRuns(runs);
  let decoupling: ReturnType<typeof decouplingTrend> = [];
  if (runs.length > 0) {
    const samples = new Map<string, HRSampleRecord[]>();
    const gps = new Map<string, GpsPointRecord[]>();
    for (const r of runs) {
      samples.set(r.id, db.getHRSamples(r.id));
      gps.set(r.id, db.getGpsPoints(r.id));
    }
    decoupling = decouplingTrend(runs, samples, gps);
  }
  const cutoff = now.getTime() - SEVEN_DAYS_MS;
  const z2Sec = runs
    .filter((r) => r.started_at >= cutoff)
    .reduce((acc, r) => acc + r.zone_distribution.z2_sec, 0);
  return { runs, drift, weeklyZ2, load, vdot, decoupling, z2LastSevenDaysMin: Math.round(z2Sec / 60) };
}

/** app/(tabs)/routes.tsx focus before. */
export function legacyRoutesTracks(db: FixtureDb): GpsPoint[][] {
  return db.getAllRuns().map((run) => db.getGpsPoints(run.id));
}

/** app/run/[id].tsx before: the focus handler's reads plus riskWarnings' second getAllRuns. */
export function legacyRunDetailLoad(db: FixtureDb, runId: string) {
  const run = db.getRun(runId);
  const hr = db.getHRSamples(runId);
  const gps = db.getGpsPoints(runId);
  const cadence = db.getCadenceSamples(runId);
  const previousRuns = run
    ? db
        .getAllRuns()
        .filter((r) => r.id !== runId && r.started_at < run.started_at)
        .slice(0, 3)
    : [];
  const riskRuns = db.getAllRuns();
  return { run, hr, gps, cadence, previousRuns, riskRuns };
}

/** RouteHeatMap's derived GeoJSON before the thinned, cached tracks. */
export function heatMapDerived(tracks: readonly (readonly GpsPoint[])[]) {
  const nonEmpty = tracks.filter((t) => t.length >= 2).map((t) => t.slice());
  const allPoints = nonEmpty.flat();
  const bounds = boundsForPoints(allPoints);
  const heat = pointsCollection(allPoints);
  const lines = {
    type: 'FeatureCollection',
    features: nonEmpty.map((t) => lineString(t.map(toLngLat))),
  };
  return { bounds, heat, lines };
}

// ---------------------------------------------------------------------------
// Chart geometry before (HRTimeChart / ElevationProfileChart / TerrainRunChart)
// ---------------------------------------------------------------------------

const HR_PAD = { top: 8, right: 12, bottom: 24, left: 36 };

export function legacyHrPath(samples: HRSampleRecord[], width: number, height: number) {
  const innerW = Math.max(0, width - HR_PAD.left - HR_PAD.right);
  const innerH = Math.max(0, height - HR_PAD.top - HR_PAD.bottom);
  const t0 = samples[0]?.timestamp ?? 0;
  const tEnd = samples[samples.length - 1]?.timestamp ?? t0;
  const tSpan = Math.max(1, tEnd - t0);
  const sampleBpms = samples.map((s) => s.bpm);
  const minBpm = Math.min(...sampleBpms) - 5;
  const maxBpm = Math.max(...sampleBpms) + 5;
  const bpmSpan = Math.max(1, maxBpm - minBpm);
  const xFor = (ts: number) => HR_PAD.left + ((ts - t0) / tSpan) * innerW;
  const yFor = (bpm: number) => HR_PAD.top + innerH - ((bpm - minBpm) / bpmSpan) * innerH;
  const pathD = samples
    .map((s, i) => `${i === 0 ? 'M' : 'L'} ${xFor(s.timestamp).toFixed(1)} ${yFor(s.bpm).toFixed(1)}`)
    .join(' ');
  return { minBpm, maxBpm, pathD };
}

function chosenElevation(p: GpsPointRecord): number | null {
  if (p.groundElevation != null && Number.isFinite(p.groundElevation)) return p.groundElevation;
  if (p.altitude != null && Number.isFinite(p.altitude)) return p.altitude;
  return null;
}

export function legacyBuildProfile(points: GpsPointRecord[]) {
  const profile: { distanceM: number; elevationM: number }[] = [];
  let cumulative = 0;
  let prev: GpsPointRecord | null = null;
  for (const p of points) {
    if (prev) {
      const step = haversineMeters(prev, p);
      if (Number.isFinite(step)) cumulative += step;
    }
    prev = p;
    const elevationM = chosenElevation(p);
    if (elevationM !== null) profile.push({ distanceM: cumulative, elevationM });
  }
  return profile;
}

const EL_PAD = { top: 8, right: 12, bottom: 24, left: 40 };

export function legacyElevationPath(points: GpsPointRecord[], width: number, height: number) {
  const profile = legacyBuildProfile(points);
  const innerW = Math.max(0, width - EL_PAD.left - EL_PAD.right);
  const innerH = Math.max(0, height - EL_PAD.top - EL_PAD.bottom);
  const distEnd = profile[profile.length - 1]?.distanceM ?? 0;
  const distSpan = Math.max(1, distEnd);
  const elevs = profile.map((p) => p.elevationM);
  const minElev = Math.min(...elevs);
  const maxElev = Math.max(...elevs);
  const pad = Math.max(2, (maxElev - minElev) * 0.08);
  const yLo = minElev - pad;
  const yHi = maxElev + pad;
  const elevSpan = Math.max(1, yHi - yLo);
  const xFor = (d: number) => EL_PAD.left + (d / distSpan) * innerW;
  const yFor = (e: number) => EL_PAD.top + innerH - ((e - yLo) / elevSpan) * innerH;
  const lineD = profile
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(p.distanceM).toFixed(1)} ${yFor(p.elevationM).toFixed(1)}`)
    .join(' ');
  return { yLo, yHi, lineD };
}

interface ChartPoint {
  timestamp: number;
  value: number;
}

export function legacyTerrainSeries(
  gps: readonly GpsPointRecord[],
  hr: readonly HRSampleRecord[],
  cadence: readonly CadenceSampleRecord[]
) {
  const startMs = Math.min(gps[0]?.timestamp ?? Infinity, hr[0]?.timestamp ?? Infinity);
  const endMs = Math.max(
    gps[gps.length - 1]?.timestamp ?? -Infinity,
    hr[hr.length - 1]?.timestamp ?? -Infinity
  );
  const elevation = gps
    .filter((point) => point.altitude !== null && point.altitude !== undefined)
    .map((point) => ({ timestamp: point.timestamp, value: point.altitude ?? 0 }));
  const pace = gps
    .map((point, index) => {
      const window = gps.slice(Math.max(0, index - 3), index + 1);
      const paceValue = paceFromPoints(window, 30_000);
      return paceValue ? { timestamp: point.timestamp, value: paceValue } : null;
    })
    .filter((point): point is ChartPoint => point !== null);
  const hrSeries = hr.map((sample) => ({ timestamp: sample.timestamp, value: sample.bpm }));
  const cadenceSeries = cadence.map((sample) => ({ timestamp: sample.timestamp, value: sample.spm }));
  return {
    startMs: Number.isFinite(startMs) ? startMs : null,
    endMs: Number.isFinite(endMs) ? endMs : null,
    elevation,
    pace,
    hr: hrSeries,
    cadence: cadenceSeries,
  };
}

const TR_PAD = { top: 12, right: 8, bottom: 12, left: 8 };

/** TerrainRunChart's per-render path building (it was not memoised). */
export function legacyTerrainPaths(
  series: ReturnType<typeof legacyTerrainSeries>,
  width: number,
  height: number
) {
  const innerW = Math.max(1, width - TR_PAD.left - TR_PAD.right);
  const hasCadence = series.cadence.length >= 2;
  const lanes = hasCadence ? 4 : 3;
  const laneH = (height - TR_PAD.top - TR_PAD.bottom) / lanes;
  const xFor = (timestamp: number) =>
    TR_PAD.left + ((timestamp - series.startMs!) / (series.endMs! - series.startMs!)) * innerW;
  const pathFor = (values: readonly ChartPoint[], lane: number, invert = false) => {
    const nums = values.map((v) => v.value);
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const span = Math.max(1, max - min);
    return values
      .map((point, index) => {
        const normalized = (point.value - min) / span;
        const y = TR_PAD.top + lane * laneH + (invert ? normalized : 1 - normalized) * (laneH - 10) + 5;
        return `${index === 0 ? 'M' : 'L'} ${xFor(point.timestamp).toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  };
  return {
    hr: pathFor(series.hr, 0),
    elevation: pathFor(series.elevation, 1),
    pace: pathFor(series.pace, 2, true),
    cadence: hasCadence ? pathFor(series.cadence, 3) : null,
  };
}

export type { CompletedRun };
