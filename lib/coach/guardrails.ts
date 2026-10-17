// SPDX-License-Identifier: GPL-3.0-or-later

import { zoneRange } from '@/lib/zones';
import type { HRSample, ZoneConfig, ZoneNumber } from '@/types';

export type LiveGuardrailKind =
  | 'maf_buffer'
  | 'early_too_fast'
  | 'drift'
  | 'walk_recovery'
  | 'zone_eta';

export type LiveGuardrailSeverity = 'info' | 'warn' | 'urgent';

export interface LiveGuardrail {
  kind: LiveGuardrailKind;
  severity: LiveGuardrailSeverity;
  title: string;
  message: string;
  targetBpm?: number;
  etaSec?: number;
}

export interface LiveGuardrailSample extends Pick<HRSample, 'bpm'> {
  elapsedMs: number;
}

interface EvaluateLiveGuardrailsInput {
  samples: readonly LiveGuardrailSample[];
  zones: ZoneConfig;
  elapsedMs: number;
  targetZone?: ZoneNumber;
  includeEta?: boolean;
}

export const MAF_BUFFER_BPM = 3;
const EARLY_FAST_START_MS = 2 * 60_000;
const EARLY_FAST_END_MS = 10 * 60_000;
const DRIFT_MIN_ELAPSED_MS = 20 * 60_000;
const DRIFT_BASELINE_START_MS = 5 * 60_000;
/**
 * Exported so sample buffers can pin the [5,10]-min baseline window: a plain
 * rolling 30-min prune deleted the baseline after minute 40, silently killing
 * drift detection for the rest of every long run.
 */
export const DRIFT_BASELINE_END_MS = 10 * 60_000;
const DRIFT_RECENT_WINDOW_MS = 2 * 60_000;
export const DRIFT_WARN_BPM = 8;
const ETA_WINDOW_MS = 3 * 60_000;
const ETA_MIN_SEC = 30;
const ETA_MAX_SEC = 10 * 60;
const ETA_MIN_SLOPE_BPM_PER_SEC = 0.015;

// Spoken guardrail copy, exported so the cue prewarm lists the exact phrases.
export function mafBufferMessage(z2Ceiling: number, bpm: number): string {
  const gap = z2Ceiling - bpm;
  return `${gap === 0 ? 'At the ceiling' : `${gap} bpm below ceiling`}. Shorten stride or walk early.`;
}

export function earlyTooFastMessage(z2Ceiling: number): string {
  return `Back off now. Keep the first 10 minutes under ${z2Ceiling - MAF_BUFFER_BPM} bpm.`;
}

export function driftMessage(driftBpm: number): string {
  return `HR is up ${driftBpm} bpm from early steady state. Ease down before it turns into Z3.`;
}

export function mafCeilingFromZones(zones: ZoneConfig): number {
  return zoneRange(zones, 2)[1];
}

export function recoveryFloorFromZones(zones: ZoneConfig): number {
  return zoneRange(zones, 2)[0];
}

export function normalizeSessionZones<T extends { target_zone: ZoneNumber; hr_ceiling: number }>(
  session: T,
  zones: ZoneConfig
): T {
  const targetRange = zoneRange(zones, session.target_zone);
  return {
    ...session,
    hr_ceiling: session.hr_ceiling > 0 ? targetRange[1] : 0,
  };
}

export function evaluateLiveGuardrails({
  samples,
  zones,
  elapsedMs,
  targetZone = 2,
  includeEta = true,
}: EvaluateLiveGuardrailsInput): LiveGuardrail[] {
  const current = latestSample(samples);
  if (!current) return [];

  const z2Ceiling = mafCeilingFromZones(zones);
  const recoveryFloor = recoveryFloorFromZones(zones);
  const targetCeiling = zoneRange(zones, targetZone)[1];
  const guardrails: LiveGuardrail[] = [];

  if (targetZone === 2 && current.bpm > z2Ceiling) {
    guardrails.push({
      kind: 'walk_recovery',
      severity: 'urgent',
      title: 'Walk recovery',
      message: `Walk until HR drops below ${recoveryFloor} bpm, then restart easy.`,
      targetBpm: recoveryFloor,
    });
  } else if (targetZone === 2 && current.bpm >= z2Ceiling - MAF_BUFFER_BPM) {
    guardrails.push({
      kind: 'maf_buffer',
      severity: 'warn',
      title: 'MAF buffer',
      message: mafBufferMessage(z2Ceiling, current.bpm),
      targetBpm: z2Ceiling,
    });
  }

  if (
    elapsedMs >= EARLY_FAST_START_MS &&
    elapsedMs < EARLY_FAST_END_MS &&
    targetZone === 2 &&
    current.bpm >= z2Ceiling - MAF_BUFFER_BPM
  ) {
    guardrails.push({
      kind: 'early_too_fast',
      severity: 'warn',
      title: 'First 10 min too hot',
      message: earlyTooFastMessage(z2Ceiling),
      targetBpm: z2Ceiling - MAF_BUFFER_BPM,
    });
  }

  const drift = driftBpm(samples, elapsedMs);
  if (
    elapsedMs >= DRIFT_MIN_ELAPSED_MS &&
    targetZone === 2 &&
    drift !== null &&
    drift >= DRIFT_WARN_BPM &&
    current.bpm >= z2Ceiling - 5
  ) {
    guardrails.push({
      kind: 'drift',
      severity: 'warn',
      title: 'HR drift',
      message: driftMessage(Math.round(drift)),
    });
  }

  if (includeEta && current.bpm < targetCeiling) {
    const etaSec = zoneEtaSec(samples, targetCeiling, elapsedMs);
    if (etaSec !== null) {
      guardrails.push({
        kind: 'zone_eta',
        severity: 'info',
        title: `Z${targetZone} ceiling ETA`,
        message: `At this rise rate, ceiling in about ${formatEta(etaSec)}.`,
        targetBpm: targetCeiling,
        etaSec,
      });
    }
  }

  return guardrails;
}

export function zoneEtaSec(
  samples: readonly LiveGuardrailSample[],
  targetBpm: number,
  elapsedMs: number
): number | null {
  const window = samples.filter(
    (s) => s.elapsedMs >= elapsedMs - ETA_WINDOW_MS && s.elapsedMs <= elapsedMs
  );
  if (window.length < 4) return null;
  const current = latestSample(window);
  if (!current || current.bpm >= targetBpm) return null;

  const slope = bpmSlopePerSec(window);
  if (slope === null || slope < ETA_MIN_SLOPE_BPM_PER_SEC) return null;

  const etaSec = (targetBpm - current.bpm) / slope;
  if (etaSec < ETA_MIN_SEC || etaSec > ETA_MAX_SEC) return null;
  return Math.round(etaSec);
}

function driftBpm(
  samples: readonly LiveGuardrailSample[],
  elapsedMs: number
): number | null {
  const baseline = meanBpmInWindow(
    samples,
    DRIFT_BASELINE_START_MS,
    DRIFT_BASELINE_END_MS
  );
  const recent = meanBpmInWindow(
    samples,
    Math.max(0, elapsedMs - DRIFT_RECENT_WINDOW_MS),
    elapsedMs
  );
  if (baseline === null || recent === null) return null;
  return recent - baseline;
}

function meanBpmInWindow(
  samples: readonly LiveGuardrailSample[],
  startMs: number,
  endMs: number
): number | null {
  let sum = 0;
  let count = 0;
  for (const sample of samples) {
    if (sample.elapsedMs < startMs || sample.elapsedMs > endMs) continue;
    sum += sample.bpm;
    count += 1;
  }
  return count === 0 ? null : sum / count;
}

function bpmSlopePerSec(samples: readonly LiveGuardrailSample[]): number | null {
  if (samples.length < 2) return null;
  const first = samples[0];
  if (!first) return null;
  const t0 = first.elapsedMs / 1000;
  let sumT = 0;
  let sumBpm = 0;
  for (const sample of samples) {
    sumT += sample.elapsedMs / 1000 - t0;
    sumBpm += sample.bpm;
  }
  const meanT = sumT / samples.length;
  const meanBpm = sumBpm / samples.length;
  let numerator = 0;
  let denominator = 0;
  for (const sample of samples) {
    const t = sample.elapsedMs / 1000 - t0;
    numerator += (t - meanT) * (sample.bpm - meanBpm);
    denominator += (t - meanT) ** 2;
  }
  if (denominator === 0) return null;
  return numerator / denominator;
}

function latestSample(
  samples: readonly LiveGuardrailSample[]
): LiveGuardrailSample | null {
  return samples[samples.length - 1] ?? null;
}

function formatEta(sec: number): string {
  if (sec < 60) return `${sec} sec`;
  const min = Math.round(sec / 60);
  return `${min} min`;
}
