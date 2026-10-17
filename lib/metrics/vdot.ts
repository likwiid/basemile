// SPDX-License-Identifier: GPL-3.0-or-later

import { todayISO } from '@/lib/time';
import type { CompletedRun, RaceProjection, VdotResult } from '@/types';

const RACE_DISTANCES_M: readonly number[] = [5000, 10000, 21097.5, 42195];

/**
 * Daniels' VDOT formula. Given a race distance and finish time,
 * estimate VO2max. The formula combines the velocity→VO2 cost curve
 * with a duration-dependent %VO2max-sustainable curve, then divides.
 */
export function vdotFromPace(distance_m: number, time_sec: number): number {
  if (distance_m <= 0 || time_sec <= 0) return 0;
  const minutes = time_sec / 60;
  const velocity_m_per_min = distance_m / minutes;
  const vo2 =
    -4.6 +
    0.182258 * velocity_m_per_min +
    0.000104 * velocity_m_per_min * velocity_m_per_min;
  const pct_max =
    0.8 +
    0.1894393 * Math.exp(-0.012778 * minutes) +
    0.2989558 * Math.exp(-0.1932605 * minutes);
  if (pct_max <= 0) return 0;
  return vo2 / pct_max;
}

/**
 * A conservative AEROBIC fitness marker derived from steady-state MAF pace.
 *
 * NOTE: this is NOT true VO2max/VDOT. MAF pace is a sub-maximal aerobic effort,
 * but it is fed through the Daniels curve as if it were a maximal 60-min race,
 * so the result systematically UNDER-reports race VDOT. Useful only as a
 * self-relative aerobic-progress marker (rising = fitter); race projections off
 * it are conservative. Surfaced in the UI as an "aerobic score", not VO2max.
 */
export function vdotFromMafPace(maf_pace_sec_per_km: number): number {
  if (!Number.isFinite(maf_pace_sec_per_km) || maf_pace_sec_per_km <= 0) {
    return 0;
  }
  const time_sec = 3600;
  const distance_in_60min_m = (time_sec / maf_pace_sec_per_km) * 1000;
  return vdotFromPace(distance_in_60min_m, time_sec);
}

/** Binary-search the finish time that produces the target VDOT for a given distance. */
function predictTimeForDistance(distance_m: number, target_vdot: number): number {
  let lo = 60;
  let hi = 12 * 3600;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const v = vdotFromPace(distance_m, mid);
    // VDOT decreases as time grows (slower runner ⇒ lower VDOT).
    if (v > target_vdot) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

export function racePredictions(vdot: number): RaceProjection[] {
  if (!Number.isFinite(vdot) || vdot <= 0) return [];
  return RACE_DISTANCES_M.map((distance_m) => {
    const predicted_sec = predictTimeForDistance(distance_m, vdot);
    const km = distance_m / 1000;
    return {
      distance_m,
      predicted_sec,
      predicted_pace_sec_per_km: predicted_sec / km,
    };
  });
}

export function latestVdotFromRuns(runs: CompletedRun[]): VdotResult | null {
  let latest: CompletedRun | null = null;
  for (const run of runs) {
    if ((run.maf_gap_pace_sec_per_km ?? run.maf_pace_sec_per_km) === null) continue;
    if (!latest || run.started_at > latest.started_at) {
      latest = run;
    }
  }
  if (!latest) return null;
  const pace = latest.maf_gap_pace_sec_per_km ?? latest.maf_pace_sec_per_km;
  if (pace === null) return null;
  const vdot = vdotFromMafPace(pace);
  return {
    vdot,
    source_pace_sec_per_km: pace,
    source_date: todayISO(new Date(latest.started_at)), // local day, matches run rows
  };
}
