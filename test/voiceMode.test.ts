// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  classifyBand,
  computeTargetBand,
  directiveWord,
  evaluateBandDirective,
  zoneRange,
} from '@/lib/coach/voiceMode';
import type { ZoneConfig } from '@/types';

const ZONES: ZoneConfig = {
  z1: [100, 119],
  z2: [120, 149],
  z3: [150, 164],
  z4: [165, 174],
  z5: [175, 190],
};

describe('zoneRange', () => {
  it('returns the tuple for each zone', () => {
    expect(zoneRange(ZONES, 1)).toEqual([100, 119]);
    expect(zoneRange(ZONES, 2)).toEqual([120, 149]);
    expect(zoneRange(ZONES, 5)).toEqual([175, 190]);
  });
});

describe('computeTargetBand', () => {
  it('builds the high end of Z2 (ceiling = MAF cap)', () => {
    expect(computeTargetBand(ZONES, 2, 6)).toEqual({ zone: 2, floor: 143, ceiling: 149 });
  });

  it('clamps the floor to the zone lower bound when width is too wide', () => {
    expect(computeTargetBand(ZONES, 2, 100)).toEqual({ zone: 2, floor: 120, ceiling: 149 });
  });

  it('keeps at least a 1bpm band', () => {
    const band = computeTargetBand(ZONES, 2, 0);
    expect(band.ceiling - band.floor).toBeGreaterThanOrEqual(1);
  });
});

describe('classifyBand', () => {
  const band = computeTargetBand(ZONES, 2, 6); // 143–149

  it('flags missing signal', () => {
    expect(classifyBand(null, band)).toBe('no_signal');
    expect(classifyBand(Number.NaN, band)).toBe('no_signal');
  });

  it('is strict on the floor — one bpm under is below', () => {
    expect(classifyBand(142, band)).toBe('below');
    expect(classifyBand(143, band)).toBe('in');
  });

  it('is strict on the ceiling — one bpm over is above', () => {
    expect(classifyBand(149, band)).toBe('in');
    expect(classifyBand(150, band)).toBe('above');
  });
});

describe('evaluateBandDirective', () => {
  const band = computeTargetBand(ZONES, 2, 6); // 143–149

  it('tells you to speed up below the floor and names the target', () => {
    const d = evaluateBandDirective(140, band);
    expect(d.state).toBe('below');
    expect(d.tone).toBe('rising');
    expect(d.text).toContain('143 to 149');
  });

  it('eases you down just over the ceiling', () => {
    const d = evaluateBandDirective(151, band);
    expect(d.state).toBe('above');
    expect(d.tone).toBe('falling');
  });

  it('escalates to urgent well over the ceiling', () => {
    const d = evaluateBandDirective(155, band);
    expect(d.state).toBe('above');
    expect(d.tone).toBe('urgent');
    expect(d.text.toLowerCase()).toContain('slow down');
  });

  it('holds when on target', () => {
    const d = evaluateBandDirective(146, band);
    expect(d.state).toBe('in');
    expect(d.tone).toBe('steady');
  });

  it('reports a missing signal', () => {
    expect(evaluateBandDirective(null, band).state).toBe('no_signal');
  });
});

describe('directiveWord', () => {
  it('maps states to overlay words', () => {
    expect(directiveWord('below')).toBe('GO FASTER');
    expect(directiveWord('above')).toBe('EASE DOWN');
    expect(directiveWord('in')).toBe('HOLD');
    expect(directiveWord('no_signal')).toBe('NO HR');
  });
});
