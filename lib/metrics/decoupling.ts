// SPDX-License-Identifier: GPL-3.0-or-later

import type {
  CompletedRun,
  DecouplingPoint,
  DecouplingResult,
  GpsPointRecord,
  HRSampleRecord,
  StoredDecoupling,
} from '@/types';

const MIN_DURATION_SEC = 30 * 60;
const MIN_DISTANCE_M = 3000;
// Halves must be at comparable effort for decoupling to mean anything, but 5
// bpm was strict enough that normal cardiac drift on a long run tripped it once
// the warm-up was trimmed. 8 bpm still keeps the halves comparable.
const MAX_HALF_HR_DELTA = 8;
const MAX_GPS_GAP_SEC = 30;
// HR lags effort at the start, so the first few minutes carry a spike that
// distorts first-half efficiency. Trim them before splitting into halves.
const WARMUP_TRIM_SEC = 5 * 60;

/**
 * Bumped when any decoupling parameter or the split method changes, so persisted
 * values from an older method are re-backfilled once instead of read as current.
 */
export const DECOUPLING_METHOD_VERSION = 1;

/** Stamp a freshly computed result with the current method version + params for persistence. */
export function stampDecoupling(result: DecouplingResult): StoredDecoupling {
  return {
    ...result,
    method_version: DECOUPLING_METHOD_VERSION,
    params: {
      warmup_trim_sec: WARMUP_TRIM_SEC,
      min_duration_sec: MIN_DURATION_SEC,
      min_distance_m: MIN_DISTANCE_M,
      max_half_hr_delta: MAX_HALF_HR_DELTA,
    },
  };
}

const EMPTY_RESULT: DecouplingResult = {
  first_half_efficiency: 0,
  second_half_efficiency: 0,
  decoupling_pct: 0,
  reliable: false,
};

function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

interface HalfStats {
  meanHr: number;
  distanceM: number;
  durationSec: number;
}

function meanHrInRange(
  samples: HRSampleRecord[],
  startMs: number,
  endMs: number
): number | null {
  let sum = 0;
  let count = 0;
  for (const s of samples) {
    // Half-open [start, end): a sample exactly at the midpoint lands in the
    // second half only, never both (the callers pass end+1 for the final half
    // so the last sample is still included).
    if (s.timestamp < startMs || s.timestamp >= endMs) continue;
    sum += s.bpm;
    count += 1;
  }
  if (count === 0) return null;
  return sum / count;
}

function distanceInRange(
  gps: GpsPointRecord[],
  startMs: number,
  endMs: number
): { meters: number; seconds: number } {
  let meters = 0;
  let seconds = 0;
  for (let i = 1; i < gps.length; i++) {
    const prev = gps[i - 1];
    const curr = gps[i];
    if (!prev || !curr) continue;
    // Assign each segment to the half holding its time-midpoint, so the segment
    // straddling the split is counted once (not dropped from both halves, and
    // not double-counted). Half-open [start, end).
    const segMid = (prev.timestamp + curr.timestamp) / 2;
    if (segMid < startMs || segMid >= endMs) continue;
    const dt = (curr.timestamp - prev.timestamp) / 1000;
    if (dt <= 0 || dt > MAX_GPS_GAP_SEC) continue;
    meters += haversineMeters(
      prev.latitude,
      prev.longitude,
      curr.latitude,
      curr.longitude
    );
    seconds += dt;
  }
  return { meters, seconds };
}

function halfStats(
  samples: HRSampleRecord[],
  gps: GpsPointRecord[],
  startMs: number,
  endMs: number
): HalfStats | null {
  const meanHr = meanHrInRange(samples, startMs, endMs);
  if (meanHr === null || meanHr <= 0) return null;
  const { meters, seconds } = distanceInRange(gps, startMs, endMs);
  if (meters <= 0 || seconds <= 0) return null;
  return { meanHr, distanceM: meters, durationSec: seconds };
}

/** Speed in m/sec divided by mean HR. Higher = more aerobic efficiency. */
function efficiencyFactor(stats: HalfStats): number {
  const speedMPerSec = stats.distanceM / stats.durationSec;
  return speedMPerSec / stats.meanHr;
}

export function decouplingForRun(
  samples: HRSampleRecord[],
  gps: GpsPointRecord[]
): DecouplingResult {
  if (samples.length < 2 || gps.length < 2) return EMPTY_RESULT;

  const sortedSamples = [...samples].sort((a, b) => a.timestamp - b.timestamp);
  const sortedGps = [...gps].sort((a, b) => a.timestamp - b.timestamp);

  const firstSample = sortedSamples[0];
  const lastSample = sortedSamples[sortedSamples.length - 1];
  const firstGps = sortedGps[0];
  const lastGps = sortedGps[sortedGps.length - 1];
  if (!firstSample || !lastSample || !firstGps || !lastGps) return EMPTY_RESULT;

  const rawStartMs = Math.min(firstSample.timestamp, firstGps.timestamp);
  const endMs = Math.max(lastSample.timestamp, lastGps.timestamp);
  if (endMs <= rawStartMs) return EMPTY_RESULT;

  // Drop the warm-up window, but only when enough run remains to still analyse.
  const trimmedStartMs = rawStartMs + WARMUP_TRIM_SEC * 1000;
  const startMs =
    endMs - trimmedStartMs >= MIN_DURATION_SEC * 1000 ? trimmedStartMs : rawStartMs;

  const midMs = startMs + (endMs - startMs) / 2;

  // Split at the midpoint with half-open ranges; +1 ms on the final bound keeps
  // the last sample/segment inclusive without overlapping the first half.
  const first = halfStats(sortedSamples, sortedGps, startMs, midMs);
  const second = halfStats(sortedSamples, sortedGps, midMs, endMs + 1);
  if (!first || !second) return EMPTY_RESULT;

  const eff1 = efficiencyFactor(first);
  const eff2 = efficiencyFactor(second);
  if (!Number.isFinite(eff1) || !Number.isFinite(eff2) || eff1 <= 0) {
    return EMPTY_RESULT;
  }

  const decouplingPct = ((eff1 - eff2) / eff1) * 100;

  const totalDurationSec = (endMs - startMs) / 1000;
  const totalDistanceM = first.distanceM + second.distanceM;
  const hrDelta = Math.abs(first.meanHr - second.meanHr);
  const reliable =
    totalDurationSec >= MIN_DURATION_SEC &&
    totalDistanceM > MIN_DISTANCE_M &&
    hrDelta <= MAX_HALF_HR_DELTA;

  return {
    first_half_efficiency: eff1,
    second_half_efficiency: eff2,
    decoupling_pct: decouplingPct,
    reliable,
  };
}

export function decouplingTrend(
  runs: CompletedRun[],
  samplesByRun: Map<string, HRSampleRecord[]>,
  gpsByRun: Map<string, GpsPointRecord[]>
): DecouplingPoint[] {
  const points: DecouplingPoint[] = [];
  for (const run of runs) {
    // Prefer the persisted value so the trend matches the run detail and stays
    // stable across app versions; fall back to computing for not-yet-backfilled runs.
    const stored =
      run.decoupling && run.decoupling.method_version === DECOUPLING_METHOD_VERSION
        ? run.decoupling
        : null;
    const result =
      stored ?? decouplingForRun(samplesByRun.get(run.id) ?? [], gpsByRun.get(run.id) ?? []);
    if (!result.reliable) continue;
    points.push({
      run_id: run.id,
      started_at: run.started_at,
      decoupling_pct: result.decoupling_pct,
    });
  }
  return points.sort((a, b) => a.started_at - b.started_at);
}
