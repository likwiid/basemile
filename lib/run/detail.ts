// SPDX-License-Identifier: GPL-3.0-or-later

import type { GpsPointRecord } from '@/types';

type PlatformOS = 'android' | 'ios' | 'web' | 'windows' | 'macos' | 'native';

interface RouteMapOptions {
  platformOS: PlatformOS | string;
  gpsPointCount: number;
  /**
   * Whether the map can render at all. The route map is now a MapLibre renderer
   * backed by OpenFreeMap's free tiles, which need no token or account, so this is
   * trivially true and accepted only for backwards compatibility. Defaults to
   * true.
   */
  hasMap?: boolean;
  /**
   * Legacy react-native-maps / Google Maps gate. Retained for backwards
   * compatibility only — a configured Google key no longer matters for the
   * MapLibre renderer. Ignored by the gating logic.
   */
  hasAndroidGoogleMapsApiKey?: boolean;
}

export function normalizeRunId(id: string | string[] | undefined): string | null {
  const value = Array.isArray(id) ? id[0] : id;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function validRoutePoints(points: GpsPointRecord[]): GpsPointRecord[] {
  return points.filter(
    (point) =>
      Number.isFinite(point.timestamp) &&
      Number.isFinite(point.latitude) &&
      Number.isFinite(point.longitude) &&
      point.latitude >= -90 &&
      point.latitude <= 90 &&
      point.longitude >= -180 &&
      point.longitude <= 180
  );
}

export function hasAndroidGoogleMapsApiKey(expoConfig: unknown): boolean {
  if (!expoConfig || typeof expoConfig !== 'object') return false;
  const android = (expoConfig as { android?: unknown }).android;
  if (!android || typeof android !== 'object') return false;
  const config = (android as { config?: unknown }).config;
  if (!config || typeof config !== 'object') return false;
  const googleMaps = (config as { googleMaps?: unknown }).googleMaps;
  if (!googleMaps || typeof googleMaps !== 'object') return false;
  const apiKey = (googleMaps as { apiKey?: unknown }).apiKey;
  return typeof apiKey === 'string' && apiKey.trim().length > 0;
}

/**
 * Whether to mount the route map for a finished run. The renderer is MapLibre +
 * OpenFreeMap, which needs no token on any platform, so the only real requirement is
 * a usable track (at least two points). The `platformOS` and legacy key/map
 * flags are accepted for backwards compatibility but no longer suppress the map.
 */
export function shouldRenderRouteMap({
  gpsPointCount,
  hasMap = true,
}: RouteMapOptions): boolean {
  if (gpsPointCount < 2) return false;
  return hasMap;
}

/**
 * Merge a freshly re-read record into the previous one, keeping the previous
 * reference for every field whose value did not change (and the previous
 * object when nothing changed). Re-reading a run after a notes save then only
 * invalidates memos keyed on the fields that actually moved, instead of every
 * nested array and object getRun() re-parses from JSON.
 */
export function preserveUnchanged<T extends object>(prev: T | null, next: T | null): T | null {
  if (!prev || !next) return next;
  const merged = { ...next } as Record<string, unknown>;
  const before = prev as Record<string, unknown>;
  let changed = Object.keys(before).length !== Object.keys(merged).length;
  for (const key of Object.keys(merged)) {
    const a = before[key];
    const b = merged[key];
    if (a === b) continue;
    if (
      a !== null &&
      b !== null &&
      typeof a === 'object' &&
      typeof b === 'object' &&
      JSON.stringify(a) === JSON.stringify(b)
    ) {
      merged[key] = a;
      continue;
    }
    changed = true;
  }
  return changed ? (merged as T) : prev;
}
