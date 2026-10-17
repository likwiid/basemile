// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Voice Mode: strict heart-rate target-band coaching (deterministic, no AI).
 *
 * The band is the HIGH END of a chosen training zone: ceiling = the zone's
 * upper bound (for Z2 this is the MAF cap), floor = ceiling - width. The
 * directive is intentionally strict: the moment HR drops below the floor the
 * athlete is told to speed up, and the moment it crosses the ceiling they are
 * told to ease down. Pure functions so they're unit-testable and reused by both
 * the spoken cue loop and the on-screen overlay.
 */
import type { Session, ZoneConfig, ZoneNumber } from '@/types';

export interface TargetBand {
  zone: ZoneNumber;
  /** Lower bound of the target band, bpm. */
  floor: number;
  /** Upper bound of the target band (zone ceiling), bpm. */
  ceiling: number;
}

export type BandState = 'no_signal' | 'below' | 'in' | 'above';

export interface BandDirective {
  state: BandState;
  /** Concise line for text-to-speech. */
  text: string;
  tone: 'rising' | 'steady' | 'falling' | 'urgent';
}

/** HR more than this far over the ceiling escalates to an urgent cue. */
export const OVER_CEILING_URGENT_BPM = 4;

/** Narrowest allowed band so floor never collides with ceiling. */
const MIN_BAND_WIDTH = 1;

export function zoneRange(zones: ZoneConfig, zone: ZoneNumber): readonly [number, number] {
  switch (zone) {
    case 1:
      return zones.z1;
    case 2:
      return zones.z2;
    case 3:
      return zones.z3;
    case 4:
      return zones.z4;
    case 5:
      return zones.z5;
  }
}

/**
 * Build the target band for the high end of a zone. ceiling = zone upper bound,
 * floor = ceiling - widthBpm, clamped so it never falls below the zone's lower
 * bound.
 */
export function computeTargetBand(
  zones: ZoneConfig,
  zone: ZoneNumber,
  widthBpm: number
): TargetBand {
  const [low, high] = zoneRange(zones, zone);
  const width = Math.max(MIN_BAND_WIDTH, Math.round(widthBpm));
  const ceiling = high;
  const floor = Math.max(low, ceiling - width);
  return { zone, floor, ceiling };
}

export function classifyBand(bpm: number | null, band: TargetBand): BandState {
  if (bpm === null || !Number.isFinite(bpm)) return 'no_signal';
  if (bpm < band.floor) return 'below';
  if (bpm > band.ceiling) return 'above';
  return 'in';
}

/** The big word shown on the overlay. */
export function directiveWord(state: BandState): string {
  switch (state) {
    case 'below':
      return 'GO FASTER';
    case 'above':
      return 'EASE DOWN';
    case 'in':
      return 'HOLD';
    case 'no_signal':
    default:
      return 'NO HR';
  }
}

/**
 * Where an armed session is at `elapsedMs`. 'steady' = a continuous run with
 * no warm-up or blocks (long). Warm-up and recovery blocks never get an
 * above/below verdict: the runner is meant to be out of the band there.
 * 'done' starts when the hard part ends: medium after its planned duration,
 * brief as the LAST work block ends (the rest after it is the cool-down, not a
 * recovery before another rep). Mirrors the coach engine's phase clock.
 */
export type SessionPhase = 'steady' | 'warmup' | 'work' | 'recover' | 'done';

export function sessionPhaseAt(session: Session | null, elapsedMs: number): SessionPhase {
  if (!session) return 'steady';
  const warmupMs = (session.warmup_sec ?? 0) * 1000;
  if (warmupMs > 0 && elapsedMs < warmupMs) return 'warmup';
  const intervals = session.intervals;
  if (!intervals) {
    if (warmupMs === 0) return 'steady';
    return elapsedMs < session.duration_min * 60_000 ? 'work' : 'done';
  }
  const workMs = intervals.work_sec * 1000;
  const cycleMs = workMs + intervals.rest_sec * 1000;
  const intoBlock = elapsedMs - warmupMs;
  const repIdx = Math.floor(intoBlock / cycleMs);
  if (repIdx >= intervals.reps) return 'done';
  if (intoBlock - repIdx * cycleMs < workMs) return 'work';
  return repIdx === intervals.reps - 1 ? 'done' : 'recover';
}

/** The band the armed session wants; null means "use the settings band". */
export function sessionTargetBand(session: Session | null): TargetBand | null {
  if (!session || session.hr_floor === undefined) return null;
  return { zone: session.target_zone, floor: session.hr_floor, ceiling: session.hr_ceiling };
}

/**
 * Phase-aware spoken directive. Outside warm-up/recovery/done it is exactly
 * the strict band directive; inside them it reads HR and names the phase so
 * the athlete is never told to speed up during a recovery jog.
 */
export function evaluateSessionDirective(
  bpm: number | null,
  band: TargetBand,
  phase: SessionPhase
): BandDirective {
  if (phase === 'steady' || phase === 'work') return evaluateBandDirective(bpm, band);
  const state = classifyBand(bpm, band);
  if (state === 'no_signal') {
    return { state, text: 'No heart rate signal. Check your strap.', tone: 'steady' };
  }
  const hr = bpm as number;
  if (phase === 'warmup') {
    return { state: 'in', text: `${hr}. Warm-up. Keep it easy.`, tone: 'steady' };
  }
  if (phase === 'recover') {
    return { state: 'in', text: `${hr}. Recover. Easy until the next rep.`, tone: 'falling' };
  }
  // The engine says "reps done" once; repeating it on every HR cue would nag.
  return { state: 'in', text: `${hr}. Cool down. Keep it easy.`, tone: 'falling' };
}

/** Spoken when Voice Mode opens. */
export function voiceModeIntroText(band: TargetBand): string {
  return `Voice mode on. Target ${band.floor} to ${band.ceiling}.`;
}

/** Spoken after the overlay's "Reset voice" control rebuilds the pipeline. */
export const VOICE_RESET_TEXT = 'Voice is back. Can you hear me?';

/** Build the spoken directive for the current HR against the band. */
export function evaluateBandDirective(bpm: number | null, band: TargetBand): BandDirective {
  const state = classifyBand(bpm, band);

  if (state === 'no_signal') {
    return { state, text: 'No heart rate signal. Check your strap.', tone: 'steady' };
  }

  const hr = bpm as number;

  if (state === 'below') {
    const gap = band.floor - hr;
    const lead = gap >= 5 ? 'Pick up the pace' : 'A touch faster';
    return {
      state,
      text: `${hr}. ${lead}. Target ${band.floor} to ${band.ceiling}.`,
      tone: 'rising',
    };
  }

  if (state === 'above') {
    const over = hr - band.ceiling;
    if (over > OVER_CEILING_URGENT_BPM) {
      return {
        state,
        text: `${hr}. Over the ceiling. Slow down now, back under ${band.ceiling}.`,
        tone: 'urgent',
      };
    }
    return { state, text: `${hr}. Ease back under ${band.ceiling}.`, tone: 'falling' };
  }

  // in band
  return { state, text: `${hr}. On target. Hold this effort.`, tone: 'steady' };
}
