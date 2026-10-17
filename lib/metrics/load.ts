// SPDX-License-Identifier: GPL-3.0-or-later

import type { CompletedRun, TrainingLoadPoint, UserProfile } from '@/types';

/**
 * Banister TRIMP / CTL / ATL / TSB.
 *
 * Reference: Banister, E.W. (1991). Modeling elite athletic performance.
 * The exponent and weighting differ by sex because the HR/lactate
 * response curves are not symmetrical between men and women.
 */

const CTL_DAYS = 42;
const ATL_DAYS = 7;
const CTL_DECAY = 1 - Math.exp(-1 / CTL_DAYS);
const ATL_DECAY = 1 - Math.exp(-1 / ATL_DAYS);

interface BanisterCoefficients {
  /** Linear weight on HR reserve ratio. */
  k: number;
  /** Exponential weight on HR reserve ratio. */
  b: number;
}

function coefficientsFor(sex: UserProfile['sex']): BanisterCoefficients {
  return sex === 'female' ? { k: 0.86, b: 1.67 } : { k: 0.64, b: 1.92 };
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/** YYYY-MM-DD in the device's local timezone — load is a calendar concept. */
function localISODate(timestampMs: number): string {
  const d = new Date(timestampMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfLocalDay(timestampMs: number): number {
  const d = new Date(timestampMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Next local midnight. Calendar-aware (setDate) rather than +24h so DST
 * transitions can't skip or duplicate a local date: a fixed 24h stride lands at
 * 23:00/01:00 after a transition, emitting the fall-back day twice (its TRIMP
 * double-applied) and then trailing local midnight forever — which made the
 * series stop one day short of "today" until the opposite transition.
 */
function nextLocalDay(dayStartMs: number): number {
  const d = new Date(dayStartMs);
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function trimpForRun(run: CompletedRun, profile: UserProfile): number {
  if (run.avg_hr <= 0) return 0;
  if (run.duration_sec <= 0) return 0;
  const hrReserve = profile.hrMax - profile.hrRest;
  if (hrReserve <= 0) return 0;

  const ratio = clamp01((run.avg_hr - profile.hrRest) / hrReserve);
  const { k, b } = coefficientsFor(profile.sex);
  const durationMin = run.duration_sec / 60;
  return durationMin * ratio * k * Math.exp(b * ratio);
}

export function dailyTrimp(
  runs: CompletedRun[],
  profile: UserProfile
): Map<string, number> {
  const out = new Map<string, number>();
  for (const run of runs) {
    const trimp = trimpForRun(run, profile);
    if (trimp <= 0) continue;
    const key = localISODate(run.started_at);
    out.set(key, (out.get(key) ?? 0) + trimp);
  }
  return out;
}

export function loadSeries(
  runs: CompletedRun[],
  profile: UserProfile,
  today: Date = new Date()
): TrainingLoadPoint[] {
  if (runs.length === 0) return [];

  const daily = dailyTrimp(runs, profile);

  let earliestMs = Infinity;
  for (const run of runs) {
    const dayStart = startOfLocalDay(run.started_at);
    if (dayStart < earliestMs) earliestMs = dayStart;
  }
  if (!Number.isFinite(earliestMs)) return [];

  const todayStart = startOfLocalDay(today.getTime());
  if (todayStart < earliestMs) return [];

  const out: TrainingLoadPoint[] = [];
  let ctl = 0;
  let atl = 0;
  for (let cursor = earliestMs; cursor <= todayStart; cursor = nextLocalDay(cursor)) {
    const key = localISODate(cursor);
    const t = daily.get(key) ?? 0;
    ctl = ctl + (t - ctl) * CTL_DECAY;
    atl = atl + (t - atl) * ATL_DECAY;
    out.push({
      date: key,
      daily_trimp: t,
      ctl,
      atl,
      tsb: ctl - atl,
    });
  }
  return out;
}

export type FreshnessLabel = 'fresh' | 'neutral' | 'fatigued' | 'overcooked';
export type FreshnessTone = 'good' | 'warn' | 'bad';

export function formatTsbLabel(
  tsb: number
): { label: FreshnessLabel; tone: FreshnessTone } {
  if (tsb >= 5) return { label: 'fresh', tone: 'good' };
  if (tsb >= -5) return { label: 'neutral', tone: 'good' };
  if (tsb >= -15) return { label: 'fatigued', tone: 'warn' };
  return { label: 'overcooked', tone: 'bad' };
}
