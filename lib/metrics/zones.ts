// SPDX-License-Identifier: GPL-3.0-or-later

import { classifyHR } from '@/lib/zones';
import type { HRSampleRecord, ZoneConfig, ZoneDistribution, ZoneNumber } from '@/types';

const MAX_GAP_MS = 30_000;

/** Minimal sample shape — lets the live run store reuse this on HRSample too. */
type ZoneSample = Pick<HRSampleRecord, 'timestamp' | 'bpm'>;

/** Total overlap (ms) between [startMs, endMs] and the given pause intervals. */
function pausedOverlapMs(
  startMs: number,
  endMs: number,
  pauses: readonly { start: number; end: number }[]
): number {
  let total = 0;
  for (const p of pauses) {
    const lo = Math.max(startMs, p.start);
    const hi = Math.min(endMs, p.end);
    if (hi > lo) total += hi - lo;
  }
  return total;
}

export function aggregateZoneDistribution(
  samples: ZoneSample[],
  zones: ZoneConfig,
  pauses: readonly { start: number; end: number }[] = []
): ZoneDistribution {
  const dist: ZoneDistribution = {
    z1_sec: 0,
    z2_sec: 0,
    z3_sec: 0,
    z4_sec: 0,
    z5_sec: 0,
  };
  if (samples.length < 2) return dist;

  const sorted = [...samples].sort((a, b) => a.timestamp - b.timestamp);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (!prev || !curr) continue;
    const dtMs = curr.timestamp - prev.timestamp;
    if (dtMs <= 0) continue;
    // Exclude paused wall-time first — a short pause (≤30s) is otherwise
    // indistinguishable from a BLE gap and would be counted as zone time
    // while duration_sec excludes it.
    const activeMs = dtMs - pausedOverlapMs(prev.timestamp, curr.timestamp, pauses);
    if (activeMs <= 0) continue;
    const dt = Math.min(activeMs, MAX_GAP_MS) / 1000;
    const zone = classifyHR(prev.bpm, zones);
    if (zone === null) continue;
    addSeconds(dist, zone, dt);
  }
  return dist;
}

function addSeconds(dist: ZoneDistribution, zone: ZoneNumber, sec: number): void {
  switch (zone) {
    case 1:
      dist.z1_sec += sec;
      break;
    case 2:
      dist.z2_sec += sec;
      break;
    case 3:
      dist.z3_sec += sec;
      break;
    case 4:
      dist.z4_sec += sec;
      break;
    case 5:
      dist.z5_sec += sec;
      break;
  }
}

export function totalZoneSec(dist: ZoneDistribution): number {
  return dist.z1_sec + dist.z2_sec + dist.z3_sec + dist.z4_sec + dist.z5_sec;
}

export function zonePercent(
  dist: ZoneDistribution,
  zone: ZoneNumber
): number {
  const total = totalZoneSec(dist);
  if (total <= 0) return 0;
  return (zoneSeconds(dist, zone) / total) * 100;
}

export function zoneSeconds(dist: ZoneDistribution, zone: ZoneNumber): number {
  switch (zone) {
    case 1:
      return dist.z1_sec;
    case 2:
      return dist.z2_sec;
    case 3:
      return dist.z3_sec;
    case 4:
      return dist.z4_sec;
    case 5:
      return dist.z5_sec;
  }
}
