// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { detectOvertraining } from '@/lib/metrics/overtraining';
import type { BaselineRecord, HrvRecord, TrainingLoadPoint } from '@/types';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

/** 60 daily HRV readings; rmssd for day index 0 (oldest) .. 59 (today). */
function hrv(rmssdFor: (dayFromToday: number) => number): HrvRecord[] {
  const out: HrvRecord[] = [];
  for (let d = 59; d >= 0; d -= 1) {
    out.push({ measured_at: NOW - d * DAY, rmssd_ms: rmssdFor(d), mean_hr: 50, rr_count: 200 });
  }
  return out;
}

/** Stable resting HR so rhr_elevated never fires. */
function rhr(): BaselineRecord[] {
  const out: BaselineRecord[] = [];
  for (let d = 20; d >= 0; d -= 1) {
    out.push({ measured_at: NOW - d * DAY, bpm: 50 } as BaselineRecord);
  }
  return out;
}

function load(atl: number, ctl: number): TrainingLoadPoint[] {
  // 60 daily points so the series clears the 42-day ACWR cold-start gate
  // (a freshly-seeded EWMA reads ACWR > 1.3 for ~2 months by construction).
  const out: TrainingLoadPoint[] = [];
  const start = new Date('2026-04-03T12:00:00Z').getTime();
  for (let i = 0; i < 60; i++) {
    const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    out.push({ date, daily_trimp: 50, ctl, atl, tsb: ctl - atl });
  }
  return out;
}

describe('detectOvertraining — HRV dropping', () => {
  it('does NOT fire on a stationary HRV series', () => {
    const state = detectOvertraining({
      restingBaselines: rhr(),
      hrvHistory: hrv(() => 60),
      loadSeries: load(50, 50),
    });
    expect(state.triggers).not.toContain('hrv_dropping');
  });

  it('fires on a sustained ~25% acute drop below baseline', () => {
    // last 7 days (acute) at 45, older baseline at 60 → 25% geometric drop.
    const state = detectOvertraining({
      restingBaselines: rhr(),
      hrvHistory: hrv((d) => (d <= 6 ? 45 : 60)),
      loadSeries: load(50, 50),
    });
    expect(state.triggers).toContain('hrv_dropping');
  });

  it('does NOT fire on a tiny (<10%) dip within the deadband', () => {
    const state = detectOvertraining({
      restingBaselines: rhr(),
      hrvHistory: hrv((d) => (d <= 6 ? 58 : 60)), // ~3% dip
      loadSeries: load(50, 50),
    });
    expect(state.triggers).not.toContain('hrv_dropping');
  });
});

describe('detectOvertraining — load spike (ACWR)', () => {
  it('fires when acute:chronic ratio exceeds 1.3', () => {
    const state = detectOvertraining({
      restingBaselines: rhr(),
      hrvHistory: hrv(() => 60),
      loadSeries: load(75, 50), // ACWR 1.5
    });
    expect(state.triggers).toContain('load_spike');
  });

  it('does NOT fire at a balanced ratio (~1.0)', () => {
    const state = detectOvertraining({
      restingBaselines: rhr(),
      hrvHistory: hrv(() => 60),
      loadSeries: load(50, 50),
    });
    expect(state.triggers).not.toContain('load_spike');
  });
});
