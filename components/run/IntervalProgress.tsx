// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Card } from '@/components/ui/Card';
import { formatDuration } from '@/lib/time';
import type { IntervalBlock } from '@/types';

interface IntervalProgressProps {
  intervals: IntervalBlock;
  /** Run elapsed in ms (paused-time excluded). */
  runElapsedMs: number;
  /** Warm-up length before rep 1; defaults to the classic 10 min. */
  warmupMs?: number;
}

const DEFAULT_WARMUP_MS = 10 * 60 * 1000;

interface Phase {
  label: string;
  /** Headline under the label: "Easy pace", "Rep 3 of 8" or "Reps done". */
  title: string;
  /** Countdown for the current phase; null once the reps are done. */
  remainingSec: number | null;
  /** 0..1 progress through the *current* phase (work, rest, warmup). */
  phaseProgress: number;
}

function phaseFor(intervals: IntervalBlock, runElapsedMs: number, warmupMs: number): Phase {
  if (runElapsedMs < warmupMs) {
    return {
      label: 'Warm-up',
      title: 'Easy pace',
      remainingSec: Math.ceil((warmupMs - runElapsedMs) / 1000),
      phaseProgress: Math.min(1, Math.max(0, runElapsedMs / warmupMs)),
    };
  }
  const cycleMs = (intervals.work_sec + intervals.rest_sec) * 1000;
  const intoBlock = runElapsedMs - warmupMs;
  const repIdx = Math.floor(intoBlock / cycleMs);
  const intoCycle = intoBlock - repIdx * cycleMs;
  const inWork = intoCycle < intervals.work_sec * 1000;
  // The rest after the final rep is the cool-down (same rule as sessionPhaseAt).
  if (repIdx >= intervals.reps || (repIdx === intervals.reps - 1 && !inWork)) {
    return {
      label: 'Cool down',
      title: 'Reps done',
      remainingSec: null,
      phaseProgress: 1,
    };
  }
  const phaseDurationMs = inWork
    ? intervals.work_sec * 1000
    : intervals.rest_sec * 1000;
  const phaseElapsedMs = inWork
    ? intoCycle
    : intoCycle - intervals.work_sec * 1000;
  const remainingMs = inWork
    ? intervals.work_sec * 1000 - intoCycle
    : cycleMs - intoCycle;
  return {
    label: inWork ? 'Work' : 'Recover',
    title: `Rep ${repIdx + 1} of ${intervals.reps}`,
    remainingSec: Math.ceil(remainingMs / 1000),
    phaseProgress:
      phaseDurationMs > 0
        ? Math.min(1, Math.max(0, phaseElapsedMs / phaseDurationMs))
        : 0,
  };
}

export function IntervalProgress({
  intervals,
  runElapsedMs,
  warmupMs = DEFAULT_WARMUP_MS,
}: IntervalProgressProps) {
  const phase = phaseFor(intervals, runElapsedMs, warmupMs);

  const progress = useSharedValue(phase.phaseProgress);

  useEffect(() => {
    // Smooth out per-tick changes; short timing avoids the stepped look while
    // still keeping the bar in sync with elapsed time.
    progress.value = withTiming(phase.phaseProgress, {
      duration: 300,
      easing: Easing.out(Easing.quad),
    });
  }, [phase.phaseProgress, progress]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${Math.max(0, Math.min(1, progress.value)) * 100}%`,
  }));

  return (
    <Card>
      <View className="flex-row items-center justify-between">
        <View className="flex-1 pr-3">
          <Text className="text-text-muted text-xs uppercase tracking-widest">
            {phase.label}
          </Text>
          <Text className="text-text-primary text-2xl font-bold mt-1">
            {phase.title}
          </Text>
        </View>
        {phase.remainingSec !== null ? (
          <Text className="text-text-primary text-3xl font-mono font-bold">
            {formatDuration(phase.remainingSec)}
          </Text>
        ) : null}
      </View>
      <View className="mt-3 h-1.5 rounded-full bg-bg-elevated overflow-hidden">
        <Animated.View
          className="h-full rounded-full bg-accent"
          style={fillStyle}
        />
      </View>
    </Card>
  );
}
