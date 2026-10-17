// SPDX-License-Identifier: GPL-3.0-or-later

import type { ZoneConfig, ZoneNumber, ZoneRange } from '@/types';

/**
 * Pure utilities for HR zones. Used by coach engine, run UI, and history.
 * No state, no React.
 */

export function classifyHR(bpm: number, zones: ZoneConfig): ZoneNumber | null {
  if (!Number.isFinite(bpm) || bpm <= 0) return null;
  if (inRange(bpm, zones.z5)) return 5;
  if (inRange(bpm, zones.z4)) return 4;
  // Z2's top IS the MAF ceiling. Sitting exactly on it is the coached target
  // (voice mode says "on target", guardrails only fire ABOVE it, and the bpm
  // counts toward MAF pace) — so the ceiling books as aerobic Z2, not Z3.
  // Z3 is effectively (ceiling, z3Max).
  if (bpm >= zones.z2[0] && bpm <= zones.z2[1]) return 2;
  if (inRange(bpm, zones.z3)) return 3;
  if (inRange(bpm, zones.z1)) return 1;
  // Below Z1
  if (bpm < zones.z1[0]) return 1;
  // Above Z5 max — clamp to Z5
  return 5;
}

function inRange(bpm: number, range: ZoneRange): boolean {
  return bpm >= range[0] && bpm < range[1];
}

export function zoneRange(zones: ZoneConfig, zone: ZoneNumber): ZoneRange {
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

const ZONE_KEYS = ['z1', 'z2', 'z3', 'z4', 'z5'] as const;

/** True when both configs have identical bpm bounds for every zone. */
export function zoneConfigsEqual(a: ZoneConfig, b: ZoneConfig): boolean {
  return ZONE_KEYS.every((key) => a[key][0] === b[key][0] && a[key][1] === b[key][1]);
}

export function zoneLabel(zone: ZoneNumber): string {
  switch (zone) {
    case 1:
      return 'Z1 Recovery';
    case 2:
      return 'Z2 Aerobic';
    case 3:
      return 'Z3 Tempo';
    case 4:
      return 'Z4 Threshold';
    case 5:
      return 'Z5 VO2max';
  }
}

/**
 * Color hex for the zone, matching tailwind config.
 * Kept here so non-styled code (audio, charts) can read it too.
 */
export function zoneColor(zone: ZoneNumber): string {
  switch (zone) {
    case 1:
      return '#3b82f6';
    case 2:
      return '#10b981';
    case 3:
      return '#facc15';
    case 4:
      return '#f97316';
    case 5:
      return '#ef4444';
  }
}

export interface ZoneBoundaryHint {
  current: ZoneNumber;
  next: ZoneNumber;
  bpmUntilNext: number;
  label: string;
}

export function zoneBoundaryHint(
  bpm: number | null,
  zones: ZoneConfig,
  windowBpm = 5
): ZoneBoundaryHint | null {
  if (bpm === null) return null;
  const current = classifyHR(bpm, zones);
  if (current === null || current >= 5) return null;
  const currentRange = zoneRange(zones, current);
  const bpmUntilNext = currentRange[1] - bpm;
  if (bpmUntilNext < 0 || bpmUntilNext > windowBpm) return null;
  const next = (current + 1) as ZoneNumber;
  return {
    current,
    next,
    bpmUntilNext,
    label: `Z${current} → Z${next} soon`,
  };
}

/**
 * Compute zones from Karvonen HR reserve bands.
 *
 * This is the source of truth for the user's training zones. It accounts for a
 * low resting HR and hard-caps the Z2 upper bound at the MAF ceiling.
 *
 * Bands:
 *   Z1 starts at resting HR, Z2 starts at 45.5% HRR, Z2 ends at MAF,
 *   then Z3/Z4/Z5 follow 80/90/100% HRR.
 */
export function computeZonesFromKarvonen(
  hrMax: number,
  hrRest: number,
  mafCeiling: number
): ZoneConfig {
  const reserve = Math.max(1, hrMax - hrRest);
  const pct = (p: number) => Math.round(hrRest + reserve * p);
  const z1Min = hrRest;
  const z2Min = pct(0.455);
  const z3Max = pct(0.8);
  const z4Max = pct(0.9);
  // Keep the MAF ceiling inside the aerobic band so the zone ranges can never
  // invert (e.g. a high MAF ceiling above the tempo bound, or below Z2 start).
  const z2Max = Math.min(Math.max(mafCeiling, z2Min + 1), z3Max - 1);
  return {
    z1: [z1Min, z2Min],
    z2: [z2Min, z2Max],
    z3: [z2Max, z3Max],
    z4: [z3Max, z4Max],
    z5: [z4Max, hrMax],
  };
}

/**
 * MAF ceiling per Maffetone formula: 180 - age - health adjustment.
 * Adjustment guidance:
 *   -10: chronic illness
 *   -5:  beginner / injury recovery / overtrained
 *    0:  consistent training 2+ years, no issues
 *   +5:  experienced competitive athlete
 */
export function computeMafCeiling(age: number, adjustment: number): number {
  // Maffetone: 180 - age, THEN apply the signed category adjustment. A +5
  // "experienced competitive athlete" raises the ceiling; -10 "chronic illness"
  // lowers it. (Previously this subtracted the adjustment, inverting the sign.)
  return 180 - age + adjustment;
}

/**
 * Inverse of {@link computeMafCeiling}: the health adjustment that makes the
 * additive formula reproduce a known ceiling at a given age. Used to keep the
 * stored adjustment and ceiling from contradicting each other — e.g. a +5
 * adjustment with a 149 ceiling at age 26 is inconsistent (it implies 159); the
 * reconciled value is the beginner −5. By construction,
 * `computeMafCeiling(age, mafAdjustmentForCeiling(age, c)) === c`.
 */
export function mafAdjustmentForCeiling(age: number, mafCeiling: number): number {
  return mafCeiling - (180 - age);
}

/**
 * The MAF aerobic-pace window — the top ~5 bpm band ending at the MAF ceiling —
 * so MAF pace/GAP track the athlete's actual ceiling instead of a hardcoded
 * 145-149. Matches [145, 149] at the default 149 ceiling.
 */
export function mafWindowFromCeiling(mafCeiling: number): readonly [number, number] {
  return [mafCeiling - 4, mafCeiling];
}
