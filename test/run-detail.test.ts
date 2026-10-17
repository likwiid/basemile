// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  hasAndroidGoogleMapsApiKey,
  normalizeRunId,
  preserveUnchanged,
  shouldRenderRouteMap,
  validRoutePoints,
} from '@/lib/run/detail';
import type { GpsPointRecord } from '@/types';

function gps(overrides: Partial<GpsPointRecord> = {}): GpsPointRecord {
  return {
    run_id: 'run-1',
    timestamp: 1_000,
    latitude: 33.585,
    longitude: -7.627,
    accuracy: 5,
    ...overrides,
  };
}

describe('normalizeRunId', () => {
  it('accepts string and array route params', () => {
    expect(normalizeRunId(' run-1 ')).toBe('run-1');
    expect(normalizeRunId(['run-2'])).toBe('run-2');
    expect(normalizeRunId('')).toBeNull();
    expect(normalizeRunId(undefined)).toBeNull();
  });
});

describe('validRoutePoints', () => {
  it('filters coordinates that can crash native map rendering', () => {
    expect(
      validRoutePoints([
        gps(),
        gps({ latitude: Number.NaN }),
        gps({ latitude: 91 }),
        gps({ longitude: -181 }),
      ])
    ).toEqual([gps()]);
  });
});

describe('hasAndroidGoogleMapsApiKey', () => {
  it('detects whether the Expo Android config has a maps key', () => {
    expect(hasAndroidGoogleMapsApiKey({})).toBe(false);
    expect(
      hasAndroidGoogleMapsApiKey({
        android: { config: { googleMaps: { apiKey: '  ' } } },
      })
    ).toBe(false);
    expect(
      hasAndroidGoogleMapsApiKey({
        android: { config: { googleMaps: { apiKey: 'abc123' } } },
      })
    ).toBe(true);
  });
});

describe('shouldRenderRouteMap', () => {
  it('mounts the Android route map without any maps key (MapLibre needs no token)', () => {
    expect(
      shouldRenderRouteMap({
        platformOS: 'android',
        gpsPointCount: 2,
        hasAndroidGoogleMapsApiKey: false,
      })
    ).toBe(true);
  });

  it('renders on every platform once a track exists', () => {
    expect(
      shouldRenderRouteMap({
        platformOS: 'ios',
        gpsPointCount: 2,
        hasAndroidGoogleMapsApiKey: false,
      })
    ).toBe(true);
    expect(
      shouldRenderRouteMap({
        platformOS: 'android',
        gpsPointCount: 2,
        hasAndroidGoogleMapsApiKey: true,
      })
    ).toBe(true);
  });

  it('requires at least two route points', () => {
    expect(
      shouldRenderRouteMap({
        platformOS: 'ios',
        gpsPointCount: 1,
        hasAndroidGoogleMapsApiKey: true,
      })
    ).toBe(false);
  });
});

describe('preserveUnchanged', () => {
  const prev = { id: 'r', notes: 'a', splits: [{ km: 1 }], context: { surface: 'road' }, gap: null as number | null };

  it('returns next when there is nothing to merge into', () => {
    expect(preserveUnchanged(null, prev)).toBe(prev);
    expect(preserveUnchanged(prev, null)).toBeNull();
  });

  it('returns the previous object when every field is value-equal', () => {
    const next = JSON.parse(JSON.stringify(prev)) as typeof prev;
    expect(preserveUnchanged(prev, next)).toBe(prev);
  });

  it('keeps unchanged nested references and takes changed fields', () => {
    const next = { ...JSON.parse(JSON.stringify(prev)), notes: 'b', gap: 300 } as typeof prev;
    const merged = preserveUnchanged(prev, next)!;
    expect(merged).not.toBe(prev);
    expect(merged).toEqual(next);
    expect(merged.splits).toBe(prev.splits);
    expect(merged.context).toBe(prev.context);
  });

  it('treats an added or removed key as a change', () => {
    const { gap: _gap, ...rest } = prev;
    const merged = preserveUnchanged<Record<string, unknown>>(prev, rest);
    expect(merged).toEqual(rest);
    expect(merged).not.toBe(prev);
  });
});
