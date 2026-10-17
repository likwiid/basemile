// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runAfterTransition, type TransitionEvents } from '@/lib/run/afterTransition';

function fakeEvents() {
  const listeners = new Set<() => void>();
  const events: TransitionEvents = {
    addListener: (_event, callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
  return { events, emit: () => listeners.forEach((l) => l()), listeners };
}

describe('runAfterTransition', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs one tick after transitionEnd, once, and unsubscribes', () => {
    const { events, emit, listeners } = fakeEvents();
    const task = vi.fn();
    runAfterTransition(events, task, 500);
    expect(task).not.toHaveBeenCalled();
    emit();
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(task).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
    emit();
    vi.advanceTimersByTime(1000);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('falls back to the timer when no transitionEnd arrives', () => {
    const task = vi.fn();
    runAfterTransition(null, task, 500);
    vi.advanceTimersByTime(499);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('never runs after cancel', () => {
    const { events, emit, listeners } = fakeEvents();
    const task = vi.fn();
    const cancel = runAfterTransition(events, task, 500);
    emit();
    cancel();
    vi.advanceTimersByTime(1000);
    expect(task).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });
});
