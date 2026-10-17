// SPDX-License-Identifier: GPL-3.0-or-later

import type { CompletedRun, MaxHrSource } from '@/types';

/**
 * Max-HR resolution. The profile's stored hrMax has historically been the
 * Tanaka age-prediction (~190 at 26), which can disagree with a measured max-HR
 * baseline and the highest HR actually observed in runs. These helpers surface
 * those candidates and resolve the one the athlete chose to drive zones + TRIMP.
 */

/** Tanaka age-predicted max HR: 208 − 0.7·age. */
export function tanakaMaxHr(age: number): number {
  return Math.round(208 - 0.7 * age);
}

/** Highest max_hr seen across stored runs, or null when there are none. */
export function observedPeakHr(runs: readonly CompletedRun[]): number | null {
  let peak: number | null = null;
  for (const run of runs) {
    if (Number.isFinite(run.max_hr) && (peak === null || run.max_hr > peak)) {
      peak = run.max_hr;
    }
  }
  return peak;
}

/**
 * The effective max HR that should drive Karvonen zones + TRIMP for the chosen
 * source. Falls back to the Tanaka estimate when the selected source has no
 * value yet (no measured baseline / no manual entry).
 */
export function resolveEffectiveMaxHr(params: {
  source: MaxHrSource;
  age: number;
  measured: number | null;
  manual: number | null;
}): number {
  const estimate = tanakaMaxHr(params.age);
  switch (params.source) {
    case 'measured':
      return params.measured ?? estimate;
    case 'manual':
      return params.manual ?? estimate;
    case 'estimate':
    default:
      return estimate;
  }
}

/**
 * Profile patch for an age edit. While the age estimate drives zones, the max
 * HR follows the new age so the value shown as selected is the one in use.
 * Measured and manual sources keep their max HR.
 */
export function profilePatchForAge(
  age: number,
  source: MaxHrSource,
): { age: number; hrMax?: number } {
  return source === 'estimate' ? { age, hrMax: tanakaMaxHr(age) } : { age };
}
