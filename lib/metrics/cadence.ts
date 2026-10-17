// SPDX-License-Identifier: GPL-3.0-or-later

import type { CompletedRun } from '@/types';

const MAX_SENSOR_SPM = 240;

export function normalizeCadence(rawSpm: number): number | null {
  if (!Number.isFinite(rawSpm) || rawSpm <= 0) return null;
  // A per-leg sensor reports ~half the true SPM. Only double values that are
  // plausibly per-leg (~45-100); a genuine two-leg cadence near 120-130 is kept
  // as-is instead of doubled past the cap (e.g. 125*2=250 was being rejected).
  const corrected = rawSpm >= 45 && rawSpm <= 100 ? rawSpm * 2 : rawSpm;
  // Accept the running-cadence band. Floor is 120 (not 130) so genuine low
  // cadences in ~[120,130) pass instead of being dropped.
  if (corrected < 120 || corrected > MAX_SENSOR_SPM) return null;
  return Math.round(corrected);
}

export function personalizedCadenceTarget(
  runs: readonly CompletedRun[],
  fallbackTarget: number
): { target: number; measuring: boolean; baseline: number | null } {
  const cadenceRuns = [...runs]
    .filter((run) => run.avg_cadence_spm !== null && run.avg_cadence_spm !== undefined)
    .sort((a, b) => b.started_at - a.started_at) // most recent first
    .slice(0, 3); // baseline tracks current form, not the first runs ever logged
  if (cadenceRuns.length < 3) {
    return { target: fallbackTarget, measuring: true, baseline: null };
  }
  const baseline =
    cadenceRuns.reduce((sum, run) => sum + (run.avg_cadence_spm ?? 0), 0) /
    cadenceRuns.length;
  return {
    target: Math.round(baseline * 1.05),
    measuring: false,
    baseline: Math.round(baseline),
  };
}
