// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  computeRunTerrainMetrics,
  gradeAdjustedPaceMultiplier,
  smoothedAltitude,
  windowedGrade,
} from '@/lib/metrics/terrain';
import type { CadenceSample, GpsPoint, HRSample } from '@/types';

function gps(timestamp: number, longitude: number, altitude: number): GpsPoint {
  return { timestamp, latitude: 0, longitude, altitude, accuracy: 5 };
}

function gpsDem(
  timestamp: number,
  longitude: number,
  altitude: number,
  groundElevation: number | null
): GpsPoint {
  return { timestamp, latitude: 0, longitude, altitude, groundElevation, accuracy: 5 };
}

function hr(timestamp: number, bpm: number): HRSample {
  return { timestamp, bpm };
}

function cadence(timestamp: number, spm: number): CadenceSample {
  return { timestamp, spm };
}

describe('gradeAdjustedPaceMultiplier', () => {
  it('uses the Strava-style polynomial adjustment', () => {
    expect(gradeAdjustedPaceMultiplier(0)).toBeCloseTo(1);
    expect(gradeAdjustedPaceMultiplier(0.05)).toBeCloseTo(1 + 4 * 0.05 + 14.5 * 0.05 ** 2);
  });

  it('converts uphill pace toward flat-equivalent GAP by dividing by the multiplier', () => {
    const rawPaceSecPerKm = 360;
    const adjusted = rawPaceSecPerKm / gradeAdjustedPaceMultiplier(0.05);

    expect(adjusted).toBeLessThan(rawPaceSecPerKm);
  });

  // GAP inflation fix: convex curve + grade cap must not run away on steep climbs.
  it('matches the curve at a realistic 6% grade', () => {
    expect(gradeAdjustedPaceMultiplier(0.06)).toBeCloseTo(1.292, 2);
  });

  it('clamps the multiplier to 2.5 on steep / noisy grades', () => {
    // poly(0.25) = 2.91 and poly is even steeper past the 30% grade cap.
    expect(gradeAdjustedPaceMultiplier(0.25)).toBe(2.5);
    expect(gradeAdjustedPaceMultiplier(0.3)).toBe(2.5);
    expect(gradeAdjustedPaceMultiplier(1.5)).toBe(2.5);
  });

  it('credits descents but matches Strava downhill anchors (not over-credited)', () => {
    // Minimum ~0.88 near -9%, back to ~1.0 by -18% (Strava improved GAP).
    expect(gradeAdjustedPaceMultiplier(-0.09)).toBeCloseTo(0.88, 1);
    expect(gradeAdjustedPaceMultiplier(-0.18)).toBeCloseTo(1.0, 1);
    const mild = gradeAdjustedPaceMultiplier(-0.05);
    expect(mild).toBeLessThan(1);
    expect(mild).toBeGreaterThanOrEqual(0.85);
  });
});

describe('DEM ground elevation preference', () => {
  it('smoothedAltitude uses groundElevation over raw altitude when present', () => {
    const points = [
      gpsDem(0, 0, 10, 500),
      gpsDem(1000, 0.001, 20, 500),
    ];
    // window 1 → each point's own chosen elevation: the DEM value, not altitude.
    expect(smoothedAltitude(points, 1)).toEqual([500, 500]);
  });

  it('falls back to altitude when groundElevation is null', () => {
    const points = [gpsDem(0, 0, 10, null), gpsDem(1000, 0.001, 22, null)];
    expect(smoothedAltitude(points, 1)).toEqual([10, 22]);
  });

  it('computes GAP from DEM, so noisy altitude does not over-credit a flat run', () => {
    // Altitude ramps up steeply; the DEM says it is dead flat.
    const steepAlt = [0, 60, 120, 180, 240];
    const flatDem = steepAlt.map((alt, i) => gpsDem(i * 20_000, i * 0.0036, alt, 200));
    const noDem = steepAlt.map((alt, i) => gpsDem(i * 20_000, i * 0.0036, alt, null));

    const withDem = computeRunTerrainMetrics(flatDem).avg_gap_sec_per_km ?? 0;
    const withoutDem = computeRunTerrainMetrics(noDem).avg_gap_sec_per_km ?? 0;

    // Flat DEM → multiplier ~1 → GAP ≈ raw pace; noisy altitude over-credits the
    // fake climb, making its GAP look faster (smaller sec/km).
    expect(withDem).toBeGreaterThan(withoutDem);
  });
});

describe('windowedGrade', () => {
  it('ignores a single-point elevation spike that point-to-point reads as steep', () => {
    const cumulative = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
    const flatWithSpike = [100, 100, 100, 100, 100, 108, 100, 100, 100, 100, 100];
    // Adjacent slope into index 5 is 8m / 5m = 160%; the 30m window flattens it.
    expect(Math.abs(windowedGrade(flatWithSpike, cumulative, 5, 30))).toBeLessThan(0.05);
  });

  it('preserves a real sustained grade', () => {
    const cumulative = Array.from({ length: 21 }, (_, i) => i * 5);
    const alt = cumulative.map((d) => 100 + d * 0.1); // steady 10%
    expect(windowedGrade(alt, cumulative, 10, 30)).toBeCloseTo(0.1, 2);
  });
});

describe('computeRunTerrainMetrics', () => {
  it('computes ascent, descent, GAP, MAF-GAP, and cadence-aware splits', () => {
    const points = [
      gps(0, 0, 10),
      gps(20_000, 0.0036, 20),
      gps(40_000, 0.0072, 45),
      gps(60_000, 0.0108, 70),
      gps(80_000, 0.0144, 0),
      gps(100_000, 0.018, -80),
    ];
    const samples = [hr(0, 146), hr(50_000, 148), hr(100_000, 147)];
    const cadences = [cadence(20_000, 172), cadence(70_000, 168)];

    const metrics = computeRunTerrainMetrics(points, samples, cadences);

    expect(metrics.ascent_m).toBeGreaterThan(0);
    expect(metrics.descent_m).toBeGreaterThan(0);
    expect(metrics.avg_gap_sec_per_km).toBeGreaterThan(0);
    expect(metrics.maf_gap_pace_sec_per_km).toBeGreaterThan(0);
    expect(metrics.splits).toHaveLength(2);
    expect(metrics.splits[0]?.gap_sec_per_km).toBeGreaterThan(0);
    expect(metrics.splits[0]?.avg_cadence_spm).toBe(172);
  });
});
