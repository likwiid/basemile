// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Pure elevation engine for BaseMile.
 *
 * NO imports from db.ts or any expo/native module — this file must stay
 * unit-testable in plain node. The only dependency is the pure haversine
 * helper from lib/run/distance.ts and the shared config/types.
 *
 * Three responsibilities:
 *  1. `computeElevationStats` — full post-run summary (gain/loss/net + a
 *     per-segment data-quality breakdown) over a stored GPS track. Prefers
 *     DEM-corrected `groundElevation` per point, falling back to raw
 *     `altitude`.
 *  2. `elevationPerSplit` — gain/loss bucketed per kilometer for SplitMetric.
 *  3. `liveElevationStep` — an allocation-light streaming reducer the live
 *     run store calls at ~1 Hz.
 */

import { ELEVATION } from '@/config/constants';
import { haversineMeters } from '@/lib/run/distance';
import type {
  ElevationQuality,
  ElevationSegment,
  ElevationSource,
  ElevationStats,
  GpsPointRecord,
  SplitMetric,
} from '@/types';

/**
 * A single elevation step larger than this (m) is physically impossible between
 * adjacent fixes for a runner and signals a GPS/barometric glitch or a DEM
 * re-acquisition. Such a step re-baselines the reference WITHOUT accumulating
 * phantom gain/loss. Applied by both the batch summers and the live reducer so
 * a glitch can't inflate gain even when DEM correction is unavailable.
 */
const MAX_STEP_DELTA_M = 40;

/** Empty/zeroed stats returned when a track is too short to be meaningful. */
function emptyStats(): ElevationStats {
  return {
    total_gain_m: 0,
    total_loss_m: 0,
    net_m: 0,
    max_elevation_m: 0,
    min_elevation_m: 0,
    start_elevation_m: 0,
    end_elevation_m: 0,
    source: 'gps',
    corrected: false,
    coverage_pct: 0,
    segments: [],
  };
}

/**
 * Pick the elevation value to use for a point: prefer DEM-corrected ground
 * elevation, fall back to raw GPS altitude. Returns null when neither is a
 * finite number.
 */
function chosenElevation(p: GpsPointRecord): number | null {
  if (p.groundElevation != null && Number.isFinite(p.groundElevation)) {
    return p.groundElevation;
  }
  if (p.altitude != null && Number.isFinite(p.altitude)) {
    return p.altitude;
  }
  return null;
}

/** True when this point carries a usable DEM-corrected ground elevation. */
function isCorrected(p: GpsPointRecord): boolean {
  return p.groundElevation != null && Number.isFinite(p.groundElevation);
}

/**
 * Classify a single point's elevation data quality.
 *  - 'corrected' if it has a DEM ground elevation.
 *  - else, by best available accuracy (vertical if present, else horizontal):
 *    ≤ GOOD_ACCURACY_M → 'good', ≤ POOR_ACCURACY_M → 'fair', else 'poor'.
 *  - 'missing' when the point has no usable elevation at all.
 */
function classifyPoint(p: GpsPointRecord): ElevationQuality {
  if (isCorrected(p)) return 'corrected';
  if (chosenElevation(p) === null) return 'missing';

  const acc =
    p.altitudeAccuracy != null && Number.isFinite(p.altitudeAccuracy)
      ? p.altitudeAccuracy
      : p.accuracy != null && Number.isFinite(p.accuracy)
        ? p.accuracy
        : null;

  // No accuracy estimate at all but we do have an elevation: treat as 'fair'.
  if (acc === null) return 'fair';
  if (acc <= ELEVATION.GOOD_ACCURACY_M) return 'good';
  if (acc <= ELEVATION.POOR_ACCURACY_M) return 'fair';
  return 'poor';
}

/**
 * Moving-average smoother over a series that may contain nulls. Nulls are
 * skipped (they neither contribute to nor receive a smoothed value — they
 * stay null). The window is centered and clamped at the edges.
 */
function smooth(series: (number | null)[], window: number): (number | null)[] {
  if (window <= 1) return series.slice();
  const half = Math.floor(window / 2);
  const out: (number | null)[] = new Array(series.length).fill(null);

  for (let i = 0; i < series.length; i++) {
    if (series[i] == null) continue; // leave null points as null
    let sum = 0;
    let count = 0;
    const lo = Math.max(0, i - half);
    const hi = Math.min(series.length - 1, i + half);
    for (let j = lo; j <= hi; j++) {
      const v = series[j];
      if (v != null) {
        sum += v;
        count += 1;
      }
    }
    out[i] = count > 0 ? sum / count : null;
  }
  return out;
}

/**
 * Smoothing that preserves glitch steps. A plain moving average smears a raw
 * spike/offset of amplitude A into steps of A/window, so anything with
 * A ≤ MAX_STEP_DELTA_M·window slipped UNDER the 40 m glitch guard and was
 * counted as real gain+loss (e.g. one 150 m GPS spike → +30/−30 m phantom on
 * flat ground, while the live reducer correctly rejected it). Splitting the
 * series at raw discontinuities > MAX_STEP_DELTA_M and smoothing each segment
 * independently keeps the sharp step in the smoothed output, so the existing
 * guard re-baselines it — isolated spikes AND persistent re-acquisition
 * offsets now both accumulate nothing, matching the guard's documented intent.
 */
function smoothSegmented(
  series: (number | null)[],
  window: number,
  corrected: readonly boolean[]
): (number | null)[] {
  const out: (number | null)[] = new Array(series.length).fill(null);
  let segStart = 0;
  let lastVal: number | null = null;
  let lastIdx = -1;

  const flush = (endExclusive: number): void => {
    if (endExclusive <= segStart) return;
    const part = smooth(series.slice(segStart, endExclusive), window);
    for (let k = 0; k < part.length; k++) out[segStart + k] = part[k] ?? null;
  };

  for (let i = 0; i < series.length; i++) {
    const v = series[i];
    if (v == null) continue;
    // Only a GPS-ALTITUDE discontinuity marks a sensor glitch. DEM values are
    // server data — a large step there is real terrain (ravine/bridge cells)
    // that must keep flowing through the smoother, or audit-verified stored
    // gains would silently change.
    const gpsSourced = !corrected[i] && (lastIdx < 0 || !corrected[lastIdx]);
    if (
      lastVal !== null &&
      gpsSourced &&
      Math.abs(v - lastVal) > MAX_STEP_DELTA_M
    ) {
      flush(i); // discontinuity: close the segment before this point
      segStart = i;
    }
    lastVal = v;
    lastIdx = i;
  }
  flush(series.length);
  return out;
}

/**
 * Compute the full elevation summary + data-quality segment breakdown for a
 * stored GPS track.
 *
 * Algorithm:
 *  - Per point choose `groundElevation` (corrected) when present, else
 *    `altitude`. The mix of corrected vs raw points sets `source`
 *    ('dem' all corrected, 'gps' none, 'hybrid' mixed) and `corrected`.
 *  - Smooth the chosen series with a moving average (window
 *    ELEVATION.SMOOTHING_WINDOW), skipping nulls.
 *  - Sum positive deltas ≥ MIN_STEP_DELTA_M into gain, negative into loss.
 *  - net_m = end_elevation − start_elevation (first/last reliable points).
 *  - coverage_pct = points with usable elevation / total points.
 *  - Merge contiguous same-quality points into ElevationSegment[] with signed
 *    delta_m and haversine distance_m.
 *
 * Never throws: a track shorter than ELEVATION.MIN_POINTS returns zeroed,
 * empty-safe stats.
 */
export function computeElevationStats(points: GpsPointRecord[]): ElevationStats {
  if (points.length < ELEVATION.MIN_POINTS) return emptyStats();

  // Raw chosen elevation per point (null where unusable).
  const raw: (number | null)[] = points.map(chosenElevation);
  const smoothed = smoothSegmented(raw, ELEVATION.SMOOTHING_WINDOW, points.map(isCorrected));

  // Source + corrected flags.
  let correctedCount = 0;
  let usableCount = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p) continue;
    if (isCorrected(p)) correctedCount += 1;
    if (raw[i] !== null) usableCount += 1;
  }
  const corrected = correctedCount > 0;
  const source: ElevationSource =
    usableCount === 0
      ? 'gps'
      : correctedCount === usableCount
        ? 'dem'
        : correctedCount > 0
          ? 'hybrid'
          : 'gps';

  // Gain/loss over the smoothed series, gated by MIN_STEP_DELTA_M.
  let totalGain = 0;
  let totalLoss = 0;
  let prevElev: number | null = null;
  let maxElev = -Infinity;
  let minElev = Infinity;
  let firstElev: number | null = null;
  let lastElev: number | null = null;

  for (let i = 0; i < smoothed.length; i++) {
    const elev = smoothed[i];
    if (elev == null) continue;

    if (firstElev === null) firstElev = elev;
    lastElev = elev;
    if (elev > maxElev) maxElev = elev;
    if (elev < minElev) minElev = elev;

    // Hysteresis deadband: HOLD the reference until the cumulative change from
    // it crosses MIN_STEP_DELTA_M, so a steady shallow climb (< 1 m/step) still
    // accumulates instead of being discarded step-by-step while the reference
    // creeps. Matches liveElevationStep. Only re-baseline on a counted step or
    // a glitch.
    if (prevElev === null) {
      prevElev = elev;
    } else {
      const delta = elev - prevElev;
      if (Math.abs(delta) > MAX_STEP_DELTA_M) {
        prevElev = elev; // glitch / re-acquisition: re-baseline, accumulate nothing
      } else if (delta >= ELEVATION.MIN_STEP_DELTA_M) {
        totalGain += delta;
        prevElev = elev;
      } else if (-delta >= ELEVATION.MIN_STEP_DELTA_M) {
        totalLoss += -delta;
        prevElev = elev;
      }
      // else: within the deadband → hold prevElev (do not advance the reference)
    }
  }

  // No usable elevation anywhere → zeroed numeric fields, but still emit the
  // quality segments so the caller can see the track was all 'missing'.
  const haveElevation = firstElev !== null && lastElev !== null;
  const startElev = haveElevation ? (firstElev as number) : 0;
  const endElev = haveElevation ? (lastElev as number) : 0;

  return {
    total_gain_m: round1(totalGain),
    total_loss_m: round1(totalLoss),
    net_m: round1(endElev - startElev),
    max_elevation_m: haveElevation ? round1(maxElev) : 0,
    min_elevation_m: haveElevation ? round1(minElev) : 0,
    start_elevation_m: round1(startElev),
    end_elevation_m: round1(endElev),
    source,
    corrected,
    coverage_pct: round3(usableCount / points.length),
    segments: buildSegments(points, smoothed),
  };
}

/**
 * Merge contiguous points sharing the same data-quality class into segments.
 * delta_m is the signed net of smoothed elevation across the segment
 * (last reliable − first reliable within it); distance_m is the haversine
 * sum across consecutive points in the segment.
 */
function buildSegments(
  points: GpsPointRecord[],
  smoothed: (number | null)[]
): ElevationSegment[] {
  const segments: ElevationSegment[] = [];
  let startIndex = 0;
  let currentQuality: ElevationQuality | null = null;

  const flush = (endIndex: number): void => {
    if (currentQuality === null) return;
    segments.push({
      startIndex,
      endIndex,
      quality: currentQuality,
      delta_m: round1(segmentDelta(smoothed, startIndex, endIndex)),
      distance_m: round1(segmentDistance(points, startIndex, endIndex)),
    });
  };

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p) continue;
    const q = classifyPoint(p);
    if (currentQuality === null) {
      currentQuality = q;
      startIndex = i;
    } else if (q !== currentQuality) {
      flush(i - 1);
      currentQuality = q;
      startIndex = i;
    }
  }
  flush(points.length - 1);
  return segments;
}

/** Signed net elevation change between the first and last reliable smoothed value in [start,end]. */
function segmentDelta(
  smoothed: (number | null)[],
  start: number,
  end: number
): number {
  let first: number | null = null;
  let last: number | null = null;
  for (let i = start; i <= end; i++) {
    const v = smoothed[i];
    if (v == null) continue;
    if (first === null) first = v;
    last = v;
  }
  if (first === null || last === null) return 0;
  return last - first;
}

/**
 * Sum of haversine distances across consecutive points in [start,end], plus
 * the bridging step from the previous segment's last point — otherwise every
 * quality transition dropped one inter-fix step and the strip's distances
 * undershot the track total by ~2-4 m per transition.
 */
function segmentDistance(
  points: GpsPointRecord[],
  start: number,
  end: number
): number {
  let total = 0;
  for (let i = Math.max(1, start); i <= end; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (!prev || !curr) continue;
    total += haversineMeters(prev, curr);
  }
  return total;
}

/**
 * Bucket elevation gain/loss per kilometer of cumulative horizontal distance.
 * Returns one row per started km bucket so the history layer can merge the
 * gain/loss values onto SplitMetric (`ascent_m` / `descent_m`).
 *
 * Uses the same chosen+smoothed elevation series as `computeElevationStats`.
 * Deltas below MIN_STEP_DELTA_M are treated as jitter and ignored. Each
 * point's elevation delta is attributed to the km bucket of the point at the
 * *end* of the step.
 *
 * @param points GPS track in chronological order.
 * @param splitDistanceM Bucket size in meters (default 1000 = 1 km).
 * @returns Array of { km (1-indexed), gain_m, loss_m } in km order.
 */
export function elevationPerSplit(
  points: GpsPointRecord[],
  splitDistanceM = 1000
): { km: number; gain_m: number; loss_m: number }[] {
  if (points.length < 2 || splitDistanceM <= 0) return [];

  const raw: (number | null)[] = points.map(chosenElevation);
  // Same segmented smoothing as computeElevationStats so split gains still sum
  // exactly to the run totals (both engines must see the identical series).
  const smoothed = smoothSegmented(raw, ELEVATION.SMOOTHING_WINDOW, points.map(isCorrected));

  const buckets = new Map<number, { gain_m: number; loss_m: number }>();
  let cumulative = 0;
  let prevElev: number | null = null;

  // Seed prevElev with the first reliable elevation so step 1 has a baseline.
  for (let i = 0; i < smoothed.length; i++) {
    if (smoothed[i] != null) {
      prevElev = smoothed[i] as number;
      break;
    }
  }

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (!prev || !curr) continue;
    // Match the split producers' km axis: paused/dropout segments (>30s) don't
    // advance the ruler. Elevation deltas still flow below so split gains keep
    // summing to the run total — only the km attribution follows the shared axis.
    const dtSec = (curr.timestamp - prev.timestamp) / 1000;
    if (dtSec > 0 && dtSec <= 30) {
      cumulative += haversineMeters(prev, curr);
    }

    const elev = smoothed[i];
    if (elev == null) continue;

    if (prevElev !== null) {
      const delta = elev - prevElev;
      // 1-indexed km bucket of the point at the end of this step.
      const km = Math.floor(cumulative / splitDistanceM) + 1;
      const bucket = buckets.get(km) ?? { gain_m: 0, loss_m: 0 };
      // Hysteresis deadband (see computeElevationStats): hold the reference
      // within the band so shallow climbs aren't lost step-by-step.
      if (Math.abs(delta) > MAX_STEP_DELTA_M) {
        prevElev = elev; // glitch: re-baseline, accumulate nothing
      } else if (delta >= ELEVATION.MIN_STEP_DELTA_M) {
        bucket.gain_m += delta;
        prevElev = elev;
      } else if (-delta >= ELEVATION.MIN_STEP_DELTA_M) {
        bucket.loss_m += -delta;
        prevElev = elev;
      }
      buckets.set(km, bucket);
    } else {
      prevElev = elev;
    }
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([km, v]) => ({
      km,
      gain_m: round1(v.gain_m),
      loss_m: round1(v.loss_m),
    }));
}

/**
 * Overwrite each split's ascent/descent with the per-km gain/loss from the
 * same (DEM-aware) elevation series, so the per-split sum reconciles with the
 * run total. Adds a split for any km present in `perSplit` but missing from
 * `splits` (e.g. a trailing partial km). Pure.
 */
export function applyPerSplitElevation(
  splits: readonly SplitMetric[],
  perSplit: readonly { km: number; gain_m: number; loss_m: number }[]
): SplitMetric[] {
  const byKm = new Map(perSplit.map((p) => [p.km, p]));
  if (splits.length === 0) {
    return perSplit
      .map((p) => ({
        km: p.km,
        duration_sec: 0,
        avg_hr: 0,
        ascent_m: Math.round(p.gain_m),
        descent_m: Math.round(p.loss_m),
      }))
      .sort((a, b) => a.km - b.km);
  }

  const maxKm = Math.max(...splits.map((s) => s.km));
  // Unrounded gain/loss per split from the elevation series.
  const work = splits.map((s) => ({
    split: s,
    gain: byKm.get(s.km)?.gain_m ?? 0,
    loss: byKm.get(s.km)?.loss_m ?? 0,
  }));
  // Fold any leftover km (a trailing partial split that terrain drops) into the
  // last split, so sum(splits.ascent) reconciles with the run total.
  let extraGain = 0;
  let extraLoss = 0;
  for (const p of perSplit) {
    if (p.km > maxKm) {
      extraGain += p.gain_m;
      extraLoss += p.loss_m;
    }
  }
  const last = work[work.length - 1];
  if (last) {
    last.gain += extraGain;
    last.loss += extraLoss;
  }
  return work.map((w) => ({
    ...w.split,
    ascent_m: Math.round(w.gain),
    descent_m: Math.round(w.loss),
  }));
}

/** Streaming state for `liveElevationStep`. */
export interface LiveElevationState {
  gain: number;
  loss: number;
  /** Last accepted (reference) altitude in meters, or null before any fix. */
  lastAlt: number | null;
}

/**
 * Pure streaming reducer for the live run store. Called at ~1 Hz, so it is
 * deliberately allocation-light: a single new state object, no arrays, no
 * intermediate buffers.
 *
 * Smoothing here is a simple threshold (MIN_STEP_DELTA_M) against the last
 * accepted altitude — not a moving average — because at stream time we have
 * no look-ahead. A new reading only moves the reference (and accumulates
 * gain/loss) once it differs from `lastAlt` by at least MIN_STEP_DELTA_M;
 * smaller wiggles are absorbed as jitter and the reference is held. This
 * keeps the live counter from creeping on a flat run.
 *
 * A null `newAltitude` (no/poor fix this tick) is a no-op: state is returned
 * unchanged. The very first finite altitude seeds `lastAlt` without adding
 * gain or loss.
 *
 * @param state Previous accumulator.
 * @param newAltitude New altitude reading (m) this tick, or null.
 * @returns New accumulator state.
 */
export function liveElevationStep(
  state: LiveElevationState,
  newAltitude: number | null
): LiveElevationState {
  if (newAltitude == null || !Number.isFinite(newAltitude)) {
    return state;
  }
  if (state.lastAlt === null) {
    return { gain: state.gain, loss: state.loss, lastAlt: newAltitude };
  }

  const delta = newAltitude - state.lastAlt;
  if (Math.abs(delta) > MAX_STEP_DELTA_M) {
    // Implausible jump → treat as re-acquisition: move the reference, add nothing.
    return { gain: state.gain, loss: state.loss, lastAlt: newAltitude };
  }
  if (delta >= ELEVATION.MIN_STEP_DELTA_M) {
    return { gain: state.gain + delta, loss: state.loss, lastAlt: newAltitude };
  }
  if (-delta >= ELEVATION.MIN_STEP_DELTA_M) {
    return { gain: state.gain, loss: state.loss + -delta, lastAlt: newAltitude };
  }
  // Within jitter band: hold the reference, accumulate nothing.
  return state;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
