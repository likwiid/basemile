// SPDX-License-Identifier: GPL-3.0-or-later

import type { HrvRecord, ReadinessLabel, ReadinessScore } from '@/types';

const ECTOPIC_TOLERANCE = 0.2;
const RUNNING_MEDIAN_WINDOW = 5;
// Canonical HRV baseline is a short rolling window (~7 days) of ln(rMSSD), with
// the "normal" band individualized to the athlete's own dispersion (Smallest
// Worthwhile Change ≈ 0.5 * SD), measured over a longer window for stability.
const BASELINE_WINDOW_DAYS = 7;
const SWC_WINDOW_DAYS = 60;
const BASELINE_LOOKBACK_FOR_QUORUM_DAYS = 14;
const MIN_READINGS_FOR_BASELINE = 3;
/** Fallback ln-space dispersion when there isn't enough data to estimate SD. */
const FALLBACK_LN_SD = 0.1;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Median of a non-empty number array. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const lo = sorted[mid - 1];
    const hi = sorted[mid];
    if (lo === undefined || hi === undefined) return 0;
    return (lo + hi) / 2;
  }
  const v = sorted[mid];
  return v ?? 0;
}

/**
 * Remove ectopic beats by dropping any RR more than ±20% off the running
 * median of the previous (up to) 5 accepted intervals. The first value is
 * always accepted; subsequent values seed the running window incrementally.
 */
export function cleanRrIntervals(rr: number[]): number[] {
  const finite = rr.filter((v) => Number.isFinite(v) && v > 0);
  if (finite.length === 0) return [];
  // Seed the running window from the GLOBAL median, not the first beat: chest
  // straps commonly emit one junk RR on first contact, and an unconditional
  // first-accept made that junk the sole reference — every normal beat after
  // it was then >20% away and rejected, zeroing the whole test.
  const globalRef = median(finite);

  const accepted: number[] = [];
  for (const interval of finite) {
    if (accepted.length === 0) {
      const delta = Math.abs(interval - globalRef) / globalRef;
      if (delta <= ECTOPIC_TOLERANCE) accepted.push(interval);
      continue;
    }
    const window = accepted.slice(-RUNNING_MEDIAN_WINDOW);
    const ref = median(window);
    if (ref <= 0) {
      accepted.push(interval);
      continue;
    }
    const delta = Math.abs(interval - ref) / ref;
    if (delta <= ECTOPIC_TOLERANCE) {
      accepted.push(interval);
    }
  }
  return accepted;
}

/**
 * Root-mean-square of successive RR-interval differences (ms).
 * Returns 0 if fewer than 2 intervals are supplied.
 */
export function computeRmssd(rrIntervals: number[]): number {
  if (rrIntervals.length < 2) return 0;
  let sumSq = 0;
  let count = 0;
  for (let i = 1; i < rrIntervals.length; i += 1) {
    const a = rrIntervals[i - 1];
    const b = rrIntervals[i];
    if (a === undefined || b === undefined) continue;
    const diff = b - a;
    sumSq += diff * diff;
    count += 1;
  }
  if (count === 0) return 0;
  return Math.sqrt(sumSq / count);
}

interface ReadinessBucket {
  label: ReadinessLabel;
  score: number;
  coachText: string;
}

/**
 * Band the latest reading by its z-score against the athlete's own baseline
 * dispersion. ±0.5 SD is the Smallest Worthwhile Change — inside it is "normal",
 * beyond it is a meaningful move. This individualizes the bands instead of using
 * one-size-fits-all ±10/20% thresholds.
 */
function bucketForZ(z: number): ReadinessBucket {
  if (z >= 0.5) return { label: 'good', score: 90, coachText: 'Ready to push' };
  if (z >= -0.5) return { label: 'good', score: 70, coachText: 'Solid baseline' };
  if (z >= -1.0) return { label: 'moderate', score: 50, coachText: 'Take it easy' };
  return { label: 'low', score: 25, coachText: 'Recovery day' };
}

function stdev(values: number[], avg: number): number {
  if (values.length < 2) return 0;
  let sumSq = 0;
  for (const v of values) sumSq += (v - avg) * (v - avg);
  return Math.sqrt(sumSq / (values.length - 1));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Compare the latest HRV reading to a 7-day rolling ln(rMSSD) baseline and band
 * it by the athlete's own dispersion (z-score vs ±0.5 SD = Smallest Worthwhile
 * Change). Returns 'unknown' when the user has fewer than 3 readings in the last
 * 14 days — not enough signal to coach off.
 */
export function computeReadiness(
  latest: HrvRecord | null,
  history: HrvRecord[],
): ReadinessScore {
  if (latest === null) {
    return {
      label: 'unknown',
      score: null,
      latest: null,
      baseline_rmssd_ms: null,
      coachText: 'Not enough data yet',
    };
  }

  const now = latest.measured_at;
  const recent = history.filter(
    (r) => now - r.measured_at <= BASELINE_LOOKBACK_FOR_QUORUM_DAYS * DAY_MS,
  );
  if (recent.length < MIN_READINGS_FOR_BASELINE) {
    return {
      label: 'unknown',
      score: null,
      latest,
      baseline_rmssd_ms: null,
      coachText: 'Not enough data yet',
    };
  }

  const lnOf = (r: HrvRecord): number => Math.log(r.rmssd_ms);
  // 7-day rolling baseline of ln(rMSSD), excluding the latest reading.
  const baselineSet = history.filter(
    (r) =>
      r.measured_at !== latest.measured_at &&
      r.rmssd_ms > 0 &&
      now - r.measured_at <= BASELINE_WINDOW_DAYS * DAY_MS,
  );
  if (baselineSet.length === 0 || latest.rmssd_ms <= 0) {
    return {
      label: 'unknown',
      score: null,
      latest,
      baseline_rmssd_ms: null,
      coachText: 'Not enough data yet',
    };
  }

  const baselineMean = mean(baselineSet.map(lnOf));
  // Dispersion (for the individualized SWC band) over a longer window so the SD
  // is stable; fall back to a fixed ln-space spread when there's too little.
  const dispersion = history
    .filter((r) => r.rmssd_ms > 0 && now - r.measured_at <= SWC_WINDOW_DAYS * DAY_MS)
    .map(lnOf);
  const sd = stdev(dispersion, mean(dispersion));
  const swc = sd > 0.01 ? sd : FALLBACK_LN_SD;

  const z = (Math.log(latest.rmssd_ms) - baselineMean) / swc;
  const bucket = bucketForZ(z);
  return {
    label: bucket.label,
    score: bucket.score,
    latest,
    baseline_rmssd_ms: round1(Math.exp(baselineMean)),
    coachText: bucket.coachText,
  };
}
