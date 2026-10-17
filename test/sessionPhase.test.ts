// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  evaluateSessionDirective,
  sessionPhaseAt,
  sessionTargetBand,
} from '@/lib/coach/voiceMode';
import { spokenBpm } from '@/lib/coach/spoken';
import { firstRunDayISO, weeklyMafDrift, weeklyZ2Minutes } from '@/lib/metrics/maf';
import { sessionForRunType, type RunTypeProfile } from '@/lib/run/runTypes';
import type { CompletedRun } from '@/types';

const PROFILE: RunTypeProfile = {
  hrMax: 181,
  zones: {
    z1: [49, 113],
    z2: [113, 149],
    z3: [149, 162],
    z4: [162, 176],
    z5: [176, 181],
  },
};

describe('sessionPhaseAt', () => {
  it('a long run is steady throughout', () => {
    const long = sessionForRunType('long', PROFILE);
    expect(sessionPhaseAt(long, 0)).toBe('steady');
    expect(sessionPhaseAt(long, 50 * 60_000)).toBe('steady');
    expect(sessionPhaseAt(null, 10_000)).toBe('steady');
  });

  it('medium is warm-up for 5 min then work', () => {
    const medium = sessionForRunType('medium', PROFILE);
    expect(sessionPhaseAt(medium, 299_000)).toBe('warmup');
    expect(sessionPhaseAt(medium, 300_000)).toBe('work');
    expect(sessionPhaseAt(medium, 35 * 60_000 - 1)).toBe('work');
    expect(sessionPhaseAt(medium, 35 * 60_000)).toBe('done');
  });

  it('brief walks warm-up → work → recover → done', () => {
    const brief = sessionForRunType('brief', PROFILE, { reps: 6 });
    const warm = 7 * 60_000;
    expect(sessionPhaseAt(brief, warm - 1)).toBe('warmup');
    expect(sessionPhaseAt(brief, warm)).toBe('work');
    expect(sessionPhaseAt(brief, warm + 30_000)).toBe('recover');
    expect(sessionPhaseAt(brief, warm + 90_000)).toBe('work');
    // The rest after rep 6 is the cool-down, not another recovery.
    expect(sessionPhaseAt(brief, warm + 5 * 90_000 + 29_999)).toBe('work');
    expect(sessionPhaseAt(brief, warm + 5 * 90_000 + 30_000)).toBe('done');
    expect(sessionPhaseAt(brief, warm + 6 * 90_000)).toBe('done');
  });

  it('4x4 ends at the last rep, not after its 4 min rest', () => {
    const nor = sessionForRunType('brief', PROFILE, { variant: 'norwegian44' });
    const warm = 7 * 60_000;
    expect(sessionPhaseAt(nor, warm + 3 * 480_000 + 239_999)).toBe('work');
    expect(sessionPhaseAt(nor, warm + 3 * 480_000 + 240_000)).toBe('done');
    expect(sessionPhaseAt(nor, warm + 2 * 480_000 + 240_000)).toBe('recover');
  });
});

describe('sessionTargetBand', () => {
  it('returns the explicit band for medium/brief and null for long', () => {
    expect(sessionTargetBand(sessionForRunType('long', PROFILE))).toBeNull();
    expect(sessionTargetBand(sessionForRunType('medium', PROFILE))).toEqual({
      zone: 3,
      floor: 136,
      ceiling: 154,
    });
    expect(sessionTargetBand(sessionForRunType('brief', PROFILE))).toEqual({
      zone: 5,
      floor: 163,
      ceiling: 172,
    });
  });
});

describe('evaluateSessionDirective', () => {
  const band = { zone: 5 as const, floor: 163, ceiling: 172 };

  it('never says faster or slower during warm-up or recovery', () => {
    const warm = evaluateSessionDirective(120, band, 'warmup');
    expect(warm.state).toBe('in');
    expect(warm.text).toBe('120. Warm-up. Keep it easy.');

    const recover = evaluateSessionDirective(140, band, 'recover');
    expect(recover.state).toBe('in');
    expect(recover.text).toContain('Recover');

    const done = evaluateSessionDirective(150, band, 'done');
    expect(done.text).toBe('150. Cool down. Keep it easy.');
    expect(done.text).not.toContain('Reps done');
  });

  it('is the strict band directive during work and steady phases', () => {
    expect(evaluateSessionDirective(150, band, 'work').state).toBe('below');
    expect(evaluateSessionDirective(180, band, 'steady').state).toBe('above');
    expect(evaluateSessionDirective(null, band, 'warmup').state).toBe('no_signal');
  });
});

describe('spokenBpm', () => {
  it.each([
    [136, 'one thirty-six'],
    [154, 'one fifty-four'],
    [163, 'one sixty-three'],
    [172, 'one seventy-two'],
    [105, 'one oh five'],
    [100, 'one hundred'],
    [98, 'ninety-eight'],
    [7, 'seven'],
  ])('%d → %s', (bpm, words) => {
    expect(spokenBpm(bpm)).toBe(words);
  });
});

function run(id: string, startedAt: number, mafPace: number | null, z2Sec = 1800): CompletedRun {
  return {
    id,
    started_at: startedAt,
    ended_at: startedAt + 3_600_000,
    session_id: null,
    type: 'long',
    duration_sec: 3600,
    distance_m: 8000,
    avg_hr: 140,
    max_hr: 150,
    avg_pace_sec_per_km: 450,
    maf_pace_sec_per_km: mafPace,
    zone_distribution: { z1_sec: 0, z2_sec: z2Sec, z3_sec: 0, z4_sec: 0, z5_sec: 0 },
    splits: [],
  };
}

describe('weekly buckets anchored on the first run', () => {
  const day0 = new Date(2026, 4, 6, 9).getTime(); // local May 6 09:00
  const DAY = 24 * 60 * 60 * 1000;

  it('firstRunDayISO is the earliest run local day, null without runs', () => {
    expect(firstRunDayISO([])).toBeNull();
    expect(firstRunDayISO([run('b', day0 + 3 * DAY, 400), run('a', day0, 420)])).toBe(
      '2026-05-06'
    );
  });

  it('weeklyMafDrift needs no start date and numbers weeks from the first run', () => {
    const drift = weeklyMafDrift([
      run('a', day0, 420),
      run('b', day0 + 2 * DAY, 400),
      run('c', day0 + 8 * DAY, 390),
    ]);
    expect(drift.map((d) => d.weekNumber)).toEqual([1, 2]);
    expect(drift[0]?.weekStart).toBe('2026-05-06');
    expect(drift[0]?.pace_sec_per_km).toBe(410);
    expect(drift[1]?.pace_sec_per_km).toBe(390);
    expect(weeklyMafDrift([])).toEqual([]);
  });

  it('weeklyZ2Minutes emits zero weeks between runs', () => {
    const weeks = weeklyZ2Minutes(
      [run('a', day0, null, 1800), run('c', day0 + 15 * DAY, null, 2400)],
      new Date(day0 + 16 * DAY)
    );
    expect(weeks.map((w) => w.z2_minutes)).toEqual([30, 0, 40]);
    expect(weeks.map((w) => w.total_minutes)).toEqual([60, 0, 60]);
  });
});
