// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { createCoachEngine } from '@/lib/coach/engine';
import { sessionForRunType } from '@/lib/run/runTypes';
import type { CoachCue, UserProfile } from '@/types';

const profile: UserProfile = {
  name: 'Test',
  age: 30,
  sex: 'male',
  weight_kg: 80,
  height_cm: 180,
  hrMax: 181,
  hrRest: 50,
  mafCeiling: 149,
  zones: {
    z1: [49, 113],
    z2: [113, 149],
    z3: [149, 162],
    z4: [162, 176],
    z5: [176, 181],
  },
  eatingWindow: { start: '07:00', end: '16:00' },
  liftingDays: [],
  runningDays: [],
};

function engineFor(runType: 'medium' | 'brief') {
  return createCoachEngine({
    session: sessionForRunType(runType, profile),
    verbosity: 'voice',
    nasalReminder: false,
    profile,
    screamModeEnabled: false,
  });
}

function texts(cues: CoachCue[]): string[] {
  return cues.map((c) => c.text ?? '');
}

describe('coach engine warm-up phase', () => {
  it('opens a medium run with the warm-up cue and stays silent about the band until it ends', () => {
    const engine = engineFor('medium');
    const first = engine.tick({ bpm: 120, timestamp: 0 }, 1_000);
    expect(texts(first)).toContain('Easy warm-up. 5 minutes, then we lift the effort.');

    // Well below the 136 floor and then above the 154 ceiling — still warm-up.
    const low = engine.tick({ bpm: 110, timestamp: 0 }, 120_000);
    const high = engine.tick({ bpm: 165, timestamp: 0 }, 200_000);
    expect([...low, ...high].filter((c) => c.kind !== 'periodic_checkin')).toEqual([]);
    expect(engine.getState().intervalPhase).toBe('warmup');
  });

  it('announces the spoken band when the medium warm-up ends, then coaches above/below', () => {
    const engine = engineFor('medium');
    engine.tick({ bpm: 120, timestamp: 0 }, 1_000);
    const end = engine.tick({ bpm: 130, timestamp: 0 }, 300_000);
    expect(texts(end)).toContain(
      'Warm-up done. Take it up to one thirty-six to one fifty-four.'
    );
    expect(engine.getState().intervalPhase).toBe('work');

    // Over the ceiling → ease off.
    const over = engine.tick({ bpm: 160, timestamp: 0 }, 330_000);
    expect(over.some((c) => c.kind === 'zone_exceeded')).toBe(true);
    expect(texts(over).join(' ')).toContain('back under 154');

    // Back in range → recovered.
    const back = engine.tick({ bpm: 145, timestamp: 0 }, 360_000);
    expect(back.some((c) => c.kind === 'zone_recovered')).toBe(true);

    // Under the floor after the settle window → pick it up.
    const under = engine.tick({ bpm: 125, timestamp: 0 }, 420_000);
    expect(under.some((c) => c.kind === 'interval_push')).toBe(true);
    expect(texts(under).join(' ')).toContain('target 136 to 154');
  });

  it('brief uses the 7 min session warm-up and folds go-faster into the warm-up-end cue', () => {
    const engine = engineFor('brief');
    const first = engine.tick({ bpm: 120, timestamp: 0 }, 1_000);
    expect(texts(first)).toContain('Easy warm-up. 7 minutes, then we lift the effort.');

    // 30 s before the first rep at 7:00, not at the old 10:00 default.
    const preWarn = engine.tick({ bpm: 130, timestamp: 0 }, 7 * 60_000 - 20_000);
    expect(preWarn.some((c) => c.kind === 'interval_warmup')).toBe(true);

    const end = engine.tick({ bpm: 135, timestamp: 0 }, 7 * 60_000);
    const startCues = end.filter((c) => c.kind === 'interval_start');
    expect(startCues).toHaveLength(1);
    expect(startCues[0]?.text).toBe(
      'Warm-up done. Go faster now. Take it up to one sixty-three to one seventy-two.'
    );
    expect(engine.getState()).toMatchObject({ intervalPhase: 'work', activeInterval: 0 });

    // First recovery block starts 30 s after the first rep.
    const recover = engine.tick({ bpm: 170, timestamp: 0 }, 7 * 60_000 + 31_000);
    expect(recover.some((c) => c.kind === 'interval_recover')).toBe(true);
  });
});
