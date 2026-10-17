// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Three run types (Long, Medium, Brief) adapted from published endurance
 * guidance (see README Credits), and the Session each one arms. Pure (no React, no storage) so the catalogue, HR
 * bands, picker card content and legacy-type migration are unit-testable.
 *
 * User-visible strings here are short fragments, never prose, and use a plain
 * hyphen for ranges ("136-154"): no em or en dashes (enforced by a test).
 */
import { mafWindowFromCeiling, zoneRange } from '@/lib/zones';
import type { IntervalBlock, RunTypeId, Session, ZoneConfig } from '@/types';

export type BriefVariantId = 'hiit30' | 'norwegian44';

export interface RunTypeProfile {
  hrMax: number;
  zones: ZoneConfig;
}

export interface HrBand {
  floor: number;
  ceiling: number;
}

/** Static facts about a run type, as scannable fragments. */
export interface RunTypeSpec {
  id: RunTypeId;
  name: string;
  /** One line under the name on the picker card. */
  tagline: string;
  /** How it should feel. */
  effort: string;
  /** What it trains. */
  builds: string;
}

export interface BriefVariantSpec {
  id: BriefVariantId;
  name: string;
  work_sec: number;
  rest_sec: number;
  defaultReps: number;
  /** Rep counts the picker exposes; a single-entry list means fixed reps. */
  repsOptions: readonly number[];
  /** Work-block fragment, e.g. "30s all-out, 60s easy". */
  workLabel: string;
  /** Compact rep chip, e.g. "8 × 30s" (reps filled in). */
  repsChip: (reps: number) => string;
}

export const RUN_TYPE_IDS: readonly RunTypeId[] = ['long', 'medium', 'brief'];
export const DEFAULT_RUN_TYPE: RunTypeId = 'long';
export const DEFAULT_BRIEF_VARIANT: BriefVariantId = 'hiit30';
export const DEFAULT_HIIT_REPS = 8;
export const HIIT_REPS_OPTIONS: readonly number[] = [6, 8, 10, 12];

export const LONG_DURATION_MIN = 60;
export const MEDIUM_WARMUP_SEC = 300;
export const MEDIUM_WORK_MIN = 30;
export const BRIEF_WARMUP_SEC = 420;

/** Fractions of max HR. Medium: high Z3 / low Z4. Brief: near all-out. */
export const MEDIUM_HR_PCT: readonly [number, number] = [0.75, 0.85];
export const BRIEF_HR_PCT: readonly [number, number] = [0.9, 0.95];

export const BRIEF_VARIANTS: readonly BriefVariantSpec[] = [
  {
    id: 'hiit30',
    name: '30 on / 60 off',
    work_sec: 30,
    rest_sec: 60,
    defaultReps: DEFAULT_HIIT_REPS,
    repsOptions: HIIT_REPS_OPTIONS,
    workLabel: '30s all-out, 60s easy',
    repsChip: (reps) => `${reps} × 30s`,
  },
  {
    id: 'norwegian44',
    name: 'Norwegian 4×4',
    work_sec: 240,
    rest_sec: 240,
    defaultReps: 4,
    repsOptions: [4],
    workLabel: '4 min hard, 4 min easy',
    repsChip: (reps) => `${reps} × 4 min`,
  },
];

export function briefVariant(id: BriefVariantId): BriefVariantSpec {
  const found = BRIEF_VARIANTS.find((v) => v.id === id);
  if (!found) throw new Error(`unreachable: unknown brief variant ${id}`);
  return found;
}

/** Clamp a requested rep count onto the variant's chip options. */
export function clampBriefReps(variant: BriefVariantId, reps: number | undefined): number {
  const spec = briefVariant(variant);
  if (reps === undefined || !spec.repsOptions.includes(reps)) return spec.defaultReps;
  return reps;
}

function pctBand(hrMax: number, pct: readonly [number, number]): HrBand {
  return { floor: Math.round(hrMax * pct[0]), ceiling: Math.round(hrMax * pct[1]) };
}

/**
 * HR target band per run type. Long is the MAF window under the top of zone 2,
 * the same ceiling the coach engine enforces (so manual zones stay in sync);
 * medium and brief are explicit percentages of max HR.
 */
export function hrBandForRunType(id: RunTypeId, profile: RunTypeProfile): HrBand {
  switch (id) {
    case 'long': {
      const [floor, ceiling] = mafWindowFromCeiling(zoneRange(profile.zones, 2)[1]);
      return { floor, ceiling };
    }
    case 'medium':
      return pctBand(profile.hrMax, MEDIUM_HR_PCT);
    case 'brief':
      return pctBand(profile.hrMax, BRIEF_HR_PCT);
  }
}

export function bandLabel(band: HrBand): string {
  return `${band.floor}-${band.ceiling} bpm`;
}

export const RUN_TYPES: readonly RunTypeSpec[] = [
  {
    id: 'long',
    name: 'Long',
    tagline: 'Easy aerobic base',
    effort: 'Conversational, nose only',
    builds: 'Stroke volume, fat burning',
  },
  {
    id: 'medium',
    name: 'Medium',
    tagline: 'Steady, moderately hard',
    effort: 'Breathing hard, not gasping',
    builds: 'Energy and focus for hours',
  },
  {
    id: 'brief',
    name: 'Brief',
    tagline: 'Short, near all-out repeats',
    effort: 'Near all-out on every rep',
    builds: 'VO2 max, max heart rate',
  },
];

export function runTypeSpec(id: RunTypeId): RunTypeSpec {
  const found = RUN_TYPES.find((t) => t.id === id);
  if (!found) throw new Error(`unreachable: unknown run type ${id}`);
  return found;
}

/** Display name for a run type or any persisted (possibly legacy) `runs.type`. */
export function runTypeLabel(type: string): string {
  return runTypeSpec(normalizeLegacyRunType(type)).name;
}

export interface SessionForRunTypeOptions {
  variant?: BriefVariantId;
  reps?: number;
}

export function briefDurationMin(variant: BriefVariantId, reps: number): number {
  const spec = briefVariant(variant);
  return Math.ceil((BRIEF_WARMUP_SEC + reps * (spec.work_sec + spec.rest_sec)) / 60);
}

export function runTypeDurationMin(id: RunTypeId, opts: SessionForRunTypeOptions = {}): number {
  switch (id) {
    case 'long':
      return LONG_DURATION_MIN;
    case 'medium':
      return MEDIUM_WARMUP_SEC / 60 + MEDIUM_WORK_MIN;
    case 'brief': {
      const variant = opts.variant ?? DEFAULT_BRIEF_VARIANT;
      return briefDurationMin(variant, clampBriefReps(variant, opts.reps));
    }
  }
}

export interface RunTypeDetail {
  label: string;
  value: string;
}

/** Everything the picker card shows, derived from the profile and brief choice. */
export interface RunTypeCardContent {
  id: RunTypeId;
  name: string;
  tagline: string;
  /** 2-3 compact stat chips: duration, bpm target, one key cue. */
  chips: readonly string[];
  /** At most 3 labeled rows shown on the selected card. */
  details: readonly RunTypeDetail[];
}

export function runTypeCard(
  id: RunTypeId,
  profile: RunTypeProfile,
  opts: SessionForRunTypeOptions = {}
): RunTypeCardContent {
  const spec = runTypeSpec(id);
  const band = bandLabel(hrBandForRunType(id, profile));
  const duration = `${runTypeDurationMin(id, opts)} min`;
  const base = { id, name: spec.name, tagline: spec.tagline };
  switch (id) {
    case 'long':
      return {
        ...base,
        chips: [duration, band, 'Nose only'],
        details: [
          { label: 'Effort', value: spec.effort },
          { label: 'Target', value: band },
          { label: 'Builds', value: spec.builds },
        ],
      };
    case 'medium':
      return {
        ...base,
        chips: [duration, band, `${MEDIUM_WARMUP_SEC / 60} min warm-up`],
        details: [
          { label: 'Warm-up', value: `${MEDIUM_WARMUP_SEC / 60} min easy` },
          { label: 'Work', value: `${MEDIUM_WORK_MIN} min at ${band}` },
          { label: 'Feel', value: spec.effort },
        ],
      };
    case 'brief': {
      const variantId = opts.variant ?? DEFAULT_BRIEF_VARIANT;
      const variant = briefVariant(variantId);
      const reps = clampBriefReps(variantId, opts.reps);
      return {
        ...base,
        chips: [duration, band, variant.repsChip(reps)],
        details: [
          { label: 'Warm-up', value: `${BRIEF_WARMUP_SEC / 60} min easy` },
          { label: 'Work', value: `${variant.workLabel} ×${reps}` },
          { label: 'Target', value: band },
        ],
      };
    }
  }
}

/** Build the Session the run store and coach engine consume for a run type. */
export function sessionForRunType(
  id: RunTypeId,
  profile: RunTypeProfile,
  opts: SessionForRunTypeOptions = {}
): Session {
  switch (id) {
    case 'long':
      return {
        id: 'long',
        run_type: 'long',
        duration_min: LONG_DURATION_MIN,
        target_zone: 2,
        // Same ceiling the plan's Z2 sessions used after zone normalisation:
        // the top of zone 2 (= MAF ceiling under the Karvonen derivation).
        hr_ceiling: zoneRange(profile.zones, 2)[1],
        notes: 'Long. Zone 2, nose breathing, just barely conversational.',
      };
    case 'medium': {
      const band = hrBandForRunType('medium', profile);
      return {
        id: 'medium',
        run_type: 'medium',
        duration_min: runTypeDurationMin('medium'),
        target_zone: 3,
        hr_floor: band.floor,
        hr_ceiling: band.ceiling,
        warmup_sec: MEDIUM_WARMUP_SEC,
        notes: 'Medium. 5 min easy, then hold 75-85% of max. Breathing hard, not gasping.',
      };
    }
    case 'brief': {
      const variantId = opts.variant ?? DEFAULT_BRIEF_VARIANT;
      const variant = briefVariant(variantId);
      const reps = clampBriefReps(variantId, opts.reps);
      const band = hrBandForRunType('brief', profile);
      const intervals: IntervalBlock = {
        work_sec: variant.work_sec,
        rest_sec: variant.rest_sec,
        reps,
        intensity: 'z5',
        target_hr: band.floor,
        recovery_intensity: 'z1',
      };
      return {
        id: `brief-${variantId}-${reps}`,
        run_type: 'brief',
        duration_min: briefDurationMin(variantId, reps),
        target_zone: 5,
        hr_floor: band.floor,
        hr_ceiling: band.ceiling,
        warmup_sec: BRIEF_WARMUP_SEC,
        intervals,
        notes: `Brief. ${variant.name} ×${reps} at 90-95% of max after a 7 min warm-up.`,
      };
    }
  }
}

/**
 * Map a persisted `runs.type` value (including the pre-0.2 plan types) onto a
 * run type. Unknown strings fall back to 'long', the app's default run.
 */
export function normalizeLegacyRunType(type: string): RunTypeId {
  switch (type) {
    case 'long':
    case 'medium':
    case 'brief':
      return type;
    case 'intervals':
    case 'time_trial':
      return 'brief';
    case 'z2_long':
    case 'z2_short':
    case 'rest':
    case 'lift':
    default:
      return 'long';
  }
}
