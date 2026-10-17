// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Spoken-number formatters for coach cues. Pure + unit-testable: numbers read
 * the way a coach says them so they stay unambiguous over wind and footfall.
 */

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function spokenTwoDigit(n: number): string {
  if (n < 20) return ONES[n] ?? `${n}`;
  const tens = TENS[Math.floor(n / 10)] ?? '';
  const ones = n % 10;
  return ones === 0 ? tens : `${tens}-${ONES[ones]}`;
}

/**
 * Heart rate read the way a coach says it: 136 → "one thirty-six", 98 →
 * "ninety-eight", 105 → "one oh five". Digits alone are fine for TTS, but
 * the spoken form is unambiguous over wind and footfall.
 */
export function spokenBpm(bpm: number): string {
  const n = Math.max(0, Math.round(bpm));
  if (n < 100) return spokenTwoDigit(n);
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (rest === 0) return `${ONES[hundreds]} hundred`;
  if (rest < 10) return `${ONES[hundreds]} oh ${ONES[rest]}`;
  return `${ONES[hundreds]} ${spokenTwoDigit(rest)}`;
}

export function spokenPace(secPerKm: number): string {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return 'unknown';
  const total = Math.round(secPerKm); // round total first: never "5 minutes 60"
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ${seconds} per kilometer`;
}

export function spokenKm(meters: number): string {
  if (meters < 100) return 'less than a hundred meters';
  const km = meters / 1000;
  return `${km.toFixed(1)} kilometers`;
}

export function spokenDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes === 0) return `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
  if (seconds === 0) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
}
