// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { runInsights, runReport } from '@/lib/metrics/insights';
import { computeZonesFromKarvonen } from '@/lib/zones';
import type { CompletedRun } from '@/types';

const zones = computeZonesFromKarvonen(190, 49, 149);

function runFixture(): CompletedRun {
  return {
    id: 'run-1',
    started_at: 1_000_000,
    ended_at: 1_000_000 + 35 * 60_000 + 7_000,
    session_id: null,
    type: 'long',
    duration_sec: 35 * 60 + 7,
    distance_m: 4100,
    avg_hr: 134,
    max_hr: 153,
    avg_pace_sec_per_km: 514,
    maf_pace_sec_per_km: 522,
    zone_distribution: {
      z1_sec: 180,
      z2_sec: 29 * 60,
      z3_sec: 180,
      z4_sec: 7,
      z5_sec: 0,
    },
    splits: [
      { km: 1, duration_sec: 552, avg_hr: 118 },
      { km: 2, duration_sec: 464, avg_hr: 138 },
      { km: 3, duration_sec: 542, avg_hr: 138 },
      { km: 4, duration_sec: 470, avg_hr: 140 },
    ],
  };
}

function previousRunFixture(overrides: Partial<CompletedRun>): CompletedRun {
  return {
    ...runFixture(),
    id: 'previous-run',
    started_at: 1_000_000 - 86_400_000,
    ended_at: 1_000_000 - 86_400_000 + 35 * 60_000,
    duration_sec: 35 * 60,
    distance_m: 4000,
    avg_hr: 132,
    max_hr: 148,
    avg_pace_sec_per_km: 525,
    maf_pace_sec_per_km: 530,
    zone_distribution: {
      z1_sec: 240,
      z2_sec: 1680,
      z3_sec: 180,
      z4_sec: 0,
      z5_sec: 0,
    },
    splits: [
      { km: 1, duration_sec: 540, avg_hr: 120 },
      { km: 2, duration_sec: 520, avg_hr: 132 },
      { km: 3, duration_sec: 520, avg_hr: 133 },
      { km: 4, duration_sec: 520, avg_hr: 134 },
    ],
    ...overrides,
  };
}

describe('runInsights', () => {
  it('generates deterministic Run #1 observations', () => {
    const run = runFixture();
    const samples = [
      { timestamp: run.started_at + 60_000, bpm: 118 },
      { timestamp: run.ended_at - 30_000, bpm: 153 },
    ];

    expect(runInsights(run, zones, samples)).toEqual([
      'Pace slowed on Km 3 at the same HR, likely early fatigue.',
      'Brief Z3 spike on the finishing kick.',
      '91% at or below Z2. Excellent aerobic discipline.',
    ]);
  });

  it('builds a richer deterministic post-run report', () => {
    const run = runFixture();
    const samples = [
      { timestamp: run.started_at + 60_000, bpm: 118 },
      { timestamp: run.ended_at - 30_000, bpm: 153 },
    ];
    const previousRuns = [
      previousRunFixture({ id: 'previous-1' }),
      previousRunFixture({
        id: 'previous-2',
        started_at: 1_000_000 - 2 * 86_400_000,
        avg_hr: 136,
        avg_pace_sec_per_km: 505,
        maf_pace_sec_per_km: 512,
        zone_distribution: {
          z1_sec: 320,
          z2_sec: 1600,
          z3_sec: 180,
          z4_sec: 0,
          z5_sec: 0,
        },
      }),
      previousRunFixture({
        id: 'different-session',
        started_at: 1_000_000 - 3 * 86_400_000,
        type: 'brief',
      }),
    ];

    expect(runReport(run, zones, samples, previousRuns)).toEqual({
      mafProgress: {
        title: 'MAF progress',
        items: [
          'Today: 8:42/km at MAF.',
          'Vs most recent similar MAF run: 0:08/km faster.',
          'Vs similar-run average: 0:01/km slower.',
        ],
      },
      whatHappened: {
        title: 'What happened',
        items: [
          'You ran 4.10 km in 35:07 at 8:34/km, averaging 134 bpm.',
          '83% of recorded HR time landed in Z2.',
          'Peak HR was 153 bpm.',
          'Brief Z3 spike on the finishing kick.',
        ],
      },
      next: {
        title: 'What to do next',
        items: [
          'Repeat this effort profile: easy start, steady middle, no need to chase pace.',
          'Keep using MAF pace as the main progress marker for the next comparable run.',
        ],
      },
      splits: {
        title: 'Split commentary',
        items: [
          'Fastest split: Km 2 at 7:44. Slowest: Km 1 at 9:12.',
          'First-to-last split moved 82s faster with HR +22 bpm.',
          'Pace slowed on Km 3 at the same HR, likely early fatigue.',
        ],
      },
      comparison: {
        title: 'Vs last 3 similar runs',
        items: [
          'Compared against 2 similar runs.',
          'Average pace was 0:01/km faster than that group.',
          'Average HR was even vs that group.',
          'Z2 time was +5 pts vs that group.',
        ],
      },
    });
  });

  it('keeps MAF guidance explicit when no MAF pace was captured', () => {
    const run = { ...runFixture(), maf_pace_sec_per_km: null };

    expect(runReport(run, zones).mafProgress.items).toEqual([
      'No MAF pace was captured inside the MAF window. Next run, settle into that range long enough to record a clean aerobic marker.',
    ]);
  });
});
