// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState, useSyncExternalStore } from 'react';

import { createThrottle } from '@/lib/run/liveTrack';
import { useActiveRunStore } from '@/lib/run/store';
import type { GpsPoint } from '@/types';

/**
 * Shared 1 Hz clock for the live run screen. One interval drives every
 * subscribed leaf (elapsed time, interval progress, coach panel, Voice Mode)
 * so they all repaint in the same frame instead of the whole screen
 * re-rendering on a top-level forceTick.
 */
let tickValue = 0;
const tickListeners = new Set<() => void>();
let tickTimer: ReturnType<typeof setInterval> | null = null;

function subscribeTick(listener: () => void): () => void {
  tickListeners.add(listener);
  if (tickTimer === null) {
    tickTimer = setInterval(() => {
      tickValue = (tickValue + 1) % 1_000_000;
      for (const l of tickListeners) l();
    }, 1000);
  }
  return () => {
    tickListeners.delete(listener);
    if (tickListeners.size === 0 && tickTimer !== null) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };
}

const noopSubscribe = () => () => {};
const getTick = () => tickValue;

/** Re-render the caller once a second while `enabled`. */
export function useSecondTick(enabled: boolean): number {
  return useSyncExternalStore(enabled ? subscribeTick : noopSubscribe, getTick, getTick);
}

export function computeElapsedSec(
  startedAt: number | null,
  pausedAt: number | null,
  totalPausedMs: number
): number {
  if (startedAt === null) return 0;
  const now = pausedAt ?? Date.now();
  return Math.max(0, Math.floor((now - startedAt - totalPausedMs) / 1000));
}

/** Active (pause-excluded) elapsed seconds, refreshed at 1 Hz while running. */
export function useElapsedSec(): number {
  const status = useActiveRunStore((s) => s.status);
  const startedAt = useActiveRunStore((s) => s.started_at);
  const pausedAt = useActiveRunStore((s) => s.paused_at);
  const totalPausedMs = useActiveRunStore((s) => s.total_paused_ms);
  useSecondTick(status === 'active' || status === 'paused');
  return computeElapsedSec(startedAt, pausedAt, totalPausedMs);
}

export interface ThrottledTrack {
  /** The store's live (append-only) GPS buffer. */
  points: readonly GpsPoint[];
  /** Number of points at the last refresh; use it as a memo key. */
  count: number;
}

/**
 * GPS track view that refreshes at most once per `intervalMs` (leading +
 * trailing, so it always converges on the latest fix). Used by display-only
 * consumers (map, elevation sparkline) that don't need every 1 Hz push.
 */
export function useThrottledTrack(intervalMs: number): ThrottledTrack {
  const [track, setTrack] = useState<ThrottledTrack>(() => {
    const s = useActiveRunStore.getState();
    return { points: s.gps_points, count: s.gps_count };
  });

  useEffect(() => {
    const throttle = createThrottle(() => {
      const s = useActiveRunStore.getState();
      setTrack((prev) =>
        prev.points === s.gps_points && prev.count === s.gps_count
          ? prev
          : { points: s.gps_points, count: s.gps_count }
      );
    }, intervalMs);
    throttle.request();
    const unsubscribe = useActiveRunStore.subscribe((s, prev) => {
      if (s.gps_count !== prev.gps_count || s.gps_points !== prev.gps_points) {
        throttle.request();
      }
    });
    return () => {
      unsubscribe();
      throttle.cancel();
    };
  }, [intervalMs]);

  return track;
}
