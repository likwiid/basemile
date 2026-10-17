// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { haversineMeters, splitsFromPoints } from '@/lib/run/distance';
import type { GpsPoint, HRSample } from '@/types';

function gps(timestamp: number, longitude: number): GpsPoint {
  return { timestamp, latitude: 0, longitude, accuracy: 5 };
}

function hr(timestamp: number, bpm: number): HRSample {
  return { timestamp, bpm };
}

describe('haversineMeters', () => {
  it('is zero for identical points', () => {
    expect(haversineMeters(gps(0, 0), gps(1000, 0))).toBe(0);
  });
});

describe('splitsFromPoints', () => {
  it('interpolates kilometer boundaries instead of waiting for the next GPS point', () => {
    // 61 fixes 10s apart, ~33.4 m each → ~2004 m in 600 s. Boundaries fall
    // mid-segment and must be interpolated, not snapped to the next fix.
    const points = Array.from({ length: 61 }, (_, i) => gps(i * 10_000, i * 0.0003));
    const samples = [hr(0, 140), hr(300_000, 142), hr(600_000, 144)];

    const splits = splitsFromPoints(points, samples);

    expect(splits).toHaveLength(2);
    expect(splits[0]?.duration_sec).toBeGreaterThan(290);
    expect(splits[0]?.duration_sec).toBeLessThan(310);
  });

  it('drops paused/dropout segments from both the ruler and the split clock', () => {
    // 1 km of clean 10s fixes, a 5-minute dropout, then 1 km more. The gap
    // must not add distance or time to any split (it previously interpolated
    // the whole 300 s into whichever km contained it).
    const firstLeg = Array.from({ length: 31 }, (_, i) => gps(i * 10_000, i * 0.0003));
    const gapEndTs = 300_000 + 300_000; // 5-min dropout after the first leg
    const secondLeg = Array.from({ length: 31 }, (_, i) =>
      gps(gapEndTs + i * 10_000, 0.009 + 0.0003 + i * 0.0003)
    );
    const splits = splitsFromPoints([...firstLeg, ...secondLeg], []);

    expect(splits).toHaveLength(2);
    expect(splits[0]?.duration_sec).toBeLessThan(310);
    expect(splits[1]?.duration_sec).toBeLessThan(310);
  });
});
