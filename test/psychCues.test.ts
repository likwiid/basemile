// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  PSYCH_CUE_CATEGORIES,
  PSYCH_CUE_LINES,
  runPhase,
  selectPsychCue,
  SIGNATURE_LINE_ID,
  type PsychCueLine,
  type RunPhase,
  type SelectPsychCueInput,
} from '@/lib/coach/psychCues';

/** Deterministic PRNG so every selection in these tests is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function input(overrides: Partial<SelectPsychCueInput> = {}): SelectPsychCueInput {
  return {
    elapsedMs: 30 * 60_000,
    plannedDurationMs: 60 * 60_000,
    signal: null,
    usedLineIds: new Set<string>(),
    lastCategory: null,
    categoryLastUsedAt: new Map<string, number>(),
    recentLineTexts: [],
    signatureUsed: false,
    rand: mulberry32(42),
    ...overrides,
  };
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter((token) => /[a-zA-Z0-9]/.test(token)).length;
}

const MIN = 60_000;
const LATE_INTENSITY_IDS = ['lg-38', 'lg-39', 'lg-40', 'lg-41', 'lg-42', 'lg-43'];

/** Sequential picks with run.tsx-style state accumulation. */
function simulateRun(opts: {
  fromMin: number;
  toMin: number;
  stepMin: number;
  plannedMin: number;
  seed: number;
}): PsychCueLine[] {
  const rand = mulberry32(opts.seed);
  const used = new Set<string>();
  const categoryLastUsedAt = new Map<string, number>();
  let lastCategory: string | null = null;
  let recentTexts: string[] = [];
  let signatureUsed = false;
  const picked: PsychCueLine[] = [];

  for (let min = opts.fromMin; min <= opts.toMin; min += opts.stepMin) {
    const line = selectPsychCue({
      elapsedMs: min * MIN,
      plannedDurationMs: opts.plannedMin * MIN,
      signal: null,
      usedLineIds: used,
      lastCategory,
      categoryLastUsedAt,
      recentLineTexts: recentTexts,
      signatureUsed,
      rand,
    });
    if (!line) continue;
    picked.push(line);
    used.add(line.id);
    lastCategory = line.category;
    categoryLastUsedAt.set(line.category, min * MIN);
    recentTexts = [...recentTexts.slice(-1), line.text];
    if (line.id === SIGNATURE_LINE_ID) signatureUsed = true;
  }
  return picked;
}

describe('cue bank integrity', () => {
  it('holds the full research bank: 108 evidence lines + 47 long game lines', () => {
    const bankA = PSYCH_CUE_LINES.filter((line) => line.category !== 'identity_long_game');
    const bankB = PSYCH_CUE_LINES.filter((line) => line.category === 'identity_long_game');
    expect(PSYCH_CUE_LINES.length).toBe(155);
    expect(bankA.length).toBe(108);
    expect(bankB.length).toBe(47);
  });

  it('keeps every line speakable: ≤18 words, non-empty, phase-gated', () => {
    for (const line of PSYCH_CUE_LINES) {
      expect(line.text.trim().length).toBeGreaterThan(0);
      expect(wordCount(line.text), line.id).toBeLessThanOrEqual(18);
      expect(line.phases.length).toBeGreaterThan(0);
      expect(PSYCH_CUE_CATEGORIES).toContain(line.category);
    }
  });

  it('has unique ids and unique texts', () => {
    const ids = new Set(PSYCH_CUE_LINES.map((line) => line.id));
    const texts = new Set(PSYCH_CUE_LINES.map((line) => line.text));
    expect(ids.size).toBe(PSYCH_CUE_LINES.length);
    expect(texts.size).toBe(PSYCH_CUE_LINES.length);
  });

  it('gates the long game late-intensity block to the final third only', () => {
    for (const id of LATE_INTENSITY_IDS) {
      const line = PSYCH_CUE_LINES.find((candidate) => candidate.id === id);
      expect(line?.category).toBe('identity_long_game');
      expect(line?.phases).toEqual(['final']);
    }
    expect(SIGNATURE_LINE_ID).toBe('lg-38');
  });
});

describe('runPhase', () => {
  it('maps fractions of the planned duration to spec phases', () => {
    const planned = 60 * MIN;
    expect(runPhase(5 * MIN, planned)).toBe('opening'); // 8%
    expect(runPhase(30 * MIN, planned)).toBe('middle'); // 50%
    expect(runPhase(39 * MIN, planned)).toBe('doldrums'); // 65%
    expect(runPhase(45 * MIN, planned)).toBe('final'); // 75%
    expect(runPhase(58 * MIN, planned)).toBe('closing'); // 97%
  });

  it('assumes a 60-minute session without a plan and never reaches closing', () => {
    expect(runPhase(5 * MIN, null)).toBe('opening');
    expect(runPhase(20 * MIN, null)).toBe('middle');
    expect(runPhase(38 * MIN, null)).toBe('doldrums');
    expect(runPhase(50 * MIN, null)).toBe('final');
    expect(runPhase(500 * MIN, null)).toBe('final');
  });
});

describe('phase gating', () => {
  const phasePoints: readonly [RunPhase, number][] = [
    ['opening', 5],
    ['middle', 30],
    ['doldrums', 39],
    ['final', 45],
    ['closing', 58],
  ];

  it('only ever returns lines whose phases include the current phase', () => {
    for (const [phase, elapsedMin] of phasePoints) {
      for (let seed = 1; seed <= 100; seed++) {
        const line = selectPsychCue(input({ elapsedMs: elapsedMin * MIN, rand: mulberry32(seed) }));
        expect(line, `${phase} seed ${seed}`).not.toBeNull();
        expect(line?.phases, `${line?.id} in ${phase}`).toContain(phase);
      }
    }
  });

  it('never surfaces identity_long_game late-intensity lines in the opening', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const line = selectPsychCue(input({ elapsedMs: 5 * MIN, rand: mulberry32(seed) }));
      expect(LATE_INTENSITY_IDS).not.toContain(line?.id);
    }
  });

  it('can surface identity_long_game late-intensity lines in the final third', () => {
    const allButOne = new Set(
      PSYCH_CUE_LINES.filter((line) => line.id !== 'lg-39').map((line) => line.id)
    );
    const finalPick = selectPsychCue(input({ elapsedMs: 45 * MIN, usedLineIds: allButOne }));
    expect(finalPick?.id).toBe('lg-39');
    // The same last-remaining line is out of reach early in the run.
    const openingPick = selectPsychCue(input({ elapsedMs: 5 * MIN, usedLineIds: allButOne }));
    expect(openingPick).toBeNull();
  });
});

describe('anti-repetition', () => {
  it('never repeats a line within a simulated run', () => {
    for (const seed of [1, 7, 42, 99]) {
      const picks = simulateRun({ fromMin: 4, toMin: 88, stepMin: 3, plannedMin: 90, seed });
      expect(picks.length).toBeGreaterThan(15);
      const ids = picks.map((line) => line.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('never picks the same category back-to-back', () => {
    for (const seed of [1, 7, 42, 99]) {
      const picks = simulateRun({ fromMin: 4, toMin: 88, stepMin: 3, plannedMin: 90, seed });
      for (let i = 1; i < picks.length; i++) {
        expect(picks[i]?.category).not.toBe(picks[i - 1]?.category);
      }
    }
    for (let seed = 1; seed <= 200; seed++) {
      const line = selectPsychCue(
        input({ lastCategory: 'attentional_wide', rand: mulberry32(seed) })
      );
      expect(line?.category).not.toBe('attentional_wide');
    }
  });

  it('respects the 8-minute category cooldown', () => {
    const recentlyUsed = new Map([['attentional_wide', 26 * MIN]]);
    for (let seed = 1; seed <= 200; seed++) {
      const line = selectPsychCue(
        input({ elapsedMs: 30 * MIN, categoryLastUsedAt: recentlyUsed, rand: mulberry32(seed) })
      );
      expect(line?.category).not.toBe('attentional_wide');
    }

    const cooled = new Map([['attentional_wide', 21 * MIN]]); // 9 min ago
    let seen = false;
    for (let seed = 1; seed <= 500 && !seen; seed++) {
      const line = selectPsychCue(
        input({ elapsedMs: 30 * MIN, categoryLastUsedAt: cooled, rand: mulberry32(seed) })
      );
      if (line?.category === 'attentional_wide') seen = true;
    }
    expect(seen).toBe(true);
  });

  it('shortens the cooldown to 5 minutes in the doldrums', () => {
    const sixMinAgo = new Map([['identity_values', 33 * MIN]]);
    let seen = false;
    for (let seed = 1; seed <= 500 && !seen; seed++) {
      const line = selectPsychCue(
        input({ elapsedMs: 39 * MIN, categoryLastUsedAt: sixMinAgo, rand: mulberry32(seed) })
      );
      if (line?.category === 'identity_values') seen = true;
    }
    expect(seen).toBe(true);

    const fourMinAgo = new Map([['identity_values', 35 * MIN]]);
    for (let seed = 1; seed <= 200; seed++) {
      const line = selectPsychCue(
        input({ elapsedMs: 39 * MIN, categoryLastUsedAt: fourMinAgo, rand: mulberry32(seed) })
      );
      expect(line?.category).not.toBe('identity_values');
    }
  });

  it('blocks lines sharing a stem word with either of the last two cues', () => {
    const recent = [
      'You are strong and you are steady. Say it, mean it.',
      'Lengthen the exhale and feel your whole system settle.',
    ];
    for (let seed = 1; seed <= 300; seed++) {
      const line = selectPsychCue(
        input({ elapsedMs: 45 * MIN, recentLineTexts: recent, rand: mulberry32(seed) })
      );
      expect(line).not.toBeNull();
      expect(line?.text).not.toMatch(/strong|steady|exhale|settle/i);
    }
  });

  it('speaks the signature forty-percent line at most once per run', () => {
    const allButSignature = new Set(
      PSYCH_CUE_LINES.filter((line) => line.id !== SIGNATURE_LINE_ID).map((line) => line.id)
    );
    const fresh = selectPsychCue(input({ elapsedMs: 45 * MIN, usedLineIds: allButSignature }));
    expect(fresh?.id).toBe(SIGNATURE_LINE_ID);

    const spent = selectPsychCue(
      input({ elapsedMs: 45 * MIN, usedLineIds: allButSignature, signatureUsed: true })
    );
    expect(spent).toBeNull();
  });

  it('goes silent when the whole bank is exhausted', () => {
    const everything = new Set(PSYCH_CUE_LINES.map((line) => line.id));
    expect(selectPsychCue(input({ usedLineIds: everything }))).toBeNull();
  });
});

describe('signal triggers', () => {
  it('walks the spec category order for each signal', () => {
    expect(selectPsychCue(input({ signal: 'hr_drift' }))?.category).toBe('arousal_regulation');
    expect(selectPsychCue(input({ signal: 'climb' }))?.category).toBe('chunking');
    expect(selectPsychCue(input({ signal: 'pace_fade' }))?.category).toBe(
      'self_talk_motivational'
    );
    expect(selectPsychCue(input({ signal: 'post_pause' }))?.category).toBe(
      'self_talk_motivational'
    );
  });

  it('falls through the ordering when the lead category is blocked', () => {
    const backToBack = selectPsychCue(
      input({ signal: 'hr_drift', lastCategory: 'arousal_regulation' })
    );
    expect(backToBack?.category).toBe('attentional_narrow');

    const arousalSpent = new Set(
      PSYCH_CUE_LINES.filter((line) => line.category === 'arousal_regulation').map(
        (line) => line.id
      )
    );
    const exhausted = selectPsychCue(input({ signal: 'hr_drift', usedLineIds: arousalSpent }));
    expect(exhausted?.category).toBe('attentional_narrow');
  });

  it('bypasses the category cooldown on a signal fire', () => {
    const justUsed = new Map([['arousal_regulation', 29 * MIN]]);
    const line = selectPsychCue(
      input({ signal: 'hr_drift', elapsedMs: 30 * MIN, categoryLastUsedAt: justUsed })
    );
    expect(line?.category).toBe('arousal_regulation');
  });
});

describe('determinism', () => {
  it('returns the same line for the same seed and state', () => {
    const a = selectPsychCue(input({ rand: mulberry32(1234) }));
    const b = selectPsychCue(input({ rand: mulberry32(1234) }));
    expect(a).toEqual(b);
    expect(a).not.toBeNull();
  });
});
