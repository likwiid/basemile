// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Pure cadence helpers used by the coach engine. The engine does not own a
 * cadence sensor — the integrator passes the latest spm into `tick` and these
 * helpers translate target-band proximity into spoken nudges.
 *
 * Band rules:
 *   below target - 5  → "push to ${target}"  (rising tone)
 *   above target + 10 → "ease back"          (falling tone)
 *   otherwise         → null (silent)
 *
 * The asymmetric band reflects the running-form heuristic that being slightly
 * over target is fine, but a sharply elevated cadence usually means
 * over-striding compensation and warrants a nudge to relax.
 */

const LOW_BAND = 5;
const HIGH_BAND = 10;

export function cadenceCueText(spm: number, target: number): string | null {
  if (spm < target - LOW_BAND) return `cadence ${spm}, push to ${target}`;
  if (spm > target + HIGH_BAND) return `cadence ${spm}, ease back`;
  return null;
}

export function cadenceTone(
  spm: number,
  target: number
): 'rising' | 'falling' | null {
  if (spm < target - LOW_BAND) return 'rising';
  if (spm > target + HIGH_BAND) return 'falling';
  return null;
}
