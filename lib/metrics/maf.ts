// SPDX-License-Identifier: GPL-3.0-or-later

import { MAF_WINDOW } from '@/config/constants';
import { localDayIndex, parseISO, toISODate, todayISO } from '@/lib/time';
import type {
  CompletedRun,
  GpsPoint,
  GpsPointRecord,
  HRSample,
  HRSampleRecord,
  MafDriftPoint,
  WeeklyZ2Point,
} from '@/types';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SAMPLE_GAP_MS = 30_000;
const MIN_MAF_DISTANCE_M = 50;

function isInMafWindow(bpm: number, window: readonly [number, number] = MAF_WINDOW): boolean {
  return bpm >= window[0] && bpm <= window[1];
}

type HRSampleLike = Pick<HRSample, 'timestamp' | 'bpm'>;
type GpsPointLike = Pick<GpsPoint, 'timestamp' | 'latitude' | 'longitude'>;

function haversineMeters(a: GpsPointLike, b: GpsPointLike): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

function distanceBetweenTimestamps(
  points: ReadonlyArray<GpsPointLike>,
  startMs: number,
  endMs: number
): number {
  let total = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (!prev || !curr) continue;
    if (curr.timestamp <= startMs) continue;
    if (prev.timestamp >= endMs) break;

    const segmentMs = curr.timestamp - prev.timestamp;
    if (segmentMs <= 0) continue;
    const overlapStart = Math.max(startMs, prev.timestamp);
    const overlapEnd = Math.min(endMs, curr.timestamp);
    if (overlapEnd <= overlapStart) continue;

    const overlapRatio = (overlapEnd - overlapStart) / segmentMs;
    total += haversineMeters(prev, curr) * overlapRatio;
  }

  return total;
}

export function mafPaceFromSamples(
  samples: ReadonlyArray<HRSampleLike>,
  gps: ReadonlyArray<GpsPointLike>,
  mafWindow: readonly [number, number] = MAF_WINDOW
): number | null {
  if (samples.length < 2 || gps.length < 2) return null;

  let totalMeters = 0;
  let totalSec = 0;

  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const curr = samples[i];
    if (!prev || !curr) continue;
    const dtMs = curr.timestamp - prev.timestamp;
    if (dtMs <= 0 || dtMs > MAX_SAMPLE_GAP_MS) continue;
    if (!isInMafWindow(prev.bpm, mafWindow) || !isInMafWindow(curr.bpm, mafWindow)) continue;

    const meters = distanceBetweenTimestamps(gps, prev.timestamp, curr.timestamp);
    if (meters <= 0) continue;
    totalMeters += meters;
    totalSec += dtMs / 1000;
  }

  if (totalMeters < MIN_MAF_DISTANCE_M || totalSec <= 0) return null;
  return Math.round(totalSec / (totalMeters / 1000));
}

export function mafPaceForRun(
  samples: HRSampleRecord[],
  gps: GpsPointRecord[],
  mafWindow: readonly [number, number] = MAF_WINDOW
): number | null {
  return mafPaceFromSamples(samples, gps, mafWindow);
}

/**
 * Local calendar day (YYYY-MM-DD) of the earliest run — the anchor every
 * weekly bucket counts from now that there is no plan start date. Null when
 * there are no runs.
 */
export function firstRunDayISO(runs: readonly CompletedRun[]): string | null {
  let earliest: number | null = null;
  for (const run of runs) {
    if (earliest === null || run.started_at < earliest) earliest = run.started_at;
  }
  return earliest === null ? null : todayISO(new Date(earliest));
}

function weekIndexFrom(timestampMs: number, anchorISO: string): number {
  const day = localDayIndex(timestampMs, anchorISO);
  if (day < 0) return 0;
  return Math.floor(day / 7);
}

function weekStartISO(anchorMs: number, weekIndex: number): string {
  return toISODate(new Date(anchorMs + weekIndex * WEEK_MS));
}

export function weeklyMafDrift(runs: CompletedRun[]): MafDriftPoint[] {
  const anchorISO = firstRunDayISO(runs);
  if (anchorISO === null) return [];
  const anchorMs = parseISO(anchorISO).getTime();
  const buckets = new Map<
    number,
    { weightedSum: number; weight: number; count: number }
  >();

  for (const run of runs) {
    const mafPace = run.maf_gap_pace_sec_per_km ?? run.maf_pace_sec_per_km;
    if (mafPace === null) continue;
    if (run.duration_sec <= 0) continue;
    const weekIdx = weekIndexFrom(run.started_at, anchorISO);
    const existing =
      buckets.get(weekIdx) ?? { weightedSum: 0, weight: 0, count: 0 };
    existing.weightedSum += mafPace * run.duration_sec;
    existing.weight += run.duration_sec;
    existing.count += 1;
    buckets.set(weekIdx, existing);
  }

  const sortedIdx = [...buckets.keys()].sort((a, b) => a - b);
  const out: MafDriftPoint[] = [];
  for (const weekIdx of sortedIdx) {
    const b = buckets.get(weekIdx);
    if (!b || b.weight <= 0) continue;
    out.push({
      weekStart: weekStartISO(anchorMs, weekIdx),
      weekNumber: weekIdx + 1,
      pace_sec_per_km: b.weightedSum / b.weight,
      sample_count: b.count,
    });
  }
  return out;
}

/**
 * Zone-2 minutes per week from the earliest run's day up to the current
 * week, with empty weeks emitted as zeros so the bar chart shows the gaps.
 */
export function weeklyZ2Minutes(
  runs: CompletedRun[],
  now: Date = new Date()
): WeeklyZ2Point[] {
  const anchorISO = firstRunDayISO(runs);
  if (anchorISO === null) return [];
  const anchorMs = parseISO(anchorISO).getTime();
  const lastWeekIdx = Math.max(
    weekIndexFrom(now.getTime(), anchorISO),
    ...runs.map((run) => weekIndexFrom(run.started_at, anchorISO))
  );
  const out: WeeklyZ2Point[] = [];
  for (let weekIdx = 0; weekIdx <= lastWeekIdx; weekIdx += 1) {
    const weekRuns = runs.filter((run) => weekIndexFrom(run.started_at, anchorISO) === weekIdx);
    const z2Sec = weekRuns.reduce((acc, run) => acc + run.zone_distribution.z2_sec, 0);
    const totalSec = weekRuns.reduce((acc, run) => acc + run.duration_sec, 0);
    out.push({
      weekStart: weekStartISO(anchorMs, weekIdx),
      weekNumber: weekIdx + 1,
      z2_minutes: Math.round(z2Sec / 60),
      total_minutes: Math.round(totalSec / 60),
    });
  }
  return out;
}

export function recoveryHRDrop(
  samplesAfterWorkEndMs: ReadonlyArray<Pick<HRSample, 'timestamp' | 'bpm'>>,
  workEndPeakBpm: number,
  workEndMs: number
): number | null {
  if (samplesAfterWorkEndMs.length === 0) return null;
  const sorted = [...samplesAfterWorkEndMs].sort((a, b) => a.timestamp - b.timestamp);
  const last = sorted[sorted.length - 1];
  const first = sorted[0];
  if (!last || !first) return null;
  // Require a full 60 s of recovery data — this is a 1-minute HRR, so accepting
  // 50 s returned an under-counted drop mislabeled as one minute.
  if (last.timestamp - workEndMs < 60_000) return null;

  const target = workEndMs + 60_000;
  let closest = first;
  let bestDelta = Math.abs(first.timestamp - target);
  for (const s of sorted) {
    const delta = Math.abs(s.timestamp - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      closest = s;
    }
    if (s.timestamp >= target) break;
  }
  return Math.max(0, workEndPeakBpm - closest.bpm);
}
