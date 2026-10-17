// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedReaction,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Card } from '@/components/ui/Card';
import { isPlausibleRunningCadence } from '@/lib/sensors/cadence';

interface CadenceDisplayProps {
  spm: number | null;
  target: number;
}

type CadenceState = 'idle' | 'unreliable' | 'low' | 'good' | 'high';

function classify(spm: number | null, target: number): CadenceState {
  if (spm === null) return 'idle';
  if (!isPlausibleRunningCadence(spm)) return 'unreliable';
  if (spm < target - 5) return 'low';
  if (spm > target + 10) return 'high';
  return 'good';
}

function subLabelFor(state: CadenceState, target: number): string {
  switch (state) {
    case 'idle':
      return 'no cadence signal';
    case 'unreliable':
      return 'secure phone in pocket/belt';
    case 'low':
      return `aim ${target}`;
    case 'good':
      return 'good';
    case 'high':
      return 'ease back';
  }
}

const STATE_COLORS: Record<CadenceState, string> = {
  idle: '#525252',
  unreliable: '#f97316',
  low: '#facc15',
  good: '#10b981',
  high: '#facc15',
};

export function CadenceDisplay({ spm, target }: CadenceDisplayProps) {
  const state = classify(spm, target);
  const color = STATE_COLORS[state];

  // Animated count-up. We mirror the shared value into React state so the Text
  // can re-render with rounded integers.
  const animated = useSharedValue<number>(spm ?? 0);
  const [displayValue, setDisplayValue] = useState<number>(spm ?? 0);

  useEffect(() => {
    if (spm === null) return;
    animated.value = withTiming(spm, {
      duration: 450,
      easing: Easing.out(Easing.cubic),
    });
  }, [spm, animated]);

  useAnimatedReaction(
    () => animated.value,
    (current, previous) => {
      const rounded = Math.round(current);
      if (previous === null || Math.round(previous) !== rounded) {
        runOnJS(setDisplayValue)(rounded);
      }
    },
    [],
  );

  const display = state === 'idle' || state === 'unreliable' ? '--' : String(displayValue);

  return (
    <Card>
      <Text className="text-text-muted text-xs uppercase tracking-wider">
        Cadence
      </Text>
      <View className="flex-row items-baseline mt-1">
        <Animated.Text
          className="font-bold tracking-tight"
          style={{ fontSize: 48, lineHeight: 52, color }}
        >
          {display}
        </Animated.Text>
        <Text className="text-text-muted text-sm ml-2">spm</Text>
      </View>
      <Text className="text-sm mt-1" style={{ color }}>
        {subLabelFor(state, target)}
      </Text>
      {state === 'unreliable' ? (
        <Text className="text-text-muted text-xs mt-1">
          Sensor saw {spm} spm, outside believable running range.
        </Text>
      ) : null}
    </Card>
  );
}
