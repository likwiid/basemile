// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * DST regression for the CTL/ATL day-walk. A fixed +24h stride emitted the
 * fall-back local date twice (double-applying that day's TRIMP) and then
 * trailed local midnight so the series stopped one day short of "today" after
 * spring-forward. Only meaningful in a DST-observing zone — each test skips
 * when the running zone doesn't shift on the probed dates (run with
 * TZ=Asia/Beirut or any DST zone to exercise them).
 */
import { describe, expect, it } from 'vitest';

import { loadSeries } from '@/lib/metrics/load';
import type { CompletedRun, UserProfile } from '@/types';

const profile = { sex: 'male', hrMax: 190, hrRest: 49 } as UserProfile;

function run(id: string, startedAt: number): CompletedRun {
  return {
    id,
    started_at: startedAt,
    ended_at: startedAt + 3600_000,
    session_id: null,
    type: 'long',
    duration_sec: 3600,
    distance_m: 10000,
    avg_hr: 140,
    max_hr: 150,
    avg_pace_sec_per_km: 360,
    maf_pace_sec_per_km: null,
    zone_distribution: { z1_sec: 0, z2_sec: 3600, z3_sec: 0, z4_sec: 0, z5_sec: 0 },
    splits: [],
  } as CompletedRun;
}

/** True when the local zone's UTC offset changes between the two instants. */
function zoneShifts(aIso: string, bIso: string): boolean {
  return new Date(aIso).getTimezoneOffset() !== new Date(bIso).getTimezoneOffset();
}

describe('loadSeries across DST transitions', () => {
  it('never emits a local date twice (fall-back day)', () => {
    if (!zoneShifts('2026-10-20T00:00:00Z', '2026-11-05T00:00:00Z')) return; // zone w/o DST
    const runs = [
      run('a', new Date('2026-10-20T12:00:00+03:00').getTime()),
      run('b', new Date('2026-11-02T12:00:00+02:00').getTime()),
    ];
    const dates = loadSeries(runs, profile, new Date('2026-11-05T12:00:00+02:00')).map(
      (p) => p.date
    );
    expect(new Set(dates).size).toBe(dates.length);
  });

  it('still reaches today after a spring-forward transition', () => {
    if (!zoneShifts('2026-03-20T00:00:00Z', '2026-04-05T00:00:00Z')) return;
    const runs = [run('a', new Date('2026-03-20T12:00:00+02:00').getTime())];
    const series = loadSeries(runs, profile, new Date('2026-04-05T12:00:00+03:00'));
    expect(series[series.length - 1]?.date).toBe('2026-04-05');
  });

  it('walks consecutive dates with no gaps across both transitions', () => {
    if (!zoneShifts('2026-03-20T00:00:00Z', '2026-04-05T00:00:00Z')) return;
    const runs = [run('a', new Date('2026-03-20T12:00:00+02:00').getTime())];
    const dates = loadSeries(runs, profile, new Date('2026-04-05T12:00:00+03:00')).map(
      (p) => p.date
    );
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1] + 'T12:00:00Z').getTime();
      const curr = new Date(dates[i] + 'T12:00:00Z').getTime();
      expect(Math.round((curr - prev) / 86_400_000)).toBe(1);
    }
  });
});
