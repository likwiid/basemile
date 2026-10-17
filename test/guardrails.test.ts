// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { createCoachEngine } from '@/lib/coach/engine';
import {
  evaluateLiveGuardrails,
  normalizeSessionZones,
  zoneEtaSec,
  type LiveGuardrailSample,
} from '@/lib/coach/guardrails';
import type { Session, UserProfile, ZoneConfig } from '@/types';

const zones: ZoneConfig = {
  z1: [50, 100],
  z2: [100, 140],
  z3: [140, 155],
  z4: [155, 170],
  z5: [170, 190],
};

const session: Session = {
  id: 'long',
  run_type: 'long',
  duration_min: 40,
  target_zone: 2,
  hr_ceiling: 149,
  notes: 'Z2',
};

const profile: UserProfile = {
  name: 'Test',
  age: 30,
  sex: 'male',
  weight_kg: 80,
  height_cm: 180,
  hrMax: 190,
  hrRest: 50,
  mafCeiling: 140,
  zones,
  eatingWindow: { start: '07:00', end: '16:00' },
  liftingDays: [],
  runningDays: ['saturday'],
};

function samples(points: readonly [number, number][]): LiveGuardrailSample[] {
  return points.map(([elapsedMs, bpm]) => ({ elapsedMs, bpm }));
}

describe('live guardrails', () => {
  it('normalizes stale session ceilings from the active profile zones', () => {
    expect(normalizeSessionZones(session, zones).hr_ceiling).toBe(140);
  });

  it('warns inside the MAF buffer and gives walk recovery above ceiling', () => {
    const near = evaluateLiveGuardrails({
      samples: samples([[5 * 60_000, 138]]),
      zones,
      elapsedMs: 5 * 60_000,
      includeEta: false,
    });

    expect(near.map((g) => g.kind)).toContain('maf_buffer');
    expect(near.map((g) => g.kind)).toContain('early_too_fast');

    const over = evaluateLiveGuardrails({
      samples: samples([[12 * 60_000, 142]]),
      zones,
      elapsedMs: 12 * 60_000,
      includeEta: false,
    });

    expect(over[0]?.kind).toBe('walk_recovery');
    expect(over[0]?.message).toContain('below 100 bpm');
  });

  it('detects late HR drift against the early steady window', () => {
    const driftSamples = samples([
      [5 * 60_000, 128],
      [6 * 60_000, 129],
      [7 * 60_000, 128],
      [24 * 60_000, 136],
      [25 * 60_000, 138],
    ]);

    const guardrails = evaluateLiveGuardrails({
      samples: driftSamples,
      zones,
      elapsedMs: 25 * 60_000,
      includeEta: false,
    });

    expect(guardrails.map((g) => g.kind)).toContain('drift');
  });

  it('estimates zone ETA only for a meaningful upward HR slope', () => {
    const eta = zoneEtaSec(
      samples([
        [0, 120],
        [60_000, 122],
        [120_000, 124],
        [180_000, 126],
      ]),
      140,
      180_000
    );

    expect(eta).toBe(420);
  });
});

describe('coach engine guardrail zones', () => {
  it('uses profile Z2 ceiling for audio cues instead of the stale session ceiling', () => {
    const engine = createCoachEngine({
      session,
      verbosity: 'voice',
      nasalReminder: false,
      profile,
      screamModeEnabled: false,
    });

    const cues = engine.tick({ bpm: 141, timestamp: 0 }, 60_000);

    expect(cues.some((cue) => cue.kind === 'zone_exceeded')).toBe(true);
  });
});
