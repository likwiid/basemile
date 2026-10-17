// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  isPurgeablePreRunJson,
  MAX_PRE_RUN_JSON_BYTES,
  sanitizePreRunState,
} from '@/lib/run/preRun';
import type { PreRunState } from '@/types';

function validState(): PreRunState {
  return {
    logged_at: 1783343426536,
    sleep_hours: 7.5,
    sleep_quality: 3,
    last_meal_at: null,
    last_meal_what: 'oats',
    hydration: 'two_glasses',
    alcohol_24h: 'none',
    readiness: 7,
    niggles: ['none'],
  };
}

/** Shape of the blob actually found on run-1783692440446 (RN press event). */
function pressEvent(): Record<string, unknown> {
  return {
    dispatchConfig: {
      registrationName: 'onResponderRelease',
      dependencies: ['topTouchCancel', 'topTouchEnd'],
    },
    _targetInst: { tag: 5, key: null },
    nativeEvent: { pageX: 187.4, pageY: 612.9, touches: [] },
    _dispatchListeners: null,
    isDefaultPrevented: null,
  };
}

describe('sanitizePreRunState', () => {
  it('passes a valid form-produced state through unchanged', () => {
    const state = validState();
    expect(sanitizePreRunState(state)).toBe(state);
  });

  it('rejects a React Native press event object', () => {
    expect(sanitizePreRunState(pressEvent())).toBeNull();
  });

  it('rejects each event marker key independently', () => {
    for (const key of ['nativeEvent', 'dispatchConfig', '_targetInst']) {
      expect(sanitizePreRunState({ ...validState(), [key]: {} })).toBeNull();
    }
  });

  it('rejects non-object payloads', () => {
    expect(sanitizePreRunState(null)).toBeNull();
    expect(sanitizePreRunState(undefined)).toBeNull();
    expect(sanitizePreRunState('{"logged_at":1}')).toBeNull();
    expect(sanitizePreRunState([validState()])).toBeNull();
    expect(sanitizePreRunState(42)).toBeNull();
  });

  it('rejects oversized payloads (> 2 KB serialized)', () => {
    const bloated = { ...validState(), last_meal_what: 'x'.repeat(MAX_PRE_RUN_JSON_BYTES) };
    expect(sanitizePreRunState(bloated)).toBeNull();
  });

  it('rejects circular structures instead of throwing', () => {
    const circular: Record<string, unknown> = { ...validState() };
    circular.self = circular;
    expect(sanitizePreRunState(circular)).toBeNull();
  });

  it('rejects objects missing the numeric core fields', () => {
    const { logged_at: _dropped, ...rest } = validState();
    expect(sanitizePreRunState(rest)).toBeNull();
    expect(sanitizePreRunState({ ...validState(), readiness: '7' })).toBeNull();
  });
});

describe('isPurgeablePreRunJson', () => {
  it('keeps a valid serialized state', () => {
    expect(isPurgeablePreRunJson(JSON.stringify(validState()))).toBe(false);
  });

  it('purges a serialized press event', () => {
    expect(isPurgeablePreRunJson(JSON.stringify(pressEvent()))).toBe(true);
  });

  it('purges oversized blobs without parsing them', () => {
    expect(isPurgeablePreRunJson('x'.repeat(600_000))).toBe(true);
  });

  it('purges unparseable JSON', () => {
    expect(isPurgeablePreRunJson('{not json')).toBe(true);
  });
});
