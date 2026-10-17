// SPDX-License-Identifier: GPL-3.0-or-later

import type { DayOfWeek } from '@/types';

const DAYS: readonly DayOfWeek[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

export function dayOfWeekFromDate(date: Date): DayOfWeek {
  const d = DAYS[date.getDay()];
  if (!d) throw new Error('unreachable: bad day index');
  return d;
}

/** Inclusive day diff between two YYYY-MM-DD strings. */
export function daysBetween(startISO: string, endISO: string): number {
  const start = parseISO(startISO);
  const end = parseISO(endISO);
  const ms = end.getTime() - start.getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

/**
 * Local-calendar day index of an instant relative to an ISO start date.
 * Both sides are normalized to UTC midnight of their LOCAL calendar dates
 * (same convention as protocol/scheduler), so day/week buckets flip at local
 * midnight — not at 00:00 UTC, which shifted every boundary by the UTC offset
 * and could drop an early-morning start-date run out of week 1 entirely.
 */
export function localDayIndex(timestampMs: number, startISO: string): number {
  const startMs = parseISO(startISO).getTime();
  const localMidnight = parseISO(todayISO(new Date(timestampMs))).getTime();
  return Math.floor((localMidnight - startMs) / (24 * 60 * 60 * 1000));
}

export function parseISO(iso: string): Date {
  // Force UTC interpretation of YYYY-MM-DD so timezones don't shift the day.
  const parts = iso.split('-').map(Number);
  const [y, m, d] = parts;
  if (y === undefined || m === undefined || d === undefined) {
    throw new Error(`Invalid ISO date: ${iso}`);
  }
  return new Date(Date.UTC(y, m - 1, d));
}

export function toISODate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayISO(now: Date = new Date()): string {
  // Use local date — when the user opens the app at 11pm Saturday, that's
  // still "today" from their perspective.
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function formatPace(sec_per_km: number): string {
  if (!Number.isFinite(sec_per_km) || sec_per_km <= 0) return '--:--';
  // Round the TOTAL seconds first, then split — floor(min) + round(sec)
  // rendered 359.7 as "5:60/km" instead of "6:00/km".
  const total = Math.round(sec_per_km);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}/km`;
}

export function formatDistance(meters: number): string {
  const km = meters / 1000;
  return `${km.toFixed(2)} km`;
}
