// SPDX-License-Identifier: GPL-3.0-or-later

import { todayISO } from '@/lib/time';
import type { BaselineRecord } from '@/types';

interface TrendPoint {
  date: string;
  bpm: number;
}

function baselinesToPoints(records: BaselineRecord[]): TrendPoint[] {
  return [...records]
    .sort((a, b) => a.measured_at - b.measured_at)
    .map((r) => ({
      // Local calendar day — the monthly bucketing below and the rest of the
      // app label days locally; a UTC slice dated late-evening readings to the
      // previous day (and even a different MONTH than maxHRPerMonth).
      date: todayISO(new Date(r.measured_at)),
      bpm: r.bpm,
    }));
}

export function restingHRTrend(baselines: BaselineRecord[]): TrendPoint[] {
  return baselinesToPoints(baselines.filter((b) => b.kind === 'resting_hr'));
}

export function maxHRTrend(baselines: BaselineRecord[]): TrendPoint[] {
  return baselinesToPoints(baselines.filter((b) => b.kind === 'max_hr'));
}

interface MonthlyMaxHR {
  month: string;
  bpm: number;
}

export function maxHRPerMonth(baselines: BaselineRecord[]): MonthlyMaxHR[] {
  const buckets = new Map<string, number>();
  for (const b of baselines) {
    if (b.kind !== 'max_hr') continue;
    const d = new Date(b.measured_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const prev = buckets.get(key) ?? 0;
    if (b.bpm > prev) buckets.set(key, b.bpm);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, bpm]) => ({ month, bpm }));
}
