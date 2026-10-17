// SPDX-License-Identifier: GPL-3.0-or-later

import type { CompletedRun, RunSurface } from '@/types';

export type RiskSeverity = 'info' | 'warning' | 'danger';

export interface InjuryRiskWarning {
  id: string;
  severity: RiskSeverity;
  title: string;
  detail: string;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MILEAGE_JUMP_RATIO = 0.25;
const HARD_SURFACES: readonly RunSurface[] = ['road', 'track', 'treadmill'];

/**
 * The oldest run injuryRiskWarnings can look at: runs that started before
 * `now - INJURY_RISK_LOOKBACK_MS` never affect the result, so a caller may
 * pass only the runs since then (the widest window, niggles, is 30 days).
 */
export const INJURY_RISK_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

export function weeklyDistanceKm(
  runs: CompletedRun[],
  now = Date.now()
): { currentKm: number; previousKm: number } {
  let currentKm = 0;
  let previousKm = 0;
  const currentStart = now - WEEK_MS;
  const previousStart = now - 2 * WEEK_MS;

  for (const run of runs) {
    if (run.started_at >= currentStart && run.started_at <= now) {
      currentKm += run.distance_m / 1000;
    } else if (run.started_at >= previousStart && run.started_at < currentStart) {
      previousKm += run.distance_m / 1000;
    }
  }

  return { currentKm, previousKm };
}

export function injuryRiskWarnings({
  runs,
  now = Date.now(),
}: {
  runs: CompletedRun[];
  now?: number;
}): InjuryRiskWarning[] {
  const warnings: InjuryRiskWarning[] = [];
  const { currentKm, previousKm } = weeklyDistanceKm(runs, now);

  if (
    previousKm >= 5 &&
    currentKm > previousKm * (1 + MILEAGE_JUMP_RATIO)
  ) {
    warnings.push({
      id: 'mileage-jump',
      severity: 'warning',
      title: 'Mileage jump',
      detail: `This week is ${currentKm.toFixed(1)} km vs ${previousKm.toFixed(
        1
      )} km last week. Keep the next run easy or trim volume.`,
    });
  }


  const recentNiggles = runs
    .filter((run) => run.started_at >= now - INJURY_RISK_LOOKBACK_MS)
    .map((run) => normalizeNiggle(run.context?.niggle))
    .filter((niggle): niggle is string => niggle !== null);
  const repeatedNiggle = firstRepeated(recentNiggles);
  if (repeatedNiggle) {
    warnings.push({
      id: 'repeated-niggle',
      severity: 'warning',
      title: 'Repeated niggle',
      detail: `"${repeatedNiggle}" has shown up more than once recently. Avoid speedwork until it settles.`,
    });
  }

  const recentHardSurfaceRuns = runs.filter(
    (run) =>
      run.started_at >= now - WEEK_MS &&
      run.context?.surface !== undefined &&
      HARD_SURFACES.includes(run.context.surface)
  );
  if (recentHardSurfaceRuns.length >= 3) {
    warnings.push({
      id: 'hard-surface-streak',
      severity: 'info',
      title: 'Hard-surface streak',
      detail: 'Most recent mileage is on firm surfaces. Mix in grass or trail if your legs feel beat up.',
    });
  }

  return warnings;
}

function normalizeNiggle(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized.length >= 3 ? normalized : null;
}

function firstRepeated(values: string[]): string | null {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return null;
}
