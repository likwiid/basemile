// SPDX-License-Identifier: GPL-3.0-or-later

import { MAF_WINDOW } from '@/config/constants';
import {
  avgInClosedWindowSorted,
  avgInHalfOpenWindowSorted,
  avgInSpans,
  buildNearestIndex,
  isSortedByTimestamp,
  nearestByTimestamp,
  type NearestIndex,
} from '@/lib/metrics/sampleIndex';
import { avgHrInWindow, haversineMeters } from '@/lib/run/distance';
import type {
  CadenceSample,
  GpsPoint,
  HRSample,
  SplitMetric,
  TerrainSegmentSummary,
  TerrainSegmentType,
} from '@/types';

// Grade is capped at ±30%; anything steeper on a road is noise, not terrain.
const MAX_GRADE = 0.3;
const MIN_GRADE = -0.3;
// Hard backstop on the cost multiplier so no single segment can absurdly over-
// or under-credit even at the grade cap (the curve reaches ~3.5x at 30%).
const MIN_MULTIPLIER = 0.5;
const MAX_MULTIPLIER = 2.5;
// Grade is measured over this horizontal window (not point-to-point) so a metre
// or two of elevation noise can't fake a steep spike — the root cause of GAP
// over-crediting steep climbs.
const GRADE_WINDOW_M = 30;
const MAX_SEGMENT_GAP_SEC = 30;
const MIN_SEGMENT_M = 1;

interface TerrainSegment {
  startMs: number;
  endMs: number;
  distanceM: number;
  durationSec: number;
  ascentM: number;
  descentM: number;
  grade: number;
  gapDurationSec: number;
  type: TerrainSegmentType;
}

export interface RunTerrainMetrics {
  ascent_m: number;
  descent_m: number;
  avg_gap_sec_per_km: number | null;
  maf_gap_pace_sec_per_km: number | null;
  splits: SplitMetric[];
  segment_summaries: TerrainSegmentSummary[];
}

export function gradeAdjustedPaceMultiplier(grade: number): number {
  const g = clamp(grade, MIN_GRADE, MAX_GRADE);
  // Asymmetric curve. Uphill: the Strava-style convex cost (well-calibrated:
  // ~1.29x at 6%, ~1.55x at 10%). Downhill: a shallower branch anchored to
  // Strava's *improved* GAP model — minimum ~0.88x near -9% grade, returning
  // to ~1.0 by -18% — because the symmetric uphill curve credits far too much
  // free speed on descents (it bottomed at 0.72x and treated -14% as easiest).
  const raw = g >= 0 ? 1 + 4.0 * g + 14.5 * g * g : 1 + 2.67 * g + 14.8 * g * g;
  return clamp(raw, MIN_MULTIPLIER, MAX_MULTIPLIER);
}

/** Cumulative horizontal (haversine) distance to each point, metres. */
function cumulativeHorizontalDistance(points: readonly GpsPoint[]): number[] {
  const cumulative: number[] = [0];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const step = prev && curr ? haversineMeters(prev, curr) : 0;
    cumulative.push((cumulative[i - 1] ?? 0) + step);
  }
  return cumulative;
}

/**
 * Local grade for the segment ending at `index`, measured over a horizontal
 * window of at least `windowM` metres centred on the point. Window-smoothing
 * (vs adjacent point-to-point) stops a metre or two of elevation noise from
 * faking a steep grade.
 */
export function windowedGrade(
  altitudes: readonly (number | null)[],
  cumulative: readonly number[],
  index: number,
  windowM = GRADE_WINDOW_M
): number {
  const center = cumulative[index] ?? 0;
  let lo = index - 1;
  let hi = index;
  while (lo > 0 && center - (cumulative[lo] ?? 0) < windowM / 2) lo -= 1;
  while (hi < cumulative.length - 1 && (cumulative[hi] ?? 0) - center < windowM / 2) hi += 1;
  const aLo = altitudes[lo] ?? null;
  const aHi = altitudes[hi] ?? null;
  const dx = (cumulative[hi] ?? 0) - (cumulative[lo] ?? 0);
  if (aLo === null || aHi === null || dx < 1) return 0;
  return (aHi - aLo) / dx;
}

/**
 * Elevation to use for grade: prefer DEM-corrected ground elevation, fall back
 * to raw GPS altitude. Mirrors lib/metrics/elevation.ts so GAP grade and the
 * elevation summary read off the same datum — raw GPS altitude is noisy enough
 * to make the same route's GAP differ run to run.
 */
export function pointElevation(p: GpsPoint): number | null {
  if (p.groundElevation != null && Number.isFinite(p.groundElevation)) {
    return p.groundElevation;
  }
  if (p.altitude != null && Number.isFinite(p.altitude)) {
    return p.altitude;
  }
  return null;
}

export function smoothedAltitude(points: readonly GpsPoint[], window = 5): (number | null)[] {
  const radius = Math.floor(window / 2);
  return points.map((_, index) => {
    let sum = 0;
    let count = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const p = points[index + offset];
      const elevation = p ? pointElevation(p) : null;
      if (elevation === null) continue;
      sum += elevation;
      count += 1;
    }
    return count > 0 ? sum / count : null;
  });
}

export function computeRunTerrainMetrics(
  points: readonly GpsPoint[],
  hrSamples: readonly HRSample[] = [],
  cadenceSamples: readonly CadenceSample[] = [],
  mafWindow: readonly [number, number] = MAF_WINDOW
): RunTerrainMetrics {
  const segments = terrainSegments(points);
  const totalDistance = sum(segments, (s) => s.distanceM);
  const totalGapSec = sum(segments, (s) => s.gapDurationSec);
  return {
    ascent_m: Math.round(sum(segments, (s) => s.ascentM)),
    descent_m: Math.round(sum(segments, (s) => s.descentM)),
    avg_gap_sec_per_km:
      totalDistance > 0 ? Math.round(totalGapSec / (totalDistance / 1000)) : null,
    maf_gap_pace_sec_per_km: mafGapPace(segments, hrSamples, mafWindow),
    splits: terrainSplits(segments, hrSamples, cadenceSamples),
    segment_summaries: summarizeTerrainSegments(segments, hrSamples),
  };
}

export function summarizeTerrainForDisplay(
  points: readonly GpsPoint[],
  hrSamples: readonly HRSample[] = []
): TerrainSegmentSummary[] {
  return summarizeTerrainSegments(terrainSegments(points), hrSamples);
}

function terrainSegments(points: readonly GpsPoint[]): TerrainSegment[] {
  if (points.length < 2) return [];
  const altitudes = smoothedAltitude(points);
  const cumulative = cumulativeHorizontalDistance(points);
  const segments: TerrainSegment[] = [];

  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    if (!prev || !curr) continue;
    const durationSec = (curr.timestamp - prev.timestamp) / 1000;
    if (durationSec <= 0 || durationSec > MAX_SEGMENT_GAP_SEC) continue;
    const distanceM = haversineMeters(prev, curr);
    if (distanceM < MIN_SEGMENT_M) continue;

    const prevAlt = altitudes[i - 1] ?? null;
    const currAlt = altitudes[i] ?? null;
    // Ascent/descent stay point-to-point so elevation totals are unaffected;
    // only the GAP grade is window-smoothed (the over-crediting fix).
    const rise = prevAlt !== null && currAlt !== null ? currAlt - prevAlt : 0;
    const grade = windowedGrade(altitudes, cumulative, i, GRADE_WINDOW_M);
    const paceSecPerKm = durationSec / (distanceM / 1000);
    const multiplier = gradeAdjustedPaceMultiplier(grade);
    segments.push({
      startMs: prev.timestamp,
      endMs: curr.timestamp,
      distanceM,
      durationSec,
      ascentM: Math.max(0, rise),
      descentM: Math.max(0, -rise),
      grade,
      gapDurationSec: (paceSecPerKm / multiplier) * (distanceM / 1000),
      type: terrainType(grade),
    });
  }

  return segments;
}

function terrainSplits(
  segments: readonly TerrainSegment[],
  hrSamples: readonly HRSample[],
  cadenceSamples: readonly CadenceSample[]
): SplitMetric[] {
  const splits: SplitMetric[] = [];
  let distanceCursor = 0;
  let splitDistance = 0;
  let splitDuration = 0;
  let splitGapDuration = 0;
  let splitAscent = 0;
  let splitDescent = 0;
  let splitStartMs = segments[0]?.startMs ?? 0;
  let splitEndMs = splitStartMs;
  // Sorted series (every DB read) get a binary-searched window per split;
  // anything else keeps the original full scan so results never differ.
  const hrSorted = isSortedByTimestamp(hrSamples);
  const cadenceSorted = isSortedByTimestamp(cadenceSamples);

  for (const segment of segments) {
    let remainingDistance = segment.distanceM;
    let segmentOffsetDistance = 0;
    while (remainingDistance > 0) {
      const needed = 1000 - splitDistance;
      const take = Math.min(needed, remainingDistance);
      const ratio = segment.distanceM > 0 ? take / segment.distanceM : 0;
      const offsetRatio = segment.distanceM > 0 ? segmentOffsetDistance / segment.distanceM : 0;
      const endRatio = segment.distanceM > 0 ? (segmentOffsetDistance + take) / segment.distanceM : 0;
      const startMs = segment.startMs + offsetRatio * (segment.endMs - segment.startMs);
      const endMs = segment.startMs + endRatio * (segment.endMs - segment.startMs);

      if (splitDistance === 0) splitStartMs = startMs;
      splitEndMs = endMs;
      splitDistance += take;
      splitDuration += segment.durationSec * ratio;
      splitGapDuration += segment.gapDurationSec * ratio;
      splitAscent += segment.ascentM * ratio;
      splitDescent += segment.descentM * ratio;
      distanceCursor += take;
      remainingDistance -= take;
      segmentOffsetDistance += take;

      if (splitDistance >= 999.5) {
        const avgHr = hrSorted
          ? avgInHalfOpenWindowSorted(hrSamples, bpmOf, splitStartMs, splitEndMs)
          : avgHrInWindow(hrSamples, splitStartMs, splitEndMs);
        splits.push({
          km: splits.length + 1,
          duration_sec: Math.round(splitDuration),
          avg_hr: avgHr ?? 0,
          gap_sec_per_km: Math.round(splitGapDuration),
          ascent_m: Math.round(splitAscent),
          descent_m: Math.round(splitDescent),
          avg_cadence_spm: cadenceSorted
            ? avgInClosedWindowSorted(cadenceSamples, spmOf, splitStartMs, splitEndMs)
            : avgCadenceInWindow(cadenceSamples, splitStartMs, splitEndMs),
        });
        splitDistance = 0;
        splitDuration = 0;
        splitGapDuration = 0;
        splitAscent = 0;
        splitDescent = 0;
        splitStartMs = splitEndMs;
      }
    }
  }

  void distanceCursor;
  return splits;
}

function mafGapPace(
  segments: readonly TerrainSegment[],
  hrSamples: readonly HRSample[],
  mafWindow: readonly [number, number] = MAF_WINDOW
): number | null {
  if (segments.length === 0 || hrSamples.length < 2) return null;
  let distanceM = 0;
  let gapSec = 0;
  const hrIndex = buildNearestIndex(hrSamples);
  for (const segment of segments) {
    const prevHr = nearestHr(hrIndex, segment.startMs);
    const currHr = nearestHr(hrIndex, segment.endMs);
    if (!prevHr || !currHr) continue;
    if (!isMaf(prevHr.bpm, mafWindow) || !isMaf(currHr.bpm, mafWindow)) continue;
    distanceM += segment.distanceM;
    gapSec += segment.gapDurationSec;
  }
  if (distanceM < 50 || gapSec <= 0) return null;
  return Math.round(gapSec / (distanceM / 1000));
}

function summarizeTerrainSegments(
  segments: readonly TerrainSegment[],
  hrSamples: readonly HRSample[]
): TerrainSegmentSummary[] {
  const order: TerrainSegmentType[] = ['descent', 'flat', 'climb', 'steep_climb'];
  return order
    .map((type) => {
      const matching = segments.filter((segment) => segment.type === type);
      const distanceM = sum(matching, (s) => s.distanceM);
      const durationSec = sum(matching, (s) => s.durationSec);
      const gapSec = sum(matching, (s) => s.gapDurationSec);
      return {
        type,
        distance_m: distanceM,
        duration_sec: durationSec,
        avg_hr: avgHrForSegments(hrSamples, matching),
        avg_pace_sec_per_km:
          distanceM > 0 && durationSec > 0 ? durationSec / (distanceM / 1000) : null,
        avg_gap_sec_per_km:
          distanceM > 0 && gapSec > 0 ? gapSec / (distanceM / 1000) : null,
      };
    })
    .filter((summary) => summary.distance_m >= 50);
}

/** Mean HR over samples inside any of the segments (closed bounds). */
function avgHrForSegments(
  hrSamples: readonly HRSample[],
  segments: readonly TerrainSegment[]
): number | null {
  if (hrSamples.length === 0 || segments.length === 0) return null;
  return avgInSpans(hrSamples, bpmOf, segments);
}

function terrainType(grade: number): TerrainSegmentType {
  if (grade < -0.02) return 'descent';
  if (grade > 0.06) return 'steep_climb';
  if (grade > 0.02) return 'climb';
  return 'flat';
}

/** Closest HR sample within 15 s; ties go to the earlier sample in the input. */
function nearestHr(index: NearestIndex<HRSample>, timestamp: number): HRSample | null {
  return nearestByTimestamp(index, timestamp, 15_000);
}

function bpmOf(sample: HRSample): number {
  return sample.bpm;
}

function spmOf(sample: CadenceSample): number {
  return sample.spm;
}

function avgCadenceInWindow(
  samples: readonly CadenceSample[],
  startMs: number,
  endMs: number
): number | null {
  let sumValue = 0;
  let count = 0;
  for (const sample of samples) {
    if (sample.timestamp < startMs || sample.timestamp > endMs) continue;
    sumValue += sample.spm;
    count += 1;
  }
  return count > 0 ? Math.round(sumValue / count) : null;
}

export function averageCadence(samples: readonly CadenceSample[]): number | null {
  if (samples.length === 0) return null;
  return Math.round(sum(samples, (sample) => sample.spm) / samples.length);
}

function isMaf(bpm: number, window: readonly [number, number] = MAF_WINDOW): boolean {
  return bpm >= window[0] && bpm <= window[1];
}

function sum<T>(values: readonly T[], score: (value: T) => number): number {
  return values.reduce((acc, value) => acc + score(value), 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
