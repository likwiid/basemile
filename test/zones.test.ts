// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  classifyHR,
  computeMafCeiling,
  computeZonesFromKarvonen,
  mafAdjustmentForCeiling,
  mafWindowFromCeiling,
  zoneBoundaryHint,
  zoneConfigsEqual,
} from '@/lib/zones';

describe('computeMafCeiling', () => {
  it('adds the signed Maffetone adjustment (not subtracts)', () => {
    expect(computeMafCeiling(30, 0)).toBe(150);
    expect(computeMafCeiling(30, 5)).toBe(155); // competitive athlete → higher
    expect(computeMafCeiling(30, -10)).toBe(140); // chronic illness → lower
  });
});

describe('MAF ceiling/adjustment consistency guard', () => {
  it('reproduces a 149 ceiling from age 26 + beginner -5 (additive)', () => {
    expect(computeMafCeiling(26, -5)).toBe(149);
    // The stale +5 ("experienced competitive") would silently drift it to 159.
    expect(computeMafCeiling(26, 5)).toBe(159);
  });

  it('mafAdjustmentForCeiling inverts computeMafCeiling so the pair cannot drift', () => {
    expect(mafAdjustmentForCeiling(26, 149)).toBe(-5);
    const cases: readonly (readonly [number, number])[] = [
      [26, 149],
      [30, 150],
      [40, 135],
      [26, 159],
    ];
    for (const [age, ceiling] of cases) {
      expect(computeMafCeiling(age, mafAdjustmentForCeiling(age, ceiling))).toBe(ceiling);
    }
  });

  it('leaves the MAF window and zone bands unchanged at the reconciled ceiling', () => {
    expect(mafWindowFromCeiling(149)).toEqual([145, 149]);
    expect(computeZonesFromKarvonen(190, 49, computeMafCeiling(26, -5))).toEqual({
      z1: [49, 113],
      z2: [113, 149],
      z3: [149, 162],
      z4: [162, 176],
      z5: [176, 190],
    });
  });
});

describe('zone band guard', () => {
  it('clamps an out-of-band MAF ceiling so ranges never invert', () => {
    const zones = computeZonesFromKarvonen(190, 49, 250); // absurd ceiling above tempo
    expect(zones.z2[0]).toBeLessThan(zones.z2[1]);
    expect(zones.z2[1]).toBeLessThan(zones.z3[1]);
    expect(zones.z3[0]).toBeLessThanOrEqual(zones.z3[1]);
  });
});

describe('Karvonen zones', () => {
  it('matches the sample athlete anchors (max 190, rest 49, ceiling 149)', () => {
    const zones = computeZonesFromKarvonen(190, 49, 149);

    expect(zones).toEqual({
      z1: [49, 113],
      z2: [113, 149],
      z3: [149, 162],
      z4: [162, 176],
      z5: [176, 190],
    });
  });

  it('classifies the sample athlete aerobic HR correctly', () => {
    const zones = computeZonesFromKarvonen(190, 49, 149);

    expect(classifyHR(133, zones)).toBe(2);
    expect(classifyHR(148, zones)).toBe(2);
    // The ceiling itself is the coached target — it books as Z2, not Z3.
    expect(classifyHR(149, zones)).toBe(2);
    expect(classifyHR(150, zones)).toBe(3);
    expect(classifyHR(153, zones)).toBe(3);
  });

  it('warns when close to the next zone boundary', () => {
    const zones = computeZonesFromKarvonen(190, 49, 149);

    expect(zoneBoundaryHint(145, zones)?.label).toBe('Z2 → Z3 soon');
    expect(zoneBoundaryHint(133, zones)).toBeNull();
  });
});

describe('zoneConfigsEqual', () => {
  it('matches configs with identical bounds even when they are different objects', () => {
    const a = computeZonesFromKarvonen(190, 49, 149);
    const b = computeZonesFromKarvonen(190, 49, 149);
    expect(a).not.toBe(b);
    expect(zoneConfigsEqual(a, b)).toBe(true);
  });

  it('detects a change to any single bound', () => {
    const base = computeZonesFromKarvonen(190, 49, 149);
    expect(zoneConfigsEqual(base, { ...base, z3: [base.z3[0], base.z3[1] + 1] })).toBe(false);
    expect(zoneConfigsEqual(base, { ...base, z1: [base.z1[0] - 1, base.z1[1]] })).toBe(false);
  });
});
