// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { routeNote, routeZoneSegments } from '@/lib/route/intelligence';
import type { GpsPoint, HRSample, ZoneConfig } from '@/types';

const zones: ZoneConfig = {
  z1: [90, 120],
  z2: [120, 150],
  z3: [150, 165],
  z4: [165, 180],
  z5: [180, 200],
};

function gps(timestamp: number, longitude: number, altitude?: number): GpsPoint {
  return {
    timestamp,
    latitude: 0,
    longitude,
    altitude,
    accuracy: 5,
  };
}

function hr(timestamp: number, bpm: number): HRSample {
  return { timestamp, bpm };
}

describe('routeZoneSegments', () => {
  it('colors route segments by the nearest HR sample zone', () => {
    const points = [
      gps(0, 0),
      gps(10_000, 0.001),
      gps(20_000, 0.002),
      gps(30_000, 0.003),
    ];
    const samples = [hr(5_000, 130), hr(15_000, 155), hr(25_000, 172)];

    const segments = routeZoneSegments(points, samples, zones);

    expect(segments.map((segment) => segment.zone)).toEqual([2, 3, 4]);
    expect(segments[0]?.coordinates).toEqual([
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 0.001 },
    ]);
  });

  it('groups consecutive segments in the same zone', () => {
    const points = [gps(0, 0), gps(10_000, 0.001), gps(20_000, 0.002)];
    const samples = [hr(5_000, 130), hr(15_000, 132)];

    const segments = routeZoneSegments(points, samples, zones);

    expect(segments).toHaveLength(1);
    expect(segments[0]?.zone).toBe(2);
    expect(segments[0]?.coordinates).toHaveLength(3);
  });

  it('does not connect same-zone segments across missing HR coverage', () => {
    const points = [
      gps(0, 0),
      gps(10_000, 0.001),
      gps(40_000, 0.004),
      gps(50_000, 0.005),
    ];
    const samples = [hr(5_000, 130), hr(45_000, 132)];

    const segments = routeZoneSegments(points, samples, zones);

    expect(segments).toHaveLength(2);
    expect(segments[0]?.coordinates).toEqual([
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 0.001 },
    ]);
    expect(segments[1]?.coordinates).toEqual([
      { latitude: 0, longitude: 0.004 },
      { latitude: 0, longitude: 0.005 },
    ]);
  });
});

describe('routeNote', () => {
  it('reports a reliable climb before HR spikes', () => {
    const points = [
      gps(0, 0, 10),
      gps(20_000, 0.001, 12),
      gps(40_000, 0.002, 14),
      gps(60_000, 0.003, 16),
      gps(80_000, 0.004, 18),
      gps(100_000, 0.005, 20),
    ];
    const samples = [hr(0, 130), hr(60_000, 145), hr(100_000, 151)];

    expect(routeNote(points, samples)).toEqual({
      kind: 'hill',
      label: 'Hill: +10 m over 556 m, HR peaked 151',
    });
  });

  it('reports a sudden HR rise when altitude is unavailable', () => {
    const points = [gps(0, 0), gps(60_000, 0.005), gps(120_000, 0.01)];
    const samples = [hr(0, 125), hr(60_000, 146), hr(120_000, 148)];

    expect(routeNote(points, samples)).toEqual({
      kind: 'hr_spike',
      label: 'HR spike: +23 bpm in 120s near 1.1 km',
    });
  });
});
