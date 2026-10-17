// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaselineRecord, HrvRecord, TrainingLoadPoint } from '@/types';

const DAY_MS = 24 * 60 * 60 * 1000;
const RHR_ELEVATED_BPM = 5;
const RHR_PRIOR_DAYS = 14;
const RHR_MIN_PRIOR_READINGS = 5;
const HRV_MIN_READINGS = 14;
// HRV "dropping" = the recent acute window sits meaningfully below a baseline
// from a SEPARATE older window (not its own superset), using ln(rMSSD) and a
// magnitude deadband so normal day-to-day variation (CV 10-30%) doesn't trip it.
const HRV_ACUTE_DAYS = 7;
const HRV_BASELINE_DAYS = 60; // lookback horizon; baseline = [t-60d, t-7d), i.e. 53 days
const HRV_MIN_ACUTE = 3;
const HRV_MIN_BASELINE = 7;
const HRV_BREACH_FRACTION = 0.1; // acute must be >=10% below baseline (geometric)
// Acute:chronic workload ratio above this = ramping load too fast (canonical
// injury sweet spot 0.8-1.3, high risk >1.5).
const ACWR_SPIKE = 1.3;
// One CTL time-constant of daily points before ACWR is trustworthy.
const ACWR_MIN_HISTORY_DAYS = 42;
const MIN_TOTAL_DAYS = 30;

export type OvertrainingTrigger = 'rhr_elevated' | 'hrv_dropping' | 'load_spike';

export interface OvertrainingState {
  triggers: OvertrainingTrigger[];
  shouldBackOff: boolean;
  message: string;
}

interface DetectArgs {
  restingBaselines: BaselineRecord[];
  hrvHistory: HrvRecord[];
  loadSeries: TrainingLoadPoint[];
}

const TRIGGER_LABEL: Record<OvertrainingTrigger, string> = {
  rhr_elevated: 'resting HR elevated',
  hrv_dropping: 'HRV dropping',
  load_spike: 'training load spike',
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const lo = sorted[mid - 1];
    const hi = sorted[mid];
    if (lo === undefined || hi === undefined) return 0;
    return (lo + hi) / 2;
  }
  return sorted[mid] ?? 0;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function detectRhrElevated(baselines: BaselineRecord[]): boolean {
  if (baselines.length < RHR_MIN_PRIOR_READINGS + 1) return false;
  const sorted = [...baselines].sort((a, b) => a.measured_at - b.measured_at);
  const latest = sorted[sorted.length - 1];
  if (!latest) return false;
  const cutoff = latest.measured_at - RHR_PRIOR_DAYS * DAY_MS;
  const prior = sorted
    .slice(0, -1)
    .filter((b) => b.measured_at >= cutoff)
    .map((b) => b.bpm);
  if (prior.length < RHR_MIN_PRIOR_READINGS) return false;
  const baseline = median(prior);
  return latest.bpm - baseline > RHR_ELEVATED_BPM;
}

function detectHrvDropping(history: HrvRecord[]): boolean {
  if (history.length < HRV_MIN_READINGS) return false;
  const sorted = [...history].sort((a, b) => a.measured_at - b.measured_at);
  const latest = sorted[sorted.length - 1];
  if (!latest) return false;

  const acuteCutoff = latest.measured_at - HRV_ACUTE_DAYS * DAY_MS;
  const baselineStart = latest.measured_at - HRV_BASELINE_DAYS * DAY_MS;
  const acute: number[] = [];
  const baseline: number[] = [];
  for (const r of sorted) {
    if (r.rmssd_ms <= 0 || !Number.isFinite(r.rmssd_ms)) continue;
    const ln = Math.log(r.rmssd_ms); // canonical: ln(rMSSD)
    if (r.measured_at >= acuteCutoff) acute.push(ln);
    else if (r.measured_at >= baselineStart) baseline.push(ln);
  }
  if (acute.length < HRV_MIN_ACUTE || baseline.length < HRV_MIN_BASELINE) return false;

  // ln difference of ln(1 - fraction) = a `fraction` geometric drop in rMSSD.
  return mean(acute) < mean(baseline) + Math.log(1 - HRV_BREACH_FRACTION);
}

function detectLoadSpike(load: TrainingLoadPoint[]): boolean {
  // ACWR needs a settled chronic EWMA: from a zero seed, perfectly steady
  // training reads 4.1 at day 7, 1.9 at day 30 and only drops under the 1.3
  // trigger around day 62 — a false "load spike" for most of the protocol.
  // Require a chronic history at least as long as the CTL time-constant.
  if (load.length < ACWR_MIN_HISTORY_DAYS) return false;
  const latest = load[load.length - 1];
  if (!latest || latest.ctl <= 0) return false;
  // Acute:chronic workload ratio (ATL is the 7-day EWMA, CTL the 42-day) — a
  // true load spike, not a re-test of the freshness/TSB signal.
  return latest.atl / latest.ctl > ACWR_SPIKE;
}

function earliestSignalMs(args: DetectArgs): number | null {
  let earliest = Infinity;
  for (const b of args.restingBaselines) {
    if (b.measured_at < earliest) earliest = b.measured_at;
  }
  for (const h of args.hrvHistory) {
    if (h.measured_at < earliest) earliest = h.measured_at;
  }
  return Number.isFinite(earliest) ? earliest : null;
}

function describe(triggers: OvertrainingTrigger[]): string {
  const [first, second] = triggers;
  if (first === undefined) return 'Recovery looks fine.';
  if (second === undefined) {
    return `Watch closely: ${TRIGGER_LABEL[first]}.`;
  }
  return 'Cut cardio for 2-3 days. Active recovery only.';
}

export function detectOvertraining(args: DetectArgs): OvertrainingState {
  const earliest = earliestSignalMs(args);
  if (earliest === null || Date.now() - earliest < MIN_TOTAL_DAYS * DAY_MS) {
    return {
      triggers: [],
      shouldBackOff: false,
      message: 'Not enough data yet.',
    };
  }

  const triggers: OvertrainingTrigger[] = [];
  if (detectRhrElevated(args.restingBaselines)) triggers.push('rhr_elevated');
  if (detectHrvDropping(args.hrvHistory)) triggers.push('hrv_dropping');
  if (detectLoadSpike(args.loadSeries)) triggers.push('load_spike');

  const shouldBackOff = triggers.length >= 2;
  return {
    triggers,
    shouldBackOff,
    message: describe(triggers),
  };
}

export function triggerLabel(trigger: OvertrainingTrigger): string {
  return TRIGGER_LABEL[trigger];
}
