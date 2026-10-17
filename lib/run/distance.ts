// SPDX-License-Identifier: GPL-3.0-or-later

import type { GpsPoint, HRSample, SplitMetric } from '@/types';

/**
 * Pure helpers for distance, pace, and split computation.
 * All inputs assumed to be in chronological order.
 */

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(a: GpsPoint, b: GpsPoint): number {
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_M * c;
}

export function accumulateDistance(points: GpsPoint[]): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (!prev || !curr) continue;
    total += haversineMeters(prev, curr);
  }
  return total;
}

/**
 * Rolling pace (sec/km) over the last `windowMs` of GPS points.
 * Returns null if the window has too little data to be meaningful.
 */
export function paceFromPoints(
  points: GpsPoint[],
  windowMs: number
): number | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  if (!last) return null;
  const cutoff = last.timestamp - windowMs;

  let firstIdx = points.length - 1;
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (!p) continue;
    if (p.timestamp <= cutoff) {
      firstIdx = i;
      break;
    }
    firstIdx = i;
  }

  const slice = points.slice(firstIdx);
  if (slice.length < 2) return null;
  const meters = accumulateDistance(slice);
  if (meters < 5) return null;

  const first = slice[0];
  const lastPoint = slice[slice.length - 1];
  if (!first || !lastPoint) return null;
  const seconds = (lastPoint.timestamp - first.timestamp) / 1000;
  if (seconds <= 0) return null;

  return seconds / (meters / 1000);
}

/**
 * Segments longer than this are GPS dropouts or pauses — they advance neither
 * the km ruler nor the split clock, matching the terrain ruler
 * (MAX_SEGMENT_GAP_SEC) so all split producers share one axis.
 */
const MAX_SPLIT_GAP_SEC = 30;

/**
 * Split each kilometer into a SplitMetric. Each km boundary is linearly
 * interpolated within the segment that crosses it, and durations count ACTIVE
 * time only: a paused/dropout segment (> MAX_SPLIT_GAP_SEC) is skipped, so a
 * 5-minute pause can no longer be interpolated into whichever km contained it
 * (which made split durations sum past the pause-excluded run duration).
 */
export function splitsFromPoints(
  points: GpsPoint[],
  hrSamples: HRSample[]
): SplitMetric[] {
  const firstPoint = points[0];
  if (!firstPoint || points.length < 2) return [];

  const splits: SplitMetric[] = [];
  let distIntoSplit = 0;
  let secIntoSplit = 0;
  let splitStartTs = firstPoint.timestamp;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (!prev || !curr) continue;
    const dtSec = (curr.timestamp - prev.timestamp) / 1000;
    if (dtSec <= 0 || dtSec > MAX_SPLIT_GAP_SEC) continue;
    const segMeters = haversineMeters(prev, curr);
    if (segMeters <= 0) continue;

    // Consume the segment piece by piece so a single long segment can close
    // multiple boundaries, each linearly interpolated in time.
    let pieceStartTs = prev.timestamp;
    let pieceMeters = segMeters;
    let pieceSec = dtSec;
    while (distIntoSplit + pieceMeters >= 1000) {
      const needM = 1000 - distIntoSplit;
      const r = pieceMeters > 0 ? needM / pieceMeters : 0;
      const boundaryTs = pieceStartTs + r * pieceSec * 1000;
      const duration = secIntoSplit + r * pieceSec;
      splits.push({
        km: splits.length + 1,
        duration_sec: Math.round(duration),
        avg_hr: avgHrInWindow(hrSamples, splitStartTs, boundaryTs) ?? 0,
      });
      pieceMeters -= needM;
      pieceSec -= r * pieceSec;
      pieceStartTs = boundaryTs;
      distIntoSplit = 0;
      secIntoSplit = 0;
      splitStartTs = boundaryTs;
    }
    distIntoSplit += pieceMeters;
    secIntoSplit += pieceSec;
  }

  return splits;
}

export function avgHrInWindow(
  samples: readonly HRSample[],
  startMs: number,
  endMs: number
): number | null {
  let sum = 0;
  let count = 0;
  for (const s of samples) {
    // Half-open [start, end): a sample exactly on a split boundary belongs to
    // the NEXT split only — inclusive bounds counted it in both neighbors.
    if (s.timestamp >= startMs && s.timestamp < endMs) {
      sum += s.bpm;
      count += 1;
    }
  }
  return count > 0 ? Math.round(sum / count) : null;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
