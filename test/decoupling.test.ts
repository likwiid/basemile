// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { decouplingForRun } from '@/lib/metrics/decoupling';
import type { GpsPointRecord, HRSampleRecord } from '@/types';

const RUN_ID = 'run-test';
const STEP_MS = 30_000; // 30s between points
const STEP_DEG = 0.00036; // ~40m per step at the equator

/** ~50min steady run; first `spikeMin` minutes carry a warm-up HR spike. */
function buildRun(spikeMin: number, spikeBpm: number, steadyBpm: number) {
  const gps: GpsPointRecord[] = [];
  const hr: HRSampleRecord[] = [];
  const count = 100; // 100 * 30s = 49.5 min
  for (let i = 0; i < count; i += 1) {
    const timestamp = i * STEP_MS;
    gps.push({
      run_id: RUN_ID,
      timestamp,
      latitude: 0,
      longitude: i * STEP_DEG,
      altitude: 100,
    } as GpsPointRecord);
    const elapsedMin = timestamp / 60_000;
    hr.push({
      run_id: RUN_ID,
      timestamp,
      bpm: elapsedMin < spikeMin ? spikeBpm : steadyBpm,
    } as HRSampleRecord);
  }
  return { gps, hr };
}

describe('decouplingForRun warm-up trim', () => {
  it('produces a reliable result despite a warm-up HR spike', () => {
    // First 4 min at 185 bpm, then a steady 145 — the spike sits inside the
    // 5-min warm-up window that the trim removes.
    const { gps, hr } = buildRun(4, 185, 145);
    const result = decouplingForRun(hr, gps);

    expect(result.reliable).toBe(true);
    // Both trimmed halves are steady, so decoupling should be small.
    expect(Math.abs(result.decoupling_pct)).toBeLessThan(5);
  });

  it('still analyses an otherwise-steady run', () => {
    const { gps, hr } = buildRun(0, 145, 145);
    const result = decouplingForRun(hr, gps);
    expect(result.reliable).toBe(true);
  });
});
