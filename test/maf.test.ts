// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { mafPaceFromSamples, recoveryHRDrop } from '@/lib/metrics/maf';
import type { GpsPoint, HRSample } from '@/types';

function gps(timestamp: number, longitude: number): GpsPoint {
  return { timestamp, latitude: 0, longitude, accuracy: 5 };
}

function hr(timestamp: number, bpm: number): HRSample {
  return { timestamp, bpm };
}

describe('mafPaceFromSamples', () => {
  it('uses one canonical MAF-window algorithm with interpolated GPS distance', () => {
    const samples = [hr(0, 145), hr(30_000, 149), hr(60_000, 150)];
    const points = [gps(0, 0), gps(60_000, 0.018)];

    const pace = mafPaceFromSamples(samples, points);

    expect(pace).not.toBeNull();
    expect(pace).toBe(30);
  });

  it('excludes windows unless both HR endpoints are in the MAF range', () => {
    const samples = [hr(0, 150), hr(30_000, 149), hr(60_000, 150)];
    const points = [gps(0, 0), gps(60_000, 0.018)];

    expect(mafPaceFromSamples(samples, points)).toBeNull();
  });
});

describe('recoveryHRDrop', () => {
  it('requires at least 50 seconds of post-work samples', () => {
    expect(recoveryHRDrop([hr(20_000, 160)], 180, 0)).toBeNull();
  });

  it('uses the sample closest to 60 seconds after work end', () => {
    const drop = recoveryHRDrop([hr(50_000, 155), hr(62_000, 150)], 180, 0);

    expect(drop).toBe(30);
  });
});
