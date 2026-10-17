// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Pre-run state validation. Pure — no db/expo imports (node-testable).
 *
 * Why this exists: `onPress={savePreRunState}` once passed the React Native
 * press event straight through as the "state", and a ~0.5 MB serialized fiber
 * blob (dispatchConfig / _targetInst / nativeEvent / full RCTView config) was
 * persisted into runs.pre_run_json. Every write path now funnels through
 * `sanitizePreRunState`, and a one-time migration purges historical blobs.
 */
import type { PreRunState } from '@/types';

/** Keys that only a React Native synthetic event object carries. */
const EVENT_KEYS = ['nativeEvent', 'dispatchConfig', '_targetInst'] as const;

/** A legitimate PreRunState serializes to a few hundred bytes, never 2 KB. */
export const MAX_PRE_RUN_JSON_BYTES = 2048;

/**
 * Whitelist-validate a candidate pre-run state.
 *
 * Rejects (returns null):
 *  - non-object values (null, arrays, strings, events already stringified);
 *  - anything carrying event-shaped keys (nativeEvent/dispatchConfig/_targetInst);
 *  - payloads serializing above MAX_PRE_RUN_JSON_BYTES (or not serializable
 *    at all — circular fiber references);
 *  - objects missing the numeric core fields the form always sets.
 */
export function sanitizePreRunState(value: unknown): PreRunState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  // Check the event markers BEFORE serializing — a fiber blob is huge and can
  // be circular, so this cheap key test must short-circuit first.
  if (EVENT_KEYS.some((key) => key in record)) return null;

  let serialized: string;
  try {
    serialized = JSON.stringify(record);
  } catch {
    return null; // circular structure — definitely not a PreRunState
  }
  if (!serialized || serialized.length > MAX_PRE_RUN_JSON_BYTES) return null;

  if (
    typeof record.logged_at !== 'number' ||
    typeof record.sleep_hours !== 'number' ||
    typeof record.readiness !== 'number'
  ) {
    return null;
  }
  return value as PreRunState;
}

/**
 * True when a raw pre_run_json column value should be purged: unparseable,
 * or parses to something `sanitizePreRunState` rejects.
 */
export function isPurgeablePreRunJson(raw: string): boolean {
  // Fast path: a legit state is tiny; a fiber blob is hundreds of KB. Skip
  // parsing megabyte strings just to reject them.
  if (raw.length > MAX_PRE_RUN_JSON_BYTES) return true;
  try {
    return sanitizePreRunState(JSON.parse(raw)) === null;
  } catch {
    return true;
  }
}
