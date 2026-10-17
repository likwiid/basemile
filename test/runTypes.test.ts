// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  BRIEF_VARIANTS,
  BRIEF_WARMUP_SEC,
  briefDurationMin,
  clampBriefReps,
  DEFAULT_BRIEF_VARIANT,
  DEFAULT_HIIT_REPS,
  DEFAULT_RUN_TYPE,
  HIIT_REPS_OPTIONS,
  hrBandForRunType,
  MEDIUM_WARMUP_SEC,
  normalizeLegacyRunType,
  RUN_TYPES,
  runTypeCard,
  runTypeDurationMin,
  runTypeLabel,
  sessionForRunType,
  type RunTypeProfile,
} from '@/lib/run/runTypes';

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

describe('run type catalogue', () => {
  it('lists Long, Medium, Brief in that order with Long as the default', () => {
    expect(RUN_TYPES.map((t) => t.id)).toEqual(['long', 'medium', 'brief']);
    expect(DEFAULT_RUN_TYPE).toBe('long');
    expect(RUN_TYPES.map((t) => t.name)).toEqual(['Long', 'Medium', 'Brief']);
    expect(runTypeLabel('medium')).toBe('Medium');
  });

  it('labels legacy persisted run types instead of throwing', () => {
    expect(runTypeLabel('z2_long')).toBe('Long');
    expect(runTypeLabel('intervals')).toBe('Brief');
    expect(runTypeLabel('something-else')).toBe('Long');
  });

  it('keeps guidance as short structured fragments, no paragraphs', () => {
    for (const spec of RUN_TYPES) {
      for (const text of [spec.tagline, spec.effort, spec.builds]) {
        expect(text.length).toBeLessThanOrEqual(32);
        expect(text).not.toMatch(/\.\s/);
      }
    }
  });
});

describe('runTypeCard', () => {
  it('long: duration, MAF band and nose-only chips; effort / target / builds rows', () => {
    const card = runTypeCard('long', PROFILE);
    expect(card.chips).toEqual(['60 min', '145-149 bpm', 'Nose only']);
    expect(card.details).toEqual([
      { label: 'Effort', value: 'Conversational, nose only' },
      { label: 'Target', value: '145-149 bpm' },
      { label: 'Builds', value: 'Stroke volume, fat burning' },
    ]);
  });

  it('medium: warm-up, 30 min work at the band, feel', () => {
    const card = runTypeCard('medium', PROFILE);
    expect(card.chips).toEqual(['35 min', '136-154 bpm', '5 min warm-up']);
    expect(card.details).toEqual([
      { label: 'Warm-up', value: '5 min easy' },
      { label: 'Work', value: '30 min at 136-154 bpm' },
      { label: 'Feel', value: 'Breathing hard, not gasping' },
    ]);
  });

  it('brief follows the variant and reps chips, clamping stale reps', () => {
    const hiit = runTypeCard('brief', PROFILE, { variant: 'hiit30', reps: 8 });
    expect(hiit.chips).toEqual(['19 min', '163-172 bpm', '8 × 30s']);
    expect(hiit.details).toEqual([
      { label: 'Warm-up', value: '7 min easy' },
      { label: 'Work', value: '30s all-out, 60s easy ×8' },
      { label: 'Target', value: '163-172 bpm' },
    ]);
    expect(runTypeCard('brief', PROFILE, { variant: 'hiit30', reps: 6 }).chips[0]).toBe('16 min');
    expect(runTypeCard('brief', PROFILE, { variant: 'hiit30', reps: 12 }).chips[0]).toBe('25 min');

    // Reps 12 persisted from HIIT must not leak into the fixed 4x4 (was "~103 min").
    const nor = runTypeCard('brief', PROFILE, { variant: 'norwegian44', reps: 12 });
    expect(nor.chips).toEqual(['39 min', '163-172 bpm', '4 × 4 min']);
    expect(nor.details[1]).toEqual({ label: 'Work', value: '4 min hard, 4 min easy ×4' });
  });

  it('duration chip always matches the armed session', () => {
    for (const variant of ['hiit30', 'norwegian44'] as const) {
      for (const reps of [4, 6, 8, 10, 12, 99]) {
        const session = sessionForRunType('brief', PROFILE, { variant, reps });
        expect(runTypeDurationMin('brief', { variant, reps })).toBe(session.duration_min);
        expect(runTypeCard('brief', PROFILE, { variant, reps }).chips[0]).toBe(
          `${session.duration_min} min`
        );
      }
    }
    expect(runTypeDurationMin('medium')).toBe(sessionForRunType('medium', PROFILE).duration_min);
    expect(runTypeDurationMin('long')).toBe(sessionForRunType('long', PROFILE).duration_min);
  });
});

describe('hrBandForRunType', () => {
  it('long is the MAF window under the zone-2 ceiling the engine enforces', () => {
    expect(hrBandForRunType('long', PROFILE)).toEqual({ floor: 145, ceiling: 149 });
    const manual = { ...PROFILE, zones: { ...PROFILE.zones, z2: [113, 152] as const } };
    expect(hrBandForRunType('long', manual)).toEqual({ floor: 148, ceiling: 152 });
    expect(hrBandForRunType('long', manual).ceiling).toBe(
      sessionForRunType('long', manual).hr_ceiling
    );
  });

  it('medium is 75-85% of max HR and brief is 90-95%', () => {
    expect(hrBandForRunType('medium', PROFILE)).toEqual({ floor: 136, ceiling: 154 });
    expect(hrBandForRunType('brief', PROFILE)).toEqual({ floor: 163, ceiling: 172 });
  });

  it.each([
    // hrMax, medium, brief (rounded to nearest bpm)
    [157, [118, 133], [141, 149]],
    [190, [143, 162], [171, 181]],
    [120, [90, 102], [108, 114]],
    [220, [165, 187], [198, 209]],
  ] as const)('hrMax %d gives medium %j and brief %j', (hrMax, medium, brief) => {
    const p = { ...PROFILE, hrMax };
    expect(hrBandForRunType('medium', p)).toEqual({ floor: medium[0], ceiling: medium[1] });
    expect(hrBandForRunType('brief', p)).toEqual({ floor: brief[0], ceiling: brief[1] });
  });

  it('bands never invert or overlap across the plausible hrMax range', () => {
    for (let hrMax = 100; hrMax <= 230; hrMax++) {
      const p = { ...PROFILE, hrMax };
      const m = hrBandForRunType('medium', p);
      const b = hrBandForRunType('brief', p);
      expect(m.floor).toBeLessThan(m.ceiling);
      expect(b.floor).toBeLessThan(b.ceiling);
      expect(m.ceiling).toBeLessThan(b.floor);
      expect(b.ceiling).toBeLessThanOrEqual(hrMax);
    }
  });
});

describe('sessionForRunType', () => {
  it('long keeps the zone-2 session shape the coach engine already understands', () => {
    const session = sessionForRunType('long', PROFILE);
    expect(session).toMatchObject({
      id: 'long',
      run_type: 'long',
      duration_min: 60,
      target_zone: 2,
      hr_ceiling: 149,
    });
    expect(session.hr_floor).toBeUndefined();
    expect(session.warmup_sec).toBeUndefined();
    expect(session.intervals).toBeUndefined();
  });

  it('medium is a 5 min warm-up plus a 30 min explicit band', () => {
    const session = sessionForRunType('medium', PROFILE);
    expect(session).toMatchObject({
      run_type: 'medium',
      duration_min: 35,
      target_zone: 3,
      hr_floor: 136,
      hr_ceiling: 154,
      warmup_sec: MEDIUM_WARMUP_SEC,
    });
    expect(session.intervals).toBeUndefined();
  });

  it('brief defaults to 30 on / 60 off × 8 after a 7 min warm-up', () => {
    const session = sessionForRunType('brief', PROFILE);
    expect(DEFAULT_BRIEF_VARIANT).toBe('hiit30');
    expect(session).toMatchObject({
      run_type: 'brief',
      target_zone: 5,
      hr_floor: 163,
      hr_ceiling: 172,
      warmup_sec: BRIEF_WARMUP_SEC,
    });
    expect(session.intervals).toEqual({
      work_sec: 30,
      rest_sec: 60,
      reps: DEFAULT_HIIT_REPS,
      intensity: 'z5',
      target_hr: 163,
      recovery_intensity: 'z1',
    });
    // 7 min warm-up + 8 × 90 s = 19 min
    expect(session.duration_min).toBe(19);
    expect(briefDurationMin('hiit30', 8)).toBe(19);
  });

  it('brief honours the reps chips and the Norwegian 4x4 variant', () => {
    const twelve = sessionForRunType('brief', PROFILE, { variant: 'hiit30', reps: 12 });
    expect(twelve.intervals?.reps).toBe(12);
    expect(twelve.duration_min).toBe(25);
    expect(twelve.id).toBe('brief-hiit30-12');

    const norwegian = sessionForRunType('brief', PROFILE, { variant: 'norwegian44' });
    expect(norwegian.intervals).toMatchObject({ work_sec: 240, rest_sec: 240, reps: 4 });
    expect(norwegian.duration_min).toBe(39);
  });
});

describe('brief variants and reps', () => {
  it('exposes the 6/8/10/12 chips for HIIT and fixed reps for the 4×4', () => {
    expect(HIIT_REPS_OPTIONS).toEqual([6, 8, 10, 12]);
    expect(BRIEF_VARIANTS.map((v) => v.id)).toEqual(['hiit30', 'norwegian44']);
    expect(BRIEF_VARIANTS[1]?.repsOptions).toEqual([4]);
  });

  it('clamps out-of-range reps back to the variant default', () => {
    expect(clampBriefReps('hiit30', 10)).toBe(10);
    expect(clampBriefReps('hiit30', 7)).toBe(8);
    expect(clampBriefReps('hiit30', 40)).toBe(8);
    expect(clampBriefReps('hiit30', undefined)).toBe(8);
    expect(clampBriefReps('norwegian44', 8)).toBe(4);
  });
});

describe('normalizeLegacyRunType', () => {
  it.each([
    ['z2_long', 'long'],
    ['z2_short', 'long'],
    ['rest', 'long'],
    ['lift', 'long'],
    ['intervals', 'brief'],
    ['time_trial', 'brief'],
    ['long', 'long'],
    ['medium', 'medium'],
    ['brief', 'brief'],
    ['garbage', 'long'],
    ['', 'long'],
  ])('maps %j to %s', (stored, expected) => {
    expect(normalizeLegacyRunType(stored)).toBe(expected);
  });
});
