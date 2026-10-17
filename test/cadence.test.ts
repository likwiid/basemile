// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { normalizeCadence, personalizedCadenceTarget } from '@/lib/metrics/cadence';
import type { CompletedRun } from '@/types';

describe('normalizeCadence', () => {
  it('doubles plausibly per-leg readings before display validation', () => {
    expect(normalizeCadence(98)).toBe(196);
    expect(normalizeCadence(80)).toBe(160);
  });

  it('accepts genuine running cadences near 120-130 instead of doubling them past the cap', () => {
    // Previously rawSpm < 130 was always doubled, so 125*2=250 was rejected.
    expect(normalizeCadence(121)).toBe(121);
    expect(normalizeCadence(125)).toBe(125);
    expect(normalizeCadence(129)).toBe(129);
  });

  it('drops implausibly low readings even after correction', () => {
    expect(normalizeCadence(40)).toBeNull();
  });
});

describe('personalizedCadenceTarget', () => {
  it('waits for three runs before nudging target by 5%', () => {
    const runs = [run('a', 170), run('b', 172)];
    expect(personalizedCadenceTarget(runs, 170)).toEqual({
      target: 170,
      measuring: true,
      baseline: null,
    });

    expect(personalizedCadenceTarget([...runs, run('c', 174)], 170)).toEqual({
      target: 181,
      measuring: false,
      baseline: 172,
    });
  });

  it('tracks the three most recent runs, not the oldest', () => {
    // started_at = char code, so d/e/f are the newest. Old slow-cadence runs
    // must not anchor the baseline forever.
    const runs = [
      run('a', 160),
      run('b', 162),
      run('c', 164),
      run('d', 176),
      run('e', 178),
      run('f', 180),
    ];
    expect(personalizedCadenceTarget(runs, 170).baseline).toBe(178);
  });
});

function run(id: string, avg_cadence_spm: number): CompletedRun {
  return {
    id,
    started_at: id.charCodeAt(0),
    ended_at: id.charCodeAt(0) + 1,
    session_id: null,
    type: 'long',
    duration_sec: 1800,
    distance_m: 3000,
    avg_hr: 130,
    max_hr: 145,
    avg_pace_sec_per_km: 600,
    maf_pace_sec_per_km: null,
    avg_cadence_spm,
    zone_distribution: {
      z1_sec: 0,
      z2_sec: 1800,
      z3_sec: 0,
      z4_sec: 0,
      z5_sec: 0,
    },
    splits: [],
  };
}
