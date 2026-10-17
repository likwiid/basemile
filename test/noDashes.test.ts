// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * No em dashes, and no en dashes as punctuation, in anything the runner sees
 * or hears from the run-type picker, interval card, coach engine or Voice Mode.
 * Ranges use a plain hyphen ("136-154").
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createCoachEngine } from '@/lib/coach/engine';
import { evaluateSessionDirective, type SessionPhase } from '@/lib/coach/voiceMode';
import {
  BRIEF_VARIANTS,
  RUN_TYPE_IDS,
  runTypeCard,
  sessionForRunType,
  type BriefVariantId,
} from '@/lib/run/runTypes';
import type { UserProfile } from '@/types';

const DASH = /[–—]/;

const OWNED_SOURCES = [
  'lib/run/runTypes.ts',
  'lib/coach/engine.ts',
  'lib/coach/voiceMode.ts',
  'components/run/RunTypePicker.tsx',
  'components/run/IntervalProgress.tsx',
  'app/(tabs)/_layout.tsx',
  'app/(tabs)/index.tsx',
];

/** Source text with comments stripped, so only code and string literals remain. */
function codeOnly(path: string): string {
  return readFileSync(resolve(__dirname, '..', path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

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

describe('no em or en dashes in user-visible text', () => {
  it.each(OWNED_SOURCES)('%s has none outside comments', (path) => {
    const offending = codeOnly(path)
      .split('\n')
      .filter((line) => DASH.test(line));
    expect(offending).toEqual([]);
  });

  it('picker cards (every type, variant and rep count) use plain hyphens', () => {
    for (const id of RUN_TYPE_IDS) {
      for (const v of BRIEF_VARIANTS) {
        for (const reps of v.repsOptions) {
          const card = runTypeCard(id, profile, { variant: v.id, reps });
          const all = [card.name, card.tagline, ...card.chips, ...card.details.flatMap((d) => [d.label, d.value])];
          for (const text of all) expect(text).not.toMatch(DASH);
        }
      }
    }
  });

  it('every spoken coach cue across whole sessions is dash-free', () => {
    const sessions = [
      sessionForRunType('long', profile),
      sessionForRunType('medium', profile),
      ...BRIEF_VARIANTS.map((v) =>
        sessionForRunType('brief', profile, { variant: v.id as BriefVariantId })
      ),
    ];
    const texts = new Set<string>();
    for (const session of sessions) {
      const engine = createCoachEngine({
        session,
        verbosity: 'voice',
        nasalReminder: true,
        profile,
        readiness: { score: 70, label: 'good', components: {} } as never,
      });
      for (let t = 0; t < 75 * 60; t++) {
        const bpm = 110 + ((t * 37) % 80);
        for (const c of engine.tick({ bpm, timestamp: t * 1000 }, t * 1000, 150)) {
          texts.add(c.text ?? '');
        }
      }
      for (const c of engine.finish(75 * 60_000)) texts.add(c.text ?? '');
    }
    const band = { zone: 3 as const, floor: 136, ceiling: 154 };
    const phases: SessionPhase[] = ['steady', 'warmup', 'work', 'recover', 'done'];
    for (const phase of phases) {
      for (const bpm of [null, 120, 140, 156, 170]) {
        texts.add(evaluateSessionDirective(bpm, band, phase).text);
      }
    }
    expect(texts.size).toBeGreaterThan(20);
    expect([...texts].filter((t) => DASH.test(t))).toEqual([]);
  });
});
