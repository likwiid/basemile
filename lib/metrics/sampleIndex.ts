// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Timestamp lookups over sensor sample series (HR, cadence) that replace the
 * per-point linear scans terrain metrics used to run inside per-segment and
 * per-split loops. Every helper reproduces its linear-scan counterpart
 * exactly: same inclusion bounds, same tie-breaking, same summation order, and
 * the same handling of unsorted or non-finite timestamps (each one falls back
 * to an equivalent path instead of assuming sorted input).
 *
 * Pure, no native imports.
 */

export interface Timestamped {
  timestamp: number;
}

export interface TimeSpan {
  startMs: number;
  endMs: number;
}

/**
 * True when timestamps never decrease. A NaN timestamp fails every comparison,
 * so any series containing one (beyond a lone sample) reports unsorted.
 */
export function isSortedByTimestamp(samples: readonly Timestamped[]): boolean {
  for (let i = 1; i < samples.length; i += 1) {
    if (!((samples[i - 1]?.timestamp ?? 0) <= (samples[i]?.timestamp ?? 0))) return false;
  }
  return true;
}

/** First index in [lo, hi) whose timestamp is not below `timestamp` (hi when none). */
export function lowerBoundByTimestamp(
  samples: readonly Timestamped[],
  timestamp: number,
  lo = 0,
  hi = samples.length
): number {
  let left = lo;
  let right = hi;
  while (left < right) {
    const mid = (left + right) >>> 1;
    if ((samples[mid]?.timestamp ?? 0) < timestamp) left = mid + 1;
    else right = mid;
  }
  return left;
}

/**
 * Samples arranged for nearest-timestamp queries: sorted ascending, with each
 * entry's position in the caller's original array so ties resolve the way a
 * front-to-back scan would.
 */
export interface NearestIndex<T extends Timestamped> {
  sorted: readonly T[];
  /** Original array index per sorted entry; null when the input was already sorted. */
  originalIndex: readonly number[] | null;
}

/**
 * Prepare `samples` for `nearestByTimestamp`. Sorted input is used as is (no
 * copy). Otherwise a sorted copy is built once: NaN-timestamp samples are
 * dropped (a linear scan can never pick them, their distance is NaN) and equal
 * timestamps keep their original order.
 */
export function buildNearestIndex<T extends Timestamped>(samples: readonly T[]): NearestIndex<T> {
  if (isSortedByTimestamp(samples)) return { sorted: samples, originalIndex: null };
  const order: number[] = [];
  for (let i = 0; i < samples.length; i += 1) {
    if (!Number.isNaN(samples[i]?.timestamp)) order.push(i);
  }
  order.sort((a, b) => {
    const ta = samples[a]?.timestamp ?? 0;
    const tb = samples[b]?.timestamp ?? 0;
    if (ta < tb) return -1;
    if (ta > tb) return 1;
    return a - b;
  });
  const sorted: T[] = [];
  for (const i of order) {
    const sample = samples[i];
    if (sample) sorted.push(sample);
  }
  return { sorted, originalIndex: order };
}

/**
 * The sample closest in time to `timestamp`, or null when the closest one is
 * more than `maxDeltaMs` away. Identical to scanning the original array front
 * to back keeping the first strictly-closer sample: when two samples are
 * equally close, the one earlier in the original array wins.
 *
 * Only the nearest timestamp at or after the query and the nearest one before
 * it can hold the minimum distance, and the first entry of each run of equal
 * timestamps is the earliest of that run in the original array, so at most
 * two candidates need comparing.
 */
export function nearestByTimestamp<T extends Timestamped>(
  index: NearestIndex<T>,
  timestamp: number,
  maxDeltaMs: number
): T | null {
  const { sorted, originalIndex } = index;
  const after = lowerBoundByTimestamp(sorted, timestamp);
  const candidates: number[] = [];
  if (after > 0) {
    const beforeTs = sorted[after - 1]?.timestamp ?? 0;
    candidates.push(lowerBoundByTimestamp(sorted, beforeTs, 0, after - 1));
  }
  if (after < sorted.length) candidates.push(after);
  // Visit candidates in original-array order so `<` keeps the scan's tie-break.
  if (originalIndex && candidates.length === 2) {
    const [a = 0, b = 0] = candidates;
    if ((originalIndex[b] ?? 0) < (originalIndex[a] ?? 0)) candidates.reverse();
  }

  let best: T | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const i of candidates) {
    const sample = sorted[i];
    if (!sample) continue;
    const delta = Math.abs(sample.timestamp - timestamp);
    if (delta < bestDelta) {
      best = sample;
      bestDelta = delta;
    }
  }
  return bestDelta <= maxDeltaMs ? best : null;
}

/**
 * Rounded mean of `value` over samples with startMs <= timestamp < endMs, for
 * samples sorted by timestamp. Same result and summation order as a full
 * front-to-back scan with that predicate (lib/run/distance avgHrInWindow).
 */
export function avgInHalfOpenWindowSorted<T extends Timestamped>(
  samples: readonly T[],
  value: (sample: T) => number,
  startMs: number,
  endMs: number
): number | null {
  let sumValue = 0;
  let count = 0;
  for (let i = lowerBoundByTimestamp(samples, startMs); i < samples.length; i += 1) {
    const sample = samples[i];
    if (!sample) continue;
    if (!(sample.timestamp < endMs)) break;
    if (sample.timestamp >= startMs) {
      sumValue += value(sample);
      count += 1;
    }
  }
  return count > 0 ? Math.round(sumValue / count) : null;
}

/**
 * Rounded mean of `value` over samples NOT outside [startMs, endMs] (skips
 * timestamp < startMs or timestamp > endMs), for samples sorted by timestamp.
 * The negated predicate is deliberate: it matches the original cadence scan,
 * including its treatment of NaN window bounds.
 */
export function avgInClosedWindowSorted<T extends Timestamped>(
  samples: readonly T[],
  value: (sample: T) => number,
  startMs: number,
  endMs: number
): number | null {
  let sumValue = 0;
  let count = 0;
  for (let i = lowerBoundByTimestamp(samples, startMs); i < samples.length; i += 1) {
    const sample = samples[i];
    if (!sample) continue;
    if (sample.timestamp > endMs) break;
    if (sample.timestamp < startMs) continue;
    sumValue += value(sample);
    count += 1;
  }
  return count > 0 ? Math.round(sumValue / count) : null;
}

/**
 * Union of closed spans as sorted, disjoint closed spans. Spans whose bounds
 * cannot contain anything (start > end, or a NaN bound) are dropped.
 */
export function mergeClosedSpans(spans: readonly TimeSpan[]): TimeSpan[] {
  const valid: TimeSpan[] = [];
  for (const span of spans) {
    if (span.startMs <= span.endMs) valid.push({ startMs: span.startMs, endMs: span.endMs });
  }
  valid.sort((a, b) => (a.startMs < b.startMs ? -1 : a.startMs > b.startMs ? 1 : 0));
  const merged: TimeSpan[] = [];
  for (const span of valid) {
    const last = merged[merged.length - 1];
    if (last && span.startMs <= last.endMs) {
      if (span.endMs > last.endMs) last.endMs = span.endMs;
    } else {
      merged.push(span);
    }
  }
  return merged;
}

/** First index whose endMs is not below `timestamp` (merged spans have increasing ends). */
function firstSpanEndingAtOrAfter(spans: readonly TimeSpan[], timestamp: number): number {
  let left = 0;
  let right = spans.length;
  while (left < right) {
    const mid = (left + right) >>> 1;
    if ((spans[mid]?.endMs ?? 0) < timestamp) left = mid + 1;
    else right = mid;
  }
  return left;
}

/**
 * Rounded mean of `value` over samples whose timestamp falls inside at least
 * one closed span (startMs <= timestamp <= endMs), or null when none do.
 * Equivalent to testing every span per sample, in O((n + m) log m) instead of
 * O(n * m): the spans are merged once, then a cursor walks them alongside the
 * samples. Samples are summed in their original order; a sample earlier than
 * its predecessor (unsorted input) re-seeks the cursor by binary search.
 */
export function avgInSpans<T extends Timestamped>(
  samples: readonly T[],
  value: (sample: T) => number,
  spans: readonly TimeSpan[]
): number | null {
  const covered = mergeClosedSpans(spans);
  let sumValue = 0;
  let count = 0;
  let cursor = 0;
  let prevTs = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    const ts = sample.timestamp;
    if (ts >= prevTs) {
      while (cursor < covered.length && (covered[cursor]?.endMs ?? 0) < ts) cursor += 1;
    } else {
      cursor = firstSpanEndingAtOrAfter(covered, ts);
    }
    prevTs = ts;
    // covered[cursor] is the first span ending at or after ts; ts is inside the
    // union exactly when that span also starts at or before it.
    const span = covered[cursor];
    if (!span || !(span.startMs <= ts && ts <= span.endMs)) continue;
    sumValue += value(sample);
    count += 1;
  }
  return count > 0 ? Math.round(sumValue / count) : null;
}
