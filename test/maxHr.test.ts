// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  observedPeakHr,
  profilePatchForAge,
  resolveEffectiveMaxHr,
  tanakaMaxHr,
} from '@/lib/metrics/maxHr';
import type { CompletedRun } from '@/types';

describe('tanakaMaxHr', () => {
  it('is 208 - 0.7*age rounded (190 at age 26)', () => {
    expect(tanakaMaxHr(26)).toBe(190);
    expect(tanakaMaxHr(30)).toBe(187);
  });
});

describe('observedPeakHr', () => {
  it('returns the highest run max_hr', () => {
    const runs = [{ max_hr: 148 }, { max_hr: 157 }, { max_hr: 150 }] as CompletedRun[];
    expect(observedPeakHr(runs)).toBe(157);
  });

  it('returns null when there are no runs', () => {
    expect(observedPeakHr([])).toBeNull();
  });
});

describe('resolveEffectiveMaxHr', () => {
  const base = { age: 26, measured: 178, manual: 165 };

  it('resolves each source to its value', () => {
    expect(resolveEffectiveMaxHr({ source: 'estimate', ...base })).toBe(190);
    expect(resolveEffectiveMaxHr({ source: 'measured', ...base })).toBe(178);
    expect(resolveEffectiveMaxHr({ source: 'manual', ...base })).toBe(165);
  });

  it('falls back to the Tanaka estimate when the chosen source has no value', () => {
    expect(
      resolveEffectiveMaxHr({ source: 'measured', age: 26, measured: null, manual: null })
    ).toBe(190);
    expect(
      resolveEffectiveMaxHr({ source: 'manual', age: 26, measured: 178, manual: null })
    ).toBe(190);
  });
});

describe('profilePatchForAge', () => {
  it('moves max HR with age while the estimate is the source', () => {
    expect(profilePatchForAge(50, 'estimate')).toEqual({ age: 50, hrMax: 173 });
  });

  it('keeps a measured or manual max HR when age changes', () => {
    expect(profilePatchForAge(50, 'measured')).toEqual({ age: 50 });
    expect(profilePatchForAge(50, 'manual')).toEqual({ age: 50 });
  });
});
