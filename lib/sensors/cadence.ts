// SPDX-License-Identifier: GPL-3.0-or-later

import { Pedometer } from 'expo-sensors';
import { useEffect, useState } from 'react';
import { create } from 'zustand';

import { normalizeCadence } from '@/lib/metrics/cadence';

export interface CadenceListener {
  (spm: number | null): void;
}

export interface CadenceSource {
  start(listener: CadenceListener): Promise<void>;
  stop(): Promise<void>;
  isAvailable(): Promise<boolean>;
}

interface StepSample {
  t: number;
  steps: number;
}

interface PedometerSubscription {
  remove: () => void;
}

const ROLLING_WINDOW_MS = 30_000;
const EMIT_INTERVAL_MS = 1_000;
/**
 * If we haven't seen a step event in this long, emit `null` so the UI shows
 * "no cadence" rather than a stale SPM. Generous because some Android OEMs
 * batch step events every 5-10s in low-power mode.
 */
const IDLE_TIMEOUT_MS = 10_000;
/** Need at least this much elapsed time before we trust SPM (avoid spikes from 1-2 steps). */
const MIN_WINDOW_MS = 3_000;
export const MIN_PLAUSIBLE_RUNNING_SPM = 140;
export const MAX_PLAUSIBLE_RUNNING_SPM = 200;

export function isPlausibleRunningCadence(spm: number | null): spm is number {
  return (
    spm !== null &&
    spm >= MIN_PLAUSIBLE_RUNNING_SPM &&
    spm <= MAX_PLAUSIBLE_RUNNING_SPM
  );
}

class PedometerCadenceSource implements CadenceSource {
  private subscription: PedometerSubscription | null = null;
  private emitTimer: ReturnType<typeof setInterval> | null = null;
  private samples: StepSample[] = [];
  private listener: CadenceListener | null = null;
  /**
   * `Pedometer.watchStepCount` semantics differ by platform:
   * - iOS: cumulative since the most recent subscription. First event arrives
   *   only after a step is detected.
   * - Android: cumulative since subscription on most devices, but some OEMs
   *   reset the counter on app resume or report deltas. We treat it as
   *   monotonically non-decreasing within a session and reset our window if
   *   we observe a decrease.
   */
  private latestSteps = 0;
  private latestStepsAt = 0;
  private lastEmitted: number | null = null;
  private hasEmittedOnce = false;
  private availabilityCache: boolean | null = null;
  /** Generation counter so async start() races resolve to the latest call. */
  private startGen = 0;

  async isAvailable(): Promise<boolean> {
    if (this.availabilityCache !== null) {
      return this.availabilityCache;
    }
    try {
      const ok = await Pedometer.isAvailableAsync();
      this.availabilityCache = ok;
      return ok;
    } catch {
      this.availabilityCache = false;
      return false;
    }
  }

  async start(listener: CadenceListener): Promise<void> {
    // If a previous start is still alive, tear it down first.
    if (this.listener !== null || this.subscription !== null) {
      await this.stop();
    }
    const myGen = ++this.startGen;
    this.listener = listener;

    try {
      const permission = await Pedometer.requestPermissionsAsync();
      if (myGen !== this.startGen) return;
      if (!permission.granted) {
        this.emit(null);
        return;
      }
    } catch {
      this.emit(null);
      return;
    }

    const available = await this.isAvailable();
    // If start() was called again while we awaited, abort this branch.
    if (myGen !== this.startGen) return;
    if (!available) {
      // Emit once so the UI doesn't sit on a stale value.
      this.emit(null);
      return;
    }

    this.resetSamples();

    try {
      this.subscription = Pedometer.watchStepCount((result) => {
        // Late events from a previous subscription that the OS hasn't
        // finished tearing down: ignore them so they don't skew SPM.
        if (myGen !== this.startGen) return;
        const now = Date.now();
        const reportedSteps = result.steps;
        // Defensive: some Android OEMs reset the cumulative counter without
        // warning. Treat any decrease as a re-baseline rather than a negative
        // delta (which would emit null forever via the `stepDelta <= 0` path).
        if (reportedSteps < this.latestSteps) {
          this.resetSamples();
        }
        this.latestSteps = reportedSteps;
        this.latestStepsAt = now;
        this.samples.push({ t: now, steps: reportedSteps });
        this.pruneSamples(now);
      });
    } catch {
      // Some devices throw when ACTIVITY_RECOGNITION is missing despite
      // isAvailableAsync returning true. Surface a null so the UI degrades
      // gracefully instead of spinning forever.
      this.subscription = null;
      this.availabilityCache = false;
      this.emit(null);
      return;
    }

    this.emitTimer = setInterval(() => {
      this.tick();
    }, EMIT_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    // Bump the generation so any in-flight async chain bails out.
    this.startGen += 1;
    if (this.emitTimer !== null) {
      clearInterval(this.emitTimer);
      this.emitTimer = null;
    }
    if (this.subscription !== null) {
      try {
        this.subscription.remove();
      } catch {
        // best-effort; some platforms throw if already detached
      }
      this.subscription = null;
    }
    this.resetSamples();
    this.lastEmitted = null;
    this.hasEmittedOnce = false;
    this.listener = null;
  }

  private resetSamples(): void {
    this.samples = [];
    this.latestSteps = 0;
    this.latestStepsAt = 0;
    // Don't seed a synthetic {t: now, steps: 0} sample. The pedometer's first
    // event establishes the baseline; until then we emit null (idle), which
    // is the correct UI state. Seeding caused stale-anchor SPM bugs where a
    // long idle period would compute `(N - 0) / (now - startedAt)` based on
    // a 60s-old timestamp, dramatically underestimating cadence on resume.
  }

  private pruneSamples(now: number): void {
    const cutoff = now - ROLLING_WINDOW_MS;
    let firstKeep = 0;
    while (
      firstKeep + 1 < this.samples.length &&
      (this.samples[firstKeep + 1]?.t ?? now) < cutoff
    ) {
      firstKeep++;
    }
    if (firstKeep > 0) {
      this.samples = this.samples.slice(firstKeep);
    }
  }

  private tick(): void {
    if (this.listener === null) {
      return;
    }
    const now = Date.now();
    this.pruneSamples(now);

    const idle =
      this.latestStepsAt === 0 || now - this.latestStepsAt > IDLE_TIMEOUT_MS;
    if (idle) {
      this.emit(null);
      return;
    }

    const oldest = this.samples[0];
    if (oldest === undefined) {
      this.emit(null);
      return;
    }
    const elapsedMs = now - oldest.t;
    if (elapsedMs < MIN_WINDOW_MS) {
      this.emit(null);
      return;
    }
    const stepDelta = this.latestSteps - oldest.steps;
    if (stepDelta <= 0) {
      this.emit(null);
      return;
    }
    const rawSpm = Math.round((stepDelta / elapsedMs) * 60_000);
    const spm = normalizeCadence(rawSpm);
    if (spm === null) {
      this.emit(null);
      return;
    }
    this.emit(spm);
  }

  private emit(value: number | null): void {
    if (this.listener === null) {
      return;
    }
    // Always emit at least once after start so consumers get a definitive
    // initial value, even if it's null.
    if (this.hasEmittedOnce && value === this.lastEmitted) {
      return;
    }
    this.hasEmittedOnce = true;
    this.lastEmitted = value;
    this.listener(value);
  }
}

export const cadenceSource: CadenceSource = new PedometerCadenceSource();

export function useCadence(active: boolean): number | null {
  const [spm, setSpm] = useState<number | null>(null);

  useEffect(() => {
    if (!active) {
      return;
    }
    let cancelled = false;
    const listener: CadenceListener = (value) => {
      if (!cancelled) {
        setSpm(value);
      }
    };
    cadenceSource.start(listener).catch(() => {
      if (!cancelled) {
        setSpm(null);
      }
    });
    return () => {
      cancelled = true;
      setSpm(null);
      void cadenceSource.stop();
    };
  }, [active]);

  return spm;
}

/**
 * Live, plausibility-filtered cadence for the run screen's small readouts.
 * Kept in its own store so a cadence change repaints only the widgets that
 * show it, not the whole run screen.
 */
export const useLiveCadenceStore = create<{ spm: number | null }>(() => ({ spm: null }));
