// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Pure chart geometry for the run-detail SVG charts, lifted out of the
 * components so it can be memoised there and benchmarked in node. The series
 * builders are unchanged from the component-local versions; only path
 * construction is new (it draws a downsampled copy, see ./downsample).
 */
import { haversineMeters, paceFromPoints } from '@/lib/run/distance';
import type { CadenceSampleRecord, GpsPointRecord, HRSampleRecord } from '@/types';

/** `M x y L x y …` with one decimal — the format every chart path uses. */
export function linePath<T>(
  data: readonly T[],
  x: (d: T) => number,
  y: (d: T) => number
): string {
  return data
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(d).toFixed(1)} ${y(d).toFixed(1)}`)
    .join(' ');
}

/** A point that carries a usable elevation, with its along-track distance. */
export interface ProfilePoint {
  distanceM: number;
  elevationM: number;
}

/** Prefer DEM-corrected ground elevation, fall back to raw GPS altitude. */
function chosenElevation(p: GpsPointRecord): number | null {
  if (p.groundElevation != null && Number.isFinite(p.groundElevation)) {
    return p.groundElevation;
  }
  if (p.altitude != null && Number.isFinite(p.altitude)) {
    return p.altitude;
  }
  return null;
}

/**
 * Build the cumulative-distance + elevation series. Distance accumulates over
 * every valid coordinate (so gaps in elevation don't collapse the x-axis), but
 * only points with a usable elevation become plottable profile points.
 */
export function buildElevationProfile(points: readonly GpsPointRecord[]): ProfilePoint[] {
  const profile: ProfilePoint[] = [];
  let cumulative = 0;
  let prev: GpsPointRecord | null = null;

  for (const p of points) {
    if (prev) {
      const step = haversineMeters(prev, p);
      if (Number.isFinite(step)) cumulative += step;
    }
    prev = p;

    const elevationM = chosenElevation(p);
    if (elevationM !== null) {
      profile.push({ distanceM: cumulative, elevationM });
    }
  }

  return profile;
}

export interface ChartPoint {
  timestamp: number;
  value: number;
}

export interface TerrainSeries {
  startMs: number | null;
  endMs: number | null;
  elevation: ChartPoint[];
  pace: ChartPoint[];
  hr: ChartPoint[];
  cadence: ChartPoint[];
}

export function buildTerrainSeries(
  gps: readonly GpsPointRecord[],
  hr: readonly HRSampleRecord[],
  cadence: readonly CadenceSampleRecord[]
): TerrainSeries {
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
  const cadenceSeries = cadence.map((sample) => ({
    timestamp: sample.timestamp,
    value: sample.spm,
  }));
  return {
    startMs: Number.isFinite(startMs) ? startMs : null,
    endMs: Number.isFinite(endMs) ? endMs : null,
    elevation,
    pace,
    hr: hrSeries,
    cadence: cadenceSeries,
  };
}
