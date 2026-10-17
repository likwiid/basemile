// SPDX-License-Identifier: GPL-3.0-or-later

import type { BleDevice, HRSample, MockHRConfig } from '@/types';

import { useBleStore } from './store';

const MOCK_DEVICE: BleDevice = {
  id: 'mock-hrm',
  name: 'Mock HRM',
  rssi: -42,
  isPaired: true,
};

interface IntervalsBlock {
  workSec: number;
  recoverSec: number;
  cycles: number;
  workStart: number;
  workEnd: number;
  recoverTarget: number;
}

const FOUR_BY_FOUR: IntervalsBlock = {
  workSec: 4 * 60,
  recoverSec: 3 * 60,
  cycles: 4,
  workStart: 130,
  workEnd: 175,
  recoverTarget: 125,
};

export class MockHRSource {
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private config: MockHRConfig | null = null;
  private onSample: ((s: HRSample) => void) | null = null;
  private lastBpm = 0;

  start(config: MockHRConfig, onSample: (s: HRSample) => void): void {
    this.stop();
    this.config = config;
    this.onSample = onSample;
    this.startedAt = Date.now();
    this.lastBpm = config.baselineBpm;

    const store = useBleStore.getState();
    store.setDevice(MOCK_DEVICE);
    store.setState('connected');
    store.setBattery(88);
    store.setError(null);

    // Clamp interval to a sane range: too low burns battery, too high stalls UI.
    const interval = Math.min(60_000, Math.max(100, config.intervalMs));
    this.timer = setInterval(() => this.tick(), interval);
    this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.onSample = null;
    this.config = null;
  }

  /**
   * Detach + put store into a clean idle state (used when toggling mock off).
   * Only mutates store if the mock device is still the one in play, so this
   * is safe to call after a real BLE connection has already landed.
   */
  detach(): void {
    this.stop();
    const store = useBleStore.getState();
    if (store.device?.id === MOCK_DEVICE.id) {
      store.setDevice(null);
      store.setBattery(null);
      store.pushSample(null);
      store.setState('idle');
    }
  }

  private tick(): void {
    if (!this.config || !this.onSample) return;
    const now = Date.now();
    const elapsedSec = (now - this.startedAt) / 1000;
    const raw = this.computeBpm(elapsedSec);
    // Guard against NaN/Infinity from any future pattern math.
    const bpm = Number.isFinite(raw) ? raw : this.config.baselineBpm;
    this.lastBpm = bpm;

    const sample: HRSample = { bpm: Math.round(bpm), timestamp: now };
    this.onSample(sample);
    useBleStore.getState().pushSample(sample);
  }

  private computeBpm(elapsedSec: number): number {
    const cfg = this.config;
    if (!cfg) return this.lastBpm;
    switch (cfg.pattern) {
      case 'steady_z2':
        return steadyZ2(elapsedSec);
      case 'drift_up':
        return driftUp(elapsedSec);
      case 'intervals_4x4':
        return intervals4x4(elapsedSec);
      case 'random_walk':
        return randomWalk(this.lastBpm, cfg.baselineBpm);
    }
  }
}

function steadyZ2(t: number): number {
  // 122..134 oscillation with low-frequency wobble + small noise
  const center = 128;
  const wave = Math.sin(t / 12) * 6;
  const noise = (Math.random() - 0.5) * 2;
  return clamp(center + wave + noise, 118, 138);
}

function driftUp(t: number): number {
  // 125 -> 155 over 15 minutes (900s)
  const span = 900;
  const ratio = Math.min(1, t / span);
  const base = 125 + ratio * 30;
  const noise = (Math.random() - 0.5) * 1.5;
  return clamp(base + noise, 120, 160);
}

function intervals4x4(t: number): number {
  const cycle = FOUR_BY_FOUR.workSec + FOUR_BY_FOUR.recoverSec;
  const totalCycles = FOUR_BY_FOUR.cycles;
  const totalSec = cycle * totalCycles;

  if (t >= totalSec) {
    return FOUR_BY_FOUR.recoverTarget + (Math.random() - 0.5) * 2;
  }

  const cycleT = t % cycle;
  if (cycleT < FOUR_BY_FOUR.workSec) {
    const ratio = cycleT / FOUR_BY_FOUR.workSec;
    const base =
      FOUR_BY_FOUR.workStart + ratio * (FOUR_BY_FOUR.workEnd - FOUR_BY_FOUR.workStart);
    return clamp(base + (Math.random() - 0.5) * 2, FOUR_BY_FOUR.workStart - 5, FOUR_BY_FOUR.workEnd + 3);
  }

  const recoverT = cycleT - FOUR_BY_FOUR.workSec;
  const ratio = recoverT / FOUR_BY_FOUR.recoverSec;
  const base = FOUR_BY_FOUR.workEnd - ratio * (FOUR_BY_FOUR.workEnd - FOUR_BY_FOUR.recoverTarget);
  return clamp(base + (Math.random() - 0.5) * 2, FOUR_BY_FOUR.recoverTarget - 3, FOUR_BY_FOUR.workEnd + 1);
}

function randomWalk(prev: number, baseline: number): number {
  // Box-Muller-ish drift toward baseline so it doesn't run away.
  const drift = (baseline - prev) * 0.05;
  const step = (Math.random() - 0.5) * 4;
  return clamp(prev + drift + step, baseline - 25, baseline + 25);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export const mockHRSource = new MockHRSource();
