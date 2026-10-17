// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  INJURY_RISK_LOOKBACK_MS,
  injuryRiskWarnings,
  weeklyDistanceKm,
} from '@/lib/metrics/injuryRisk';
import type { CompletedRun } from '@/types';

const now = Date.UTC(2026, 4, 15);

function run(id: string, daysAgo: number, km: number): CompletedRun {
  return {
    id,
    started_at: now - daysAgo * 24 * 60 * 60 * 1000,
    ended_at: now - daysAgo * 24 * 60 * 60 * 1000 + 60 * 60 * 1000,
    session_id: null,
    type: 'long',
    duration_sec: 3600,
    distance_m: km * 1000,
    avg_hr: 130,
    max_hr: 145,
    avg_pace_sec_per_km: 360,
    maf_pace_sec_per_km: null,
    zone_distribution: {
      z1_sec: 0,
      z2_sec: 3600,
      z3_sec: 0,
      z4_sec: 0,
      z5_sec: 0,
    },
    splits: [],
  };
}

describe('injuryRiskWarnings', () => {
  it('computes current and previous week mileage', () => {
    expect(
      weeklyDistanceKm(
        [run('current-1', 1, 10), run('current-2', 6, 8), run('previous', 8, 12)],
        now
      )
    ).toEqual({ currentKm: 18, previousKm: 12 });
  });

  it('warns on mileage jumps and repeated niggles', () => {
    const runs = [
      { ...run('current-1', 1, 10), context: { niggle: 'left achilles' } },
      { ...run('current-2', 2, 8), context: { niggle: 'Left Achilles' } },
      run('previous', 8, 10),
    ];

    expect(
      injuryRiskWarnings({
        runs,
        now,
      }).map((warning) => warning.id)
    ).toEqual(['mileage-jump', 'repeated-niggle']);
  });

  it('ignores runs older than the lookback, so callers may pre-filter', () => {
    const runs = [
      { ...run('later', -3, 6), context: { niggle: 'calf', surface: 'road' as const } },
      { ...run('current-1', 1, 10), context: { niggle: 'calf', surface: 'road' as const } },
      { ...run('current-2', 2, 8), context: { surface: 'track' as const } },
      run('previous', 8, 10),
      { ...run('edge', 29.9, 4), context: { niggle: 'knee' } },
      { ...run('old', 31, 4), context: { niggle: 'knee' } },
      { ...run('older', 60, 30), context: { niggle: 'knee', surface: 'road' as const } },
    ];
    const full = injuryRiskWarnings({ runs, now });
    const windowed = injuryRiskWarnings({
      runs: runs.filter((r) => r.started_at >= now - INJURY_RISK_LOOKBACK_MS),
      now,
    });
    expect(windowed).toEqual(full);
    expect(full.map((w) => w.id)).toEqual([
      'mileage-jump',
      'repeated-niggle',
      'hard-surface-streak',
    ]);
  });
});
