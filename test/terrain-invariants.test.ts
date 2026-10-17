// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * GAP invariants (Fix 4) — locks the grade-adjusted-pace behavior permanently.
 * Pure terrain.ts only; synthetic GPS/HR builders, no db/expo imports.
 */
import { describe, expect, it } from 'vitest';

import { computeRunTerrainMetrics, gradeAdjustedPaceMultiplier } from '@/lib/metrics/terrain';
import type { GpsPoint } from '@/types';

const DEG_PER_M_LON = 1 / 111_320; // at latitude 0

/**
 * A straight east-bound run at constant 3 m/s: one fix every 5 s / 15 m.
 * `elevationAt` supplies altitude as a function of distance run (m).
 */
function buildRun(
  totalMeters: number,
  elevationAt: (distM: number) => number
): GpsPoint[] {
  const stepM = 15;
  const stepSec = 5;
  const n = Math.floor(totalMeters / stepM);
  return Array.from({ length: n + 1 }, (_, i) => ({
    timestamp: i * stepSec * 1000,
    latitude: 0,
    longitude: i * stepM * DEG_PER_M_LON,
    altitude: elevationAt(i * stepM),
    accuracy: 5,
  }));
}

/** Raw (terrain-space) pace of the synthetic run: 5 s per 15 m. */
const RAW_PACE_SEC_PER_KM = (5 / 15) * 1000; // 333.33

function avgGap(points: GpsPoint[]): number {
  const gap = computeRunTerrainMetrics(points).avg_gap_sec_per_km;
  expect(gap).not.toBeNull();
  return gap!;
}

describe('GAP invariants', () => {
  it('flat profile: GAP equals raw pace within 1%', () => {
    const gap = avgGap(buildRun(3000, () => 650));
    expect(Math.abs(gap - RAW_PACE_SEC_PER_KM) / RAW_PACE_SEC_PER_KM).toBeLessThan(0.01);
  });

  it('steady +6%: GAP equals raw / 1.292 within 1%', () => {
    const gap = avgGap(buildRun(3000, (d) => 600 + 0.06 * d));
    const expected = RAW_PACE_SEC_PER_KM / 1.292;
    expect(Math.abs(gap - expected) / expected).toBeLessThan(0.01);
    // Anchor the curve itself too.
    expect(gradeAdjustedPaceMultiplier(0.06)).toBeCloseTo(1.292, 2);
  });

  it('steady −6%: GAP equals raw / 0.893 within 1%', () => {
    const gap = avgGap(buildRun(3000, (d) => 800 - 0.06 * d));
    const expected = RAW_PACE_SEC_PER_KM / 0.893;
    expect(Math.abs(gap - expected) / expected).toBeLessThan(0.01);
    expect(gradeAdjustedPaceMultiplier(-0.06)).toBeCloseTo(0.893, 2);
  });

  it('oscillating ±3 m noise on flat ground: GAP within 2% of raw', () => {
    const gap = avgGap(
      buildRun(3000, (d) => 650 + ((d / 15) % 2 === 0 ? 3 : -3))
    );
    expect(Math.abs(gap - RAW_PACE_SEC_PER_KM) / RAW_PACE_SEC_PER_KM).toBeLessThan(0.02);
  });

  it('a descending km (net descent, <5 m ascent) never reads faster than raw', () => {
    // km 1 flat, km 2 steady −5%, km 3 rolling descent with tiny bumps (<5 m up).
    const points = buildRun(3000, (d) => {
      if (d <= 1000) return 700;
      if (d <= 2000) return 700 - 0.05 * (d - 1000);
      const bump = ((d / 15) % 4 === 0 ? 1 : 0); // ~1 m nudges, < 5 m per km
      return 650 - 0.04 * (d - 2000) + bump;
    });
    const metrics = computeRunTerrainMetrics(points);
    const descentKms = metrics.splits.filter(
      (s) => (s.descent_m ?? 0) > (s.ascent_m ?? 0) && (s.ascent_m ?? 0) < 5
    );
    expect(descentKms.length).toBeGreaterThanOrEqual(2);
    for (const split of descentKms) {
      // Descending grades in the road-realistic band have multiplier ≤ 1, so
      // the flat-equivalent (GAP) km is SLOWER-or-equal — descents may never
      // manufacture credit.
      expect(split.gap_sec_per_km ?? 0).toBeGreaterThanOrEqual(split.duration_sec);
    }
  });

  it('uphill credit and downhill penalty are asymmetric (no symmetric free speed)', () => {
    const up = avgGap(buildRun(3000, (d) => 600 + 0.06 * d));
    const down = avgGap(buildRun(3000, (d) => 800 - 0.06 * d));
    const upCredit = RAW_PACE_SEC_PER_KM - up; // positive: uphill GAP faster than raw
    const downPenalty = down - RAW_PACE_SEC_PER_KM; // positive: downhill GAP slower
    expect(upCredit).toBeGreaterThan(0);
    expect(downPenalty).toBeGreaterThan(0);
    expect(upCredit).toBeGreaterThan(downPenalty); // 1.292 vs 1/0.893 ≈ 1.12
  });
});
