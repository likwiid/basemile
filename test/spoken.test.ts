// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { spokenDuration, spokenKm, spokenPace } from '@/lib/coach/spoken';

describe('spoken formatters', () => {
  it('formats durations for speech', () => {
    expect(spokenDuration(0)).toBe('0 seconds');
    expect(spokenDuration(60_000)).toBe('1 minute');
    expect(spokenDuration(90_000)).toBe('1 minute 30 seconds');
  });

  it('formats pace and distance for speech', () => {
    expect(spokenPace(330)).toBe('5 minutes 30 per kilometer');
    expect(spokenKm(2340)).toBe('2.3 kilometers');
    expect(spokenKm(40)).toBe('less than a hundred meters');
  });
});
