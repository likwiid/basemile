// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { cleanRrIntervals, computeReadiness, computeRmssd } from '@/lib/metrics/hrv';
import type { HrvRecord } from '@/types';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

function rec(dayFromToday: number, rmssd: number): HrvRecord {
  return { measured_at: NOW - dayFromToday * DAY, rmssd_ms: rmssd, mean_hr: 50, rr_count: 200 };
}

describe('cleanRrIntervals', () => {
  it('drops ectopic beats beyond ±20% of the running median', () => {
    const cleaned = cleanRrIntervals([800, 810, 805, 1300, 800, 795]);
    expect(cleaned).not.toContain(1300);
    expect(cleaned.length).toBe(5);
  });

  it('ignores non-finite and non-positive intervals', () => {
    expect(cleanRrIntervals([800, NaN, -5, 805])).toEqual([800, 805]);
  });
});

describe('computeRmssd', () => {
  it('is 0 with fewer than two intervals', () => {
    expect(computeRmssd([800])).toBe(0);
  });

  it('matches the RMS of successive differences', () => {
    // diffs: +10, -10 → sqrt((100+100)/2) = 10
    expect(computeRmssd([800, 810, 800])).toBeCloseTo(10, 5);
  });
});

describe('computeReadiness', () => {
  const history = Array.from({ length: 30 }, (_, i) => rec(i + 1, 60));

  it('is unknown without enough recent readings', () => {
    const r = computeReadiness(rec(0, 60), [rec(20, 60)]);
    expect(r.label).toBe('unknown');
  });

  it('flags a big drop below baseline as low/moderate', () => {
    // baseline ~60, latest 40 — well below the SWC band.
    const r = computeReadiness(rec(0, 40), history);
    expect(['low', 'moderate']).toContain(r.label);
    expect(r.score).not.toBeNull();
  });

  it('treats an on-baseline reading as good/solid', () => {
    const r = computeReadiness(rec(0, 60), history);
    expect(r.label).toBe('good');
  });

  it('flags a clear rise above baseline as ready to push', () => {
    const r = computeReadiness(rec(0, 80), history);
    expect(r.label).toBe('good');
    expect(r.score).toBe(90);
  });
});
