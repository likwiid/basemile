// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Defers a heavy synchronous task (expo-sqlite sync reads + derivations) until
 * a pushed screen's navigation transition has finished, so the push animation
 * starts from a light placeholder instead of waiting on the JS thread.
 *
 * InteractionManager is deprecated in React Native 0.83, so this listens for
 * the native stack's own `transitionEnd` event, with a timer fallback for
 * navigators that never emit it (deep links, a transition that already
 * ended before the listener attached).
 */

/** The slice of a navigation object this needs. */
export interface TransitionEvents {
  addListener(event: 'transitionEnd', callback: () => void): () => void;
}

/** Native stack pushes take ~350 ms; past this, run regardless. */
export const TRANSITION_FALLBACK_MS = 500;

/**
 * Runs `task` once: on the next macrotask after `transitionEnd` (so the final
 * animation frame commits first) or after `fallbackMs`, whichever comes first.
 * Returns a cancel function; after cancelling, `task` never runs.
 */
export function runAfterTransition(
  events: TransitionEvents | null,
  task: () => void,
  fallbackMs: number = TRANSITION_FALLBACK_MS
): () => void {
  let settled = false;
  let deferTimer: ReturnType<typeof setTimeout> | null = null;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe: (() => void) | undefined;

  const cleanup = () => {
    settled = true;
    if (fallbackTimer !== null) clearTimeout(fallbackTimer);
    if (deferTimer !== null) clearTimeout(deferTimer);
    unsubscribe?.();
  };

  const fire = () => {
    if (settled) return;
    cleanup();
    task();
  };

  fallbackTimer = setTimeout(fire, fallbackMs);
  unsubscribe = events?.addListener('transitionEnd', () => {
    if (settled || deferTimer !== null) return;
    deferTimer = setTimeout(fire, 0);
  });

  return cleanup;
}
