// SPDX-License-Identifier: GPL-3.0-or-later

import {
  COACH_CUE_COOLDOWN_MS,
  COACH_PERIODIC_CHECKIN_MS,
} from '@/config/constants';
import { cadenceCueText, cadenceTone } from '@/lib/coach/cadence';
import {
  evaluateLiveGuardrails,
  mafCeilingFromZones,
  recoveryFloorFromZones,
  type LiveGuardrail,
  type LiveGuardrailKind,
  type LiveGuardrailSample,
  DRIFT_BASELINE_END_MS,
} from '@/lib/coach/guardrails';
import { spokenBpm } from '@/lib/coach/spoken';
import { zoneRange } from '@/lib/zones';
import type {
  CoachCue,
  CoachCueKind,
  CoachState,
  CoachVerbosity,
  HRSample,
  IntervalBlock,
  IntervalIntensity,
  ReadinessLabel,
  ReadinessScore,
  Session,
  UserProfile,
  ZoneNumber,
} from '@/types';

/**
 * Pure coach engine. No React, no audio. Consumers call `tick(sample, runElapsedMs)`
 * on each HR sample and dispatch the returned cues. All time-based logic uses
 * `runElapsedMs` (monotonic, paused-time excluded) — never wall clock.
 */

export interface CoachEngineConfig {
  session: Session;
  verbosity: CoachVerbosity;
  nasalReminder: boolean;
  profile: UserProfile;
  /** Today's readiness score, if computed. Drives pre-run cue and check-in copy. */
  readiness?: ReadinessScore | null;
  /** When false, use regular over-ceiling cues but suppress repeating alarm pulses. */
  screamModeEnabled?: boolean;
  /** Bpm above ceiling that triggers escalated "scream mode" alerts. Default 5. */
  screamThresholdBpm?: number;
  /** Latest cadence (spm) supplied by the integrator. Updated via `tick`. */
  currentCadence?: number | null;
  /** Target cadence in steps-per-minute for cadence nudges. Default 170. */
  cadenceTarget?: number;
  /** When false, suppress mid-run fueling reminders. Default true. */
  fuelingRemindersEnabled?: boolean;
}

export interface CoachEngine {
  tick: (
    sample: HRSample,
    runElapsedMs: number,
    currentCadence?: number | null
  ) => CoachCue[];
  finish: (runElapsedMs: number) => CoachCue[];
  getState: () => CoachState;
}

const INTERVAL_RECOVERED_BPM = 130;
const DEFAULT_INTERVAL_WARMUP_MS = 10 * 60 * 1000;
/** After the warm-up, give HR this long to climb before "pick it up" cues. */
const BAND_SETTLE_MS = 60_000;
const BAND_LOW_REPEAT_MS = 60_000;
const INTERVAL_PRE_WARN_MS = 30_000;
const INTERVAL_PUSH_DELAY_MS = 30_000;
/** HR lags a long rep by 1-2 min, so a 4 min rep waits longer before "go faster". */
const LONG_REP_MS = 3 * 60_000;
const LONG_REP_PUSH_DELAY_MS = 90_000;
const INTERVAL_PUSH_REPEAT_MS = 60_000;
/** A strap that connects this close to the warm-up end skips the start cue. */
const WARMUP_START_MIN_LEFT_MS = 60_000;
const SCREAM_REPEAT_MS = 10_000;
export const DEFAULT_SCREAM_THRESHOLD_BPM = 5;
const PRE_RUN_WINDOW_MS = 5_000;
const DEFAULT_CADENCE_TARGET = 170;
const CADENCE_WARMUP_MS = 10 * 60 * 1000;
const CADENCE_CHECK_INTERVAL_MS = 2 * 60 * 1000;
const CADENCE_COOLDOWN_MS = 90_000;
const FUELING_INTERVAL_MS = 30 * 60 * 1000;
export const FUELING_MIN_DURATION_MIN = 75;
const GRAY_ZONE_TOP_FALLBACK = 155;
const MAF_BUFFER_REPEAT_MS = 2 * 60 * 1000;
const EARLY_FAST_REPEAT_MS = 5 * 60 * 1000;
const DRIFT_REPEAT_MS = 5 * 60 * 1000;

/**
 * Every engine cue text, in one place. The engine speaks only through these
 * builders, so lib/coach/cuePhrases can list the exact phrases a session can
 * emit and pre-synthesise them before the runner loses signal.
 */
export const ENGINE_CUE_TEXT = {
  warmupStart: (min: number) => `Easy warm-up. ${min} minutes, then we lift the effort.`,
  warmupStartLeft: (min: number) =>
    `Easy warm-up. About ${min} minutes left, then we lift the effort.`,
  warmupDone: (spokenBand: string, isInterval: boolean) =>
    isInterval
      ? `Warm-up done. Go faster now. Take it up to ${spokenBand}.`
      : `Warm-up done. Take it up to ${spokenBand}.`,
  bandWorkDone: (workMin: number) => `${workMin} minutes done. Cool down easy, then finish the run.`,
  repsDone: 'Reps done. Cool down easy, then finish the run.',
  repGo: 'Go faster now.',
  lastRep: 'Go faster. Last one, give everything.',
  repPush: (target: number) => `Go faster. Push to ${target} bpm.`,
  repPreWarn: '30 seconds, get ready',
  repRecovered: 'Good. Stay rested.',
  sessionComplete: 'Session complete. Well done.',
  fueling: '30 grams of carbs now. Gel or dates.',
  bandScream: (bpm: number) => `WARNING. Ease off now. Heart rate ${bpm}.`,
  bandOver: (bpm: number, ceiling: number) => `Ease off. Heart rate ${bpm}, back under ${ceiling}.`,
  bandStillOver: (bpm: number, ceiling: number) => `Still over ${ceiling} at ${bpm}. Ease off.`,
  bandLow: (bpm: number, floor: number, ceiling: number) =>
    `Pick it up. Heart rate ${bpm}, target ${floor} to ${ceiling}.`,
  bandBackIn: (bpm: number) => `Back in range at ${bpm}. Hold it.`,
  z2Scream: (bpm: number) => `WARNING. Slow down now. Heart rate ${bpm}.`,
  z2SlowDown: (bpm: number, inGrayZone: boolean) =>
    inGrayZone
      ? `Slow down. Heart rate ${bpm}, you're in the gray zone. Drop back to Z2.`
      : `Slow down. Heart rate ${bpm}, return to Z2`,
  z2StillAbove: (bpm: number) => `Still above ceiling at ${bpm}. Slow down.`,
  z2Recovered: (recoveredBpm: number) => `Recovered below ${recoveredBpm}. Restart easy.`,
  nasalOnly: 'Nasal breathing only',
  nasalCloseMouth: 'Close your mouth, breathe through your nose',
} as const;

/** "one forty-six to one fifty-seven": the band as the warm-up-done cue says it. */
export function spokenBandText(floor: number, ceiling: number): string {
  return `${spokenBpm(floor)} to ${spokenBpm(ceiling)}`;
}

/** Gray zone top used by the Z2 slow-down copy (top of Z3, or a fallback). */
export function grayZoneTopFor(zones: UserProfile['zones']): number {
  const ceiling = mafCeilingFromZones(zones);
  const z3Top = zoneRange(zones, 3)[1];
  return z3Top > ceiling ? z3Top : GRAY_ZONE_TOP_FALLBACK;
}

interface CueLog {
  kind: CoachCueKind;
  /** runElapsedMs when emitted */
  at: number;
  /** Per-rep marker — to suppress duplicate cues within the same rep */
  rep?: number;
  phase?: CoachState['intervalPhase'];
}

export function createCoachEngine(config: CoachEngineConfig): CoachEngine {
  const state: CoachState = {
    inZone: true,
    activeInterval: -1,
    intervalPhase: 'idle',
    lastCueAt: -Infinity,
    cueCooldownMs: COACH_CUE_COOLDOWN_MS,
  };

  const cueHistory: CueLog[] = [];
  let lastPeriodicAt = 0;
  let lastPhase: CoachState['intervalPhase'] = 'idle';
  let lastRep = -1;
  let preRunAnnounced = false;
  let warmupStartAnnounced = false;
  let warmupEndAnnounced = false;
  let workDoneAnnounced = false;
  // Once-per-rep gates. The 15 s cooldown alone let the 30 s pre-warn fire
  // twice and "Good. Stay rested." repeat all through a 4 min recovery.
  const preWarnedReps = new Set<number>();
  const recoveredAckReps = new Set<number>();
  const lastPushAtByRep = new Map<number, number>();
  let lastBandLowAt = -Infinity;
  let lastScreamAt = -Infinity;
  let currentCadence: number | null = config.currentCadence ?? null;
  let lastCadenceCheckAt = 0;
  let lastCadenceCueAt = -Infinity;
  let lastFuelingMarker = 0;
  let z2Samples: LiveGuardrailSample[] = [];
  const lastGuardrailAt: Partial<Record<LiveGuardrailKind, number>> = {};

  const readiness = config.readiness ?? null;
  const screamModeEnabled = config.screamModeEnabled !== false;
  const screamThresholdBpm =
    config.screamThresholdBpm ?? DEFAULT_SCREAM_THRESHOLD_BPM;
  const cadenceTarget = config.cadenceTarget ?? DEFAULT_CADENCE_TARGET;
  const fuelingEnabled = config.fuelingRemindersEnabled !== false;

  const isInterval = !!config.session.intervals;
  const isZ2 = config.session.run_type === 'long';
  // Medium: a continuous effort held inside an explicit % of max HR band.
  const isBand = !isInterval && config.session.hr_floor !== undefined;
  const warmupMs = (config.session.warmup_sec ?? 0) * 1000;
  const intervalWarmupMs = warmupMs > 0 ? warmupMs : DEFAULT_INTERVAL_WARMUP_MS;
  const bandFloor = config.session.hr_floor ?? 0;
  const bandCeiling = config.session.hr_ceiling;
  // Medium's work block ends at the planned duration; after it we cool down.
  const bandWorkEndMs = warmupMs > 0 ? config.session.duration_min * 60_000 : Infinity;
  const spokenBand = spokenBandText(bandFloor, bandCeiling);

  const fuelingApplicable =
    fuelingEnabled && config.session.duration_min >= FUELING_MIN_DURATION_MIN;

  function recentlyEmitted(
    kind: CoachCueKind,
    runElapsedMs: number,
    extra?: { rep?: number; phase?: CoachState['intervalPhase'] }
  ): boolean {
    for (let i = cueHistory.length - 1; i >= 0; i--) {
      const log = cueHistory[i];
      if (!log) continue;
      if (log.kind !== kind) continue;
      if (extra?.rep !== undefined && log.rep !== extra.rep) continue;
      if (extra?.phase !== undefined && log.phase !== extra.phase) continue;
      if (runElapsedMs - log.at < state.cueCooldownMs) return true;
      return false;
    }
    return false;
  }

  function emit(
    cues: CoachCue[],
    kind: CoachCueKind,
    text: string,
    tone: NonNullable<CoachCue['tone']>,
    runElapsedMs: number,
    extra?: { rep?: number; phase?: CoachState['intervalPhase'] }
  ): void {
    if (recentlyEmitted(kind, runElapsedMs, extra)) return;
    cues.push({ kind, text, tone, timestamp: Date.now() });
    cueHistory.push({
      kind,
      at: runElapsedMs,
      ...(extra?.rep !== undefined ? { rep: extra.rep } : {}),
      ...(extra?.phase !== undefined ? { phase: extra.phase } : {}),
    });
    state.lastCueAt = runElapsedMs;
  }

  /**
   * Scream-mode emit bypasses the standard 15s cooldown via a dedicated
   * `lastScreamAt` clock so escalated alerts can re-fire every 10s.
   * Deliberately NOT recorded into cueHistory: a scream entry would trip the
   * standard cooldown matcher and suppress legitimate `zone_exceeded` cues
   * after recovery.
   */
  function emitScream(
    cues: CoachCue[],
    text: string,
    runElapsedMs: number
  ): void {
    if (runElapsedMs - lastScreamAt < SCREAM_REPEAT_MS) return;
    lastScreamAt = runElapsedMs;
    cues.push({
      kind: 'zone_exceeded',
      text,
      tone: 'urgent',
      timestamp: Date.now(),
    });
    state.lastCueAt = runElapsedMs;
  }

  function readinessCheckinSuffix(): string {
    if (!readiness) return '';
    switch (readiness.label) {
      case 'good':
        return ", you've got the legs today";
      case 'moderate':
        return ', stay relaxed';
      case 'low':
        return ', keep it boring, recover';
      case 'unknown':
        return '';
    }
  }

  function preRunCueFor(label: ReadinessLabel, score: number | null): {
    text: string;
    tone: NonNullable<CoachCue['tone']>;
  } | null {
    const scoreText = score !== null ? `${score}` : 'unknown';
    switch (label) {
      case 'good':
        return { text: `Readiness ${scoreText}, you're ready`, tone: 'rising' };
      case 'moderate':
        return {
          text: `Readiness ${scoreText}, keep effort steady`,
          tone: 'steady',
        };
      case 'low':
        return {
          text: 'Readiness is low. Take it easy today',
          tone: 'falling',
        };
      case 'unknown':
        return null;
    }
  }

  function maybeEmitPreRun(runElapsedMs: number, cues: CoachCue[]): void {
    if (preRunAnnounced) return;
    if (runElapsedMs >= PRE_RUN_WINDOW_MS) return;
    preRunAnnounced = true;
    if (!readiness) return;
    const cue = preRunCueFor(readiness.label, readiness.score);
    if (!cue) return;
    cues.push({
      kind: 'periodic_checkin',
      text: cue.text,
      tone: cue.tone,
      timestamp: Date.now(),
    });
    cueHistory.push({ kind: 'periodic_checkin', at: runElapsedMs });
  }

  /**
   * Warm-up bookends for medium/brief: one cue at the start, one when the
   * warm-up ends naming the target band. No band or guardrail verdicts fire
   * in between; the tick functions return early while in the warm-up.
   *
   * The start cue keys off the first HR sample rather than the first 5 s: a
   * strap that takes 20-60 s to deliver a sample used to lose it entirely.
   */
  function maybeEmitWarmupCues(runElapsedMs: number, cues: CoachCue[]): boolean {
    if (warmupMs <= 0) return false;
    if (runElapsedMs < warmupMs) {
      if (state.intervalPhase !== 'warmup') {
        state.intervalPhase = 'warmup';
        state.activeInterval = -1;
      }
      const leftMs = warmupMs - runElapsedMs;
      if (!warmupStartAnnounced && leftMs >= WARMUP_START_MIN_LEFT_MS) {
        warmupStartAnnounced = true;
        const text =
          runElapsedMs < PRE_RUN_WINDOW_MS
            ? ENGINE_CUE_TEXT.warmupStart(Math.round(warmupMs / 60_000))
            : ENGINE_CUE_TEXT.warmupStartLeft(Math.round(leftMs / 60_000));
        cues.push({ kind: 'interval_warmup', text, tone: 'steady', timestamp: Date.now() });
        cueHistory.push({ kind: 'interval_warmup', at: runElapsedMs });
      }
      warmupStartAnnounced = true;
      return true;
    }
    if (!warmupEndAnnounced) {
      warmupEndAnnounced = true;
      state.inZone = true;
      cues.push({
        kind: 'interval_start',
        text: ENGINE_CUE_TEXT.warmupDone(spokenBand, isInterval),
        tone: 'rising',
        timestamp: Date.now(),
      });
      cueHistory.push({ kind: 'interval_start', at: runElapsedMs, rep: 0 });
      state.lastCueAt = runElapsedMs;
    }
    return false;
  }

  /** One "cool down" cue when the hard part is over; silence afterwards. */
  function announceWorkDone(text: string, runElapsedMs: number, cues: CoachCue[]): void {
    state.intervalPhase = 'done';
    if (workDoneAnnounced) return;
    workDoneAnnounced = true;
    cues.push({ kind: 'interval_recover', text, tone: 'falling', timestamp: Date.now() });
    cueHistory.push({ kind: 'interval_recover', at: runElapsedMs, phase: 'done' });
    state.lastCueAt = runElapsedMs;
  }

  function tickBand(sample: HRSample, runElapsedMs: number, cues: CoachCue[]): void {
    if (maybeEmitWarmupCues(runElapsedMs, cues)) return;
    if (runElapsedMs >= bandWorkEndMs) {
      const workMin = Math.round((bandWorkEndMs - warmupMs) / 60_000);
      announceWorkDone(ENGINE_CUE_TEXT.bandWorkDone(workMin), runElapsedMs, cues);
      return;
    }
    if (state.intervalPhase !== 'work') state.intervalPhase = 'work';

    const screamCeiling = bandCeiling + screamThresholdBpm;
    if (sample.bpm > bandCeiling) {
      if (screamModeEnabled && sample.bpm > screamCeiling) {
        emitScream(cues, ENGINE_CUE_TEXT.bandScream(sample.bpm), runElapsedMs);
        state.inZone = false;
      } else if (state.inZone) {
        state.inZone = false;
        emit(
          cues,
          'zone_exceeded',
          ENGINE_CUE_TEXT.bandOver(sample.bpm, bandCeiling),
          'urgent',
          runElapsedMs
        );
      } else {
        emit(
          cues,
          'zone_exceeded',
          ENGINE_CUE_TEXT.bandStillOver(sample.bpm, bandCeiling),
          'urgent',
          runElapsedMs
        );
      }
    } else if (sample.bpm < bandFloor) {
      if (
        runElapsedMs - warmupMs >= BAND_SETTLE_MS &&
        runElapsedMs - lastBandLowAt >= BAND_LOW_REPEAT_MS
      ) {
        lastBandLowAt = runElapsedMs;
        emit(
          cues,
          'interval_push',
          ENGINE_CUE_TEXT.bandLow(sample.bpm, bandFloor, bandCeiling),
          'rising',
          runElapsedMs
        );
      }
    } else if (!state.inZone) {
      state.inZone = true;
      lastScreamAt = -Infinity;
      emit(cues, 'zone_recovered', ENGINE_CUE_TEXT.bandBackIn(sample.bpm), 'steady', runElapsedMs);
    }

    if (runElapsedMs - lastPeriodicAt >= COACH_PERIODIC_CHECKIN_MS) {
      lastPeriodicAt = runElapsedMs;
      const min = Math.floor(runElapsedMs / 60_000);
      emit(
        cues,
        'periodic_checkin',
        `${min} minutes in, heart rate ${sample.bpm}${readinessCheckinSuffix()}`,
        'steady',
        runElapsedMs
      );
    }

    maybeEmitCadenceCue(sample, runElapsedMs, cues);
  }

  function tickZ2(sample: HRSample, runElapsedMs: number, cues: CoachCue[]): void {
    // Keep the drift baseline window forever + a rolling 30 min of recents.
    // Pruning everything older than 30 min emptied the fixed [5,10]-min
    // baseline after minute 40, so cardiac drift was never flagged on the
    // long runs it exists for.
    z2Samples = [...z2Samples, { bpm: sample.bpm, elapsedMs: runElapsedMs }].filter(
      (s) =>
        s.elapsedMs <= DRIFT_BASELINE_END_MS ||
        runElapsedMs - s.elapsedMs <= 30 * 60_000
    );

    const effectiveCeiling = mafCeilingFromZones(config.profile.zones);
    const recoveredBpm = recoveryFloorFromZones(config.profile.zones);
    const grayZoneTop = grayZoneTopFor(config.profile.zones);
    const inGrayZone = sample.bpm > effectiveCeiling && sample.bpm <= grayZoneTop;
    const slowDownText = ENGINE_CUE_TEXT.z2SlowDown(sample.bpm, inGrayZone);

    const screamCeiling = effectiveCeiling + screamThresholdBpm;
    // Gray zone copy outranks scream mode until HR clears Z3 top — the
    // educational "you're drifting into Z3" nudge is more useful than a
    // panic alarm when the runner is only marginally above MAF.
    const inScreamRange =
      screamModeEnabled && sample.bpm > screamCeiling && sample.bpm > grayZoneTop;

    if (sample.bpm > effectiveCeiling) {
      if (inScreamRange) {
        // Escalated alert: re-fires every 10s via dedicated scream clock,
        // bypassing the 15s zone_exceeded cooldown.
        emitScream(
          cues,
          ENGINE_CUE_TEXT.z2Scream(sample.bpm),
          runElapsedMs
        );
        state.inZone = false;
        if (config.nasalReminder) {
          emit(
            cues,
            'nasal_breathing',
            ENGINE_CUE_TEXT.nasalOnly,
            'steady',
            runElapsedMs
          );
        }
      } else if (state.inZone) {
        state.inZone = false;
        emit(
          cues,
          'zone_exceeded',
          slowDownText,
          'urgent',
          runElapsedMs
        );
        if (config.nasalReminder) {
          emit(
            cues,
            'nasal_breathing',
            ENGINE_CUE_TEXT.nasalCloseMouth,
            'steady',
            runElapsedMs
          );
        }
      } else {
        emit(
          cues,
          'zone_exceeded',
          ENGINE_CUE_TEXT.z2StillAbove(sample.bpm),
          'urgent',
          runElapsedMs
        );
        if (config.nasalReminder) {
          emit(
            cues,
            'nasal_breathing',
            ENGINE_CUE_TEXT.nasalOnly,
            'steady',
            runElapsedMs
          );
        }
      }
    } else if (!state.inZone && sample.bpm < recoveredBpm) {
      state.inZone = true;
      lastScreamAt = -Infinity;
      emit(
        cues,
        'zone_recovered',
        ENGINE_CUE_TEXT.z2Recovered(recoveredBpm),
        'steady',
        runElapsedMs
      );
    }

    maybeEmitLiveGuardrailCues(runElapsedMs, cues);

    if (runElapsedMs - lastPeriodicAt >= COACH_PERIODIC_CHECKIN_MS) {
      lastPeriodicAt = runElapsedMs;
      const min = Math.floor(runElapsedMs / 60_000);
      const suffix = readinessCheckinSuffix();
      emit(
        cues,
        'periodic_checkin',
        `${min} minutes in, heart rate ${sample.bpm}${suffix}`,
        'steady',
        runElapsedMs
      );
    }

    maybeEmitCadenceCue(sample, runElapsedMs, cues);
  }

  function maybeEmitCadenceCue(
    sample: HRSample,
    runElapsedMs: number,
    cues: CoachCue[]
  ): void {
    if (currentCadence === null) return;
    if (runElapsedMs < CADENCE_WARMUP_MS) return;
    if (runElapsedMs - lastCadenceCheckAt < CADENCE_CHECK_INTERVAL_MS) return;
    if (runElapsedMs - lastCadenceCueAt < CADENCE_COOLDOWN_MS) return;

    // Suppress cadence chatter while scream mode is active so the urgent HR
    // alert isn't drowned out by a form nudge.
    const ceiling = isZ2 ? mafCeilingFromZones(config.profile.zones) : bandCeiling;
    if (screamModeEnabled && sample.bpm > ceiling + screamThresholdBpm) return;

    lastCadenceCheckAt = runElapsedMs;
    const text = cadenceCueText(currentCadence, cadenceTarget);
    const tone = cadenceTone(currentCadence, cadenceTarget);
    if (!text || !tone) return;

    lastCadenceCueAt = runElapsedMs;
    emit(cues, 'periodic_checkin', text, tone, runElapsedMs, {
      phase: 'work',
    });
  }

  function maybeEmitFuelingCue(
    runElapsedMs: number,
    cues: CoachCue[]
  ): void {
    if (!fuelingApplicable) return;
    const marker = Math.floor(runElapsedMs / FUELING_INTERVAL_MS);
    if (marker <= 0) return;
    if (marker === lastFuelingMarker) return;
    lastFuelingMarker = marker;
    // Fueling cues bypass cueHistory entirely — `lastFuelingMarker` is the
    // sole dedupe gate. Recording into cueHistory would let the normal
    // periodic-checkin matcher (15s cooldown) suppress an adjacent Z2
    // check-in, which the spec explicitly forbids ("both can fire if both
    // are due").
    cues.push({
      kind: 'periodic_checkin',
      text: ENGINE_CUE_TEXT.fueling,
      tone: 'steady',
      timestamp: Date.now(),
    });
  }

  function maybeEmitLiveGuardrailCues(runElapsedMs: number, cues: CoachCue[]): void {
    const guardrails = evaluateLiveGuardrails({
      samples: z2Samples,
      zones: config.profile.zones,
      elapsedMs: runElapsedMs,
      targetZone: 2,
      includeEta: false,
    });
    const prioritized = guardrails.find((g) => g.kind === 'early_too_fast')
      ?? guardrails.find((g) => g.kind === 'drift')
      ?? guardrails.find((g) => g.kind === 'maf_buffer');
    if (!prioritized) return;
    for (const guardrail of [prioritized]) {
      const cue = guardrailCue(guardrail);
      if (!cue) continue;
      const lastAt = lastGuardrailAt[guardrail.kind] ?? -Infinity;
      if (runElapsedMs - lastAt < cue.cooldownMs) continue;
      lastGuardrailAt[guardrail.kind] = runElapsedMs;
      emit(cues, cue.kind, cue.text, cue.tone, runElapsedMs);
    }
  }

  function tickIntervals(
    sample: HRSample,
    runElapsedMs: number,
    cues: CoachCue[]
  ): void {
    const intervals = config.session.intervals;
    if (!intervals) return;

    const workMs = intervals.work_sec * 1000;
    const restMs = intervals.rest_sec * 1000;
    const cycleMs = workMs + restMs;
    const totalReps = intervals.reps;

    if (runElapsedMs < intervalWarmupMs) {
      maybeEmitWarmupCues(runElapsedMs, cues);
      if (state.intervalPhase !== 'warmup') {
        state.intervalPhase = 'warmup';
        state.activeInterval = -1;
      }
      maybePreWarn(0, intervalWarmupMs - runElapsedMs, runElapsedMs, cues);
      return;
    }

    // The warm-up-end cue already says "go faster" for rep 0; its cueHistory
    // entry carries rep 0 so the generic interval_start below is deduped.
    maybeEmitWarmupCues(runElapsedMs, cues);
    const intoBlock = runElapsedMs - intervalWarmupMs;
    const repIdx = Math.floor(intoBlock / cycleMs);
    const intoCycle = intoBlock - repIdx * cycleMs;
    const inWork = intoCycle < workMs;

    // The rest after the final rep is the cool-down, not a recovery: announce
    // "reps done" once as the last work block ends and go quiet.
    if (repIdx >= totalReps || (repIdx === totalReps - 1 && !inWork)) {
      state.activeInterval = totalReps;
      announceWorkDone(ENGINE_CUE_TEXT.repsDone, runElapsedMs, cues);
      return;
    }

    const phase: CoachState['intervalPhase'] = inWork ? 'work' : 'recover';

    if (!inWork) maybePreWarn(repIdx + 1, cycleMs - intoCycle, runElapsedMs, cues);

    if (phase !== lastPhase || repIdx !== lastRep) {
      lastPhase = phase;
      lastRep = repIdx;
      state.activeInterval = repIdx;
      state.intervalPhase = phase;

      if (phase === 'work') {
        const isFinal = repIdx === totalReps - 1;
        if (isFinal) {
          emit(
            cues,
            'final_interval',
            ENGINE_CUE_TEXT.lastRep,
            'urgent',
            runElapsedMs,
            { rep: repIdx }
          );
        } else {
          emit(cues, 'interval_start', ENGINE_CUE_TEXT.repGo, 'rising', runElapsedMs, {
            rep: repIdx,
          });
        }
      } else {
        emit(
          cues,
          'interval_recover',
          recoveryCueText(intervals, 'recover'),
          'falling',
          runElapsedMs,
          { rep: repIdx }
        );
      }
    }

    if (phase === 'work') {
      const pushDelayMs = workMs >= LONG_REP_MS ? LONG_REP_PUSH_DELAY_MS : INTERVAL_PUSH_DELAY_MS;
      const lastPushAt = lastPushAtByRep.get(repIdx) ?? -Infinity;
      const target = resolveIntervalTarget(config.profile.zones, intervals);
      if (
        intoCycle >= pushDelayMs &&
        runElapsedMs - lastPushAt >= INTERVAL_PUSH_REPEAT_MS &&
        sample.bpm < target
      ) {
        lastPushAtByRep.set(repIdx, runElapsedMs);
        emit(
          cues,
          'interval_push',
          ENGINE_CUE_TEXT.repPush(target),
          'urgent',
          runElapsedMs,
          { rep: repIdx, phase: 'work' }
        );
      }
    }

    if (
      phase === 'recover' &&
      sample.bpm < INTERVAL_RECOVERED_BPM &&
      !recoveredAckReps.has(repIdx)
    ) {
      recoveredAckReps.add(repIdx);
      emit(cues, 'interval_recovered', ENGINE_CUE_TEXT.repRecovered, 'steady', runElapsedMs, {
        rep: repIdx,
        phase: 'recover',
      });
    }
  }

  /** "30 seconds, get ready" once per upcoming rep, inside the last 30 s. */
  function maybePreWarn(
    rep: number,
    untilWorkMs: number,
    runElapsedMs: number,
    cues: CoachCue[]
  ): void {
    if (untilWorkMs > INTERVAL_PRE_WARN_MS || untilWorkMs <= 0) return;
    if (preWarnedReps.has(rep)) return;
    preWarnedReps.add(rep);
    emit(cues, 'interval_warmup', ENGINE_CUE_TEXT.repPreWarn, 'rising', runElapsedMs, { rep });
  }

  return {
    tick(sample, runElapsedMs, cadenceArg) {
      // Persist the latest cadence so subsequent calls without an argument
      // still see the most recent reading. `null` is treated as "no signal"
      // and clears the cached value; `undefined` leaves it untouched.
      if (cadenceArg !== undefined) currentCadence = cadenceArg;

      const cues: CoachCue[] = [];

      maybeEmitPreRun(runElapsedMs, cues);
      maybeEmitFuelingCue(runElapsedMs, cues);

      if (isInterval) tickIntervals(sample, runElapsedMs, cues);
      else if (isBand) tickBand(sample, runElapsedMs, cues);
      else if (isZ2) tickZ2(sample, runElapsedMs, cues);

      return cues;
    },
    finish(runElapsedMs) {
      const cues: CoachCue[] = [];
      cues.push({
        kind: 'session_complete',
        text: ENGINE_CUE_TEXT.sessionComplete,
        tone: 'falling',
        timestamp: Date.now(),
      });
      cueHistory.push({ kind: 'session_complete', at: runElapsedMs });
      state.lastCueAt = runElapsedMs;
      return cues;
    },
    getState() {
      return { ...state };
    },
  };
}

export function resolveIntervalTarget(
  zones: UserProfile['zones'],
  intervals: NonNullable<Session['intervals']>
): number {
  if (intervals.target_hr) return intervals.target_hr;
  const zoneNum = intensityToZone(intervals.intensity);
  const range = zoneRange(zones, zoneNum);
  return range[0];
}

function intensityToZone(intensity: IntervalIntensity): Extract<ZoneNumber, 3 | 4 | 5> {
  switch (intensity) {
    case 'z3':
      return 3;
    case 'z4':
      return 4;
    case 'z5':
      return 5;
  }
}

export function recoveryCueText(
  block: IntervalBlock,
  fallback: 'recover' | 'jog'
): string {
  if (block.recovery_intensity === 'z1') {
    return fallback === 'jog' ? 'Rest. Easy jog in Z1.' : 'Rest. Recover in Z1.';
  }
  if (block.recovery_intensity === 'z2') {
    return fallback === 'jog' ? 'Rest. Easy jog in Z2.' : 'Rest. Recover in Z2.';
  }
  return fallback === 'jog' ? 'Rest. Easy jog.' : 'Rest. Recover.';
}

function guardrailCue(guardrail: LiveGuardrail): {
  kind: Extract<CoachCueKind, 'maf_buffer' | 'early_too_fast' | 'hr_drift'>;
  text: string;
  tone: NonNullable<CoachCue['tone']>;
  cooldownMs: number;
} | null {
  switch (guardrail.kind) {
    case 'maf_buffer':
      return {
        kind: 'maf_buffer',
        text: guardrail.message,
        tone: 'steady',
        cooldownMs: MAF_BUFFER_REPEAT_MS,
      };
    case 'early_too_fast':
      return {
        kind: 'early_too_fast',
        text: guardrail.message,
        tone: 'falling',
        cooldownMs: EARLY_FAST_REPEAT_MS,
      };
    case 'drift':
      return {
        kind: 'hr_drift',
        text: guardrail.message,
        tone: 'falling',
        cooldownMs: DRIFT_REPEAT_MS,
      };
    case 'walk_recovery':
    case 'zone_eta':
      return null;
  }
}
