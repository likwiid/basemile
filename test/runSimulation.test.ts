// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Whole-session walks through the coach engine: every run type and brief
 * variant ticked at 1 Hz from 0 to past the planned end with a synthetic HR
 * timeline, asserting the cue script (warm-up bookends, rep boundaries, no
 * nags outside work, one "reps done").
 */
import { describe, expect, it } from 'vitest';

import { createCoachEngine } from '@/lib/coach/engine';
import { sessionPhaseAt, type SessionPhase } from '@/lib/coach/voiceMode';
import {
  BRIEF_WARMUP_SEC,
  MEDIUM_WARMUP_SEC,
  sessionForRunType,
  type BriefVariantId,
} from '@/lib/run/runTypes';
import type { CoachCueKind, Session, UserProfile } from '@/types';

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

interface Logged {
  /** Run-elapsed seconds (paused time excluded). */
  t: number;
  kind: CoachCueKind;
  text: string;
  phase: SessionPhase;
}

type HrModel = (tSec: number, phase: SessionPhase) => number;

interface SimOptions {
  /** Elapsed second at which the first HR sample arrives. */
  firstSampleSec?: number;
  /** Stop ticking at this elapsed second (exclusive). */
  endSec: number;
  /** Pauses as [atElapsedSec, wallSeconds]; elapsed does not advance. */
  pauses?: readonly (readonly [number, number])[];
}

function simulate(session: Session, hr: HrModel, opts: SimOptions): Logged[] {
  const engine = createCoachEngine({
    session,
    verbosity: 'voice',
    nasalReminder: false,
    profile,
    screamModeEnabled: false,
    fuelingRemindersEnabled: false,
  });
  const log: Logged[] = [];
  const pauses = new Map(opts.pauses ?? []);
  let wall = 0;
  for (let t = opts.firstSampleSec ?? 1; t < opts.endSec; t++) {
    // While paused the store drops samples, so the engine is simply not ticked
    // and run-elapsed (wall minus paused) does not advance.
    wall += 1 + (pauses.get(t) ?? 0);
    const phase = sessionPhaseAt(session, t * 1000);
    const cues = engine.tick({ bpm: hr(t, phase), timestamp: wall * 1000 }, t * 1000);
    for (const c of cues) log.push({ t, kind: c.kind, text: c.text ?? '', phase });
  }
  return log;
}

const NAG_KINDS: readonly CoachCueKind[] = ['zone_exceeded', 'interval_push'];

function nags(log: Logged[]): Logged[] {
  return log.filter((l) => NAG_KINDS.includes(l.kind));
}

function withText(log: Logged[], fragment: string): Logged[] {
  return log.filter((l) => l.text.includes(fragment));
}

// Deliberately hostile HR: way over the band in warm-up and recovery, under
// the floor in work. Only work/steady phases may react.
const hostile: HrModel = (_t, phase) => {
  switch (phase) {
    case 'warmup':
      return 178;
    case 'recover':
    case 'done':
      return 179;
    case 'work':
    case 'steady':
      return 150;
  }
};

describe('medium run, full session', () => {
  const session = sessionForRunType('medium', profile);
  const warm = MEDIUM_WARMUP_SEC;
  const end = session.duration_min * 60;

  it('opens with one warm-up cue and closes the warm-up once, at 5:00', () => {
    const log = simulate(session, hostile, { endSec: end + 300 });
    const starts = log.filter((l) => l.kind === 'interval_warmup');
    expect(starts).toHaveLength(1);
    expect(starts[0]?.t).toBe(1);
    expect(starts[0]?.text).toBe('Easy warm-up. 5 minutes, then we lift the effort.');
    const ends = withText(log, 'Warm-up done');
    expect(ends).toHaveLength(1);
    expect(ends[0]?.t).toBe(warm);
  });

  it('never nags during the warm-up, however far out of band HR is', () => {
    const log = simulate(session, hostile, { endSec: end });
    expect(nags(log).filter((l) => l.t < warm)).toEqual([]);
  });

  it('coaches the band during the 30 min block and nothing after it', () => {
    const swing: HrModel = (t, phase) => (phase === 'warmup' ? 120 : t % 240 < 120 ? 158 : 130);
    const log = simulate(session, swing, { endSec: end + 600 });
    const inBlock = nags(log).filter((l) => l.t >= warm && l.t < end);
    expect(inBlock.some((l) => l.kind === 'zone_exceeded')).toBe(true);
    expect(inBlock.some((l) => l.kind === 'interval_push')).toBe(true);
    expect(nags(log).filter((l) => l.t >= end)).toEqual([]);
    const done = withText(log, 'Cool down');
    expect(done).toHaveLength(1);
    expect(done[0]?.t).toBe(end);
  });
});

interface BriefCase {
  variant: BriefVariantId;
  reps: number;
  workSec: number;
  restSec: number;
}

const BRIEF_CASES: readonly BriefCase[] = [
  { variant: 'hiit30', reps: 6, workSec: 30, restSec: 60 },
  { variant: 'hiit30', reps: 8, workSec: 30, restSec: 60 },
  { variant: 'hiit30', reps: 12, workSec: 30, restSec: 60 },
  { variant: 'norwegian44', reps: 4, workSec: 240, restSec: 240 },
];

describe.each(BRIEF_CASES)(
  'brief $variant x$reps, full session',
  ({ variant, reps, workSec, restSec }) => {
    const session = sessionForRunType('brief', profile, { variant, reps });
    const warm = BRIEF_WARMUP_SEC;
    const cycle = workSec + restSec;
    const lastWorkEnd = warm + (reps - 1) * cycle + workSec;
    const log = simulate(session, hostile, { endSec: warm + reps * cycle + 600 });

    it('arms the right block', () => {
      expect(session.intervals).toMatchObject({ reps, work_sec: workSec, rest_sec: restSec });
      expect(session.warmup_sec).toBe(warm);
    });

    it('warm-up: one start cue, one 30 s pre-warn, then go-faster at 7:00', () => {
      expect(log.filter((l) => l.t < warm).map((l) => [l.t, l.kind])).toEqual([
        [1, 'interval_warmup'],
        [warm - 30, 'interval_warmup'],
      ]);
      const atWarmEnd = log.filter((l) => l.t === warm);
      expect(atWarmEnd.map((l) => l.kind)).toEqual(['interval_start']);
      expect(atWarmEnd[0]?.text).toContain('Warm-up done. Go faster now.');
    });

    it('starts each rep on its boundary, exactly once, final rep flagged', () => {
      const starts = log.filter(
        (l) => l.kind === 'interval_start' || l.kind === 'final_interval'
      );
      expect(starts.map((l) => l.t)).toEqual(
        Array.from({ length: reps }, (_, i) => warm + i * cycle)
      );
      expect(starts.filter((l) => l.kind === 'final_interval')).toHaveLength(1);
      expect(starts.at(-1)?.kind).toBe('final_interval');
    });

    it('rests between reps only, each once, with one pre-warn before every next rep', () => {
      const rests = log.filter((l) => l.kind === 'interval_recover' && l.text.startsWith('Rest'));
      expect(rests.map((l) => l.t)).toEqual(
        Array.from({ length: reps - 1 }, (_, i) => warm + i * cycle + workSec)
      );
      const preWarns = log.filter((l) => l.kind === 'interval_warmup' && l.t >= warm);
      expect(preWarns.map((l) => l.t)).toEqual(
        Array.from({ length: reps - 1 }, (_, i) => warm + (i + 1) * cycle - 30)
      );
    });

    it('says reps done exactly once, when the last work block ends', () => {
      const done = withText(log, 'Reps done');
      expect(done).toHaveLength(1);
      expect(done[0]?.t).toBe(lastWorkEnd);
      expect(log.filter((l) => l.t > lastWorkEnd)).toEqual([]);
    });

    it('never nags in warm-up, recovery or after the last rep', () => {
      expect(nags(log).filter((l) => l.phase !== 'work')).toEqual([]);
      expect(log.filter((l) => l.kind === 'zone_exceeded')).toEqual([]);
    });

    it('acknowledges recovery at most once per rest', () => {
      const calm = simulate(session, (_t, phase) => (phase === 'work' ? 170 : 110), {
        endSec: warm + reps * cycle + 60,
      });
      const acks = calm.filter((l) => l.kind === 'interval_recovered');
      expect(acks).toHaveLength(reps - 1);
      expect(new Set(acks.map((l) => Math.floor((l.t - warm) / cycle))).size).toBe(reps - 1);
    });
  }
);

describe('brief work-block push cue', () => {
  it('4x4: waits for HR to climb and repeats at most once a minute per rep', () => {
    const session = sessionForRunType('brief', profile, { variant: 'norwegian44' });
    const log = simulate(session, (_t, phase) => (phase === 'work' ? 150 : 120), {
      endSec: BRIEF_WARMUP_SEC + 4 * 480,
    });
    const pushes = log.filter((l) => l.kind === 'interval_push');
    const rep0 = pushes.filter((l) => l.t < BRIEF_WARMUP_SEC + 240);
    expect(rep0[0]?.t).toBe(BRIEF_WARMUP_SEC + 90);
    expect(rep0.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < rep0.length; i++) {
      expect((rep0[i]?.t ?? 0) - (rep0[i - 1]?.t ?? 0)).toBeGreaterThanOrEqual(60);
    }
    expect(rep0[0]?.text).toBe('Go faster. Push to 163 bpm.');
  });

  it('hiit30: no push cue, the 30 s block is over before HR can respond', () => {
    const session = sessionForRunType('brief', profile, { variant: 'hiit30', reps: 8 });
    const log = simulate(session, () => 120, { endSec: BRIEF_WARMUP_SEC + 8 * 90 });
    expect(log.filter((l) => l.kind === 'interval_push')).toEqual([]);
  });
});

describe('pause / resume', () => {
  const brief = sessionForRunType('brief', profile, { variant: 'hiit30', reps: 6 });
  const medium = sessionForRunType('medium', profile);
  const script = (log: Logged[]) => log.map((l) => `${l.t}:${l.kind}:${l.text}`);

  it('a pause mid-warm-up or mid-rep leaves the elapsed-time script unchanged', () => {
    const end = BRIEF_WARMUP_SEC + 6 * 90 + 120;
    const plain = simulate(brief, hostile, { endSec: end });
    const paused = simulate(brief, hostile, {
      endSec: end,
      pauses: [
        [200, 600],
        [BRIEF_WARMUP_SEC + 95, 300],
      ],
    });
    expect(script(paused)).toEqual(script(plain));

    const mEnd = medium.duration_min * 60 + 60;
    expect(script(simulate(medium, hostile, { endSec: mEnd, pauses: [[150, 900]] }))).toEqual(
      script(simulate(medium, hostile, { endSec: mEnd }))
    );
  });
});

describe('late first HR sample', () => {
  it('still announces the warm-up, with the minutes actually left', () => {
    const medium = sessionForRunType('medium', profile);
    const log = simulate(medium, () => 120, { firstSampleSec: 95, endSec: 200 });
    const start = log.filter((l) => l.kind === 'interval_warmup');
    expect(start).toHaveLength(1);
    expect(start[0]?.t).toBe(95);
    expect(start[0]?.text).toBe('Easy warm-up. About 3 minutes left, then we lift the effort.');
  });

  it('a strap that connects after the warm-up skips straight to the band cue', () => {
    const medium = sessionForRunType('medium', profile);
    const log = simulate(medium, () => 140, { firstSampleSec: 400, endSec: 460 });
    expect(log.filter((l) => l.kind === 'interval_warmup')).toEqual([]);
    expect(withText(log, 'Warm-up done')).toHaveLength(1);
  });
});

describe('finished early', () => {
  it('finish() mid-rep emits only session_complete', () => {
    const brief = sessionForRunType('brief', profile, { variant: 'hiit30', reps: 8 });
    const engine = createCoachEngine({
      session: brief,
      verbosity: 'voice',
      nasalReminder: false,
      profile,
    });
    engine.tick({ bpm: 170, timestamp: 0 }, (BRIEF_WARMUP_SEC + 10) * 1000);
    const cues = engine.finish((BRIEF_WARMUP_SEC + 11) * 1000);
    expect(cues.map((c) => c.kind)).toEqual(['session_complete']);
  });
});

describe('long run', () => {
  it('has no warm-up, interval or done cues and still coaches the MAF ceiling', () => {
    const long = sessionForRunType('long', profile);
    const hr: HrModel = (t) => (t > 1200 && t < 1260 ? 158 : 140);
    const log = simulate(long, hr, { endSec: 70 * 60 });
    const kinds = new Set(log.map((l) => l.kind));
    for (const k of ['interval_warmup', 'interval_start', 'interval_recover', 'final_interval'] as const) {
      expect(kinds.has(k)).toBe(false);
    }
    expect(log.filter((l) => l.kind === 'zone_exceeded')[0]?.t).toBe(1201);
    expect(log.every((l) => l.phase === 'steady')).toBe(true);
  });
});
