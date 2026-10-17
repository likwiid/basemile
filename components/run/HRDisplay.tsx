// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { zoneColor, zoneLabel } from '@/lib/zones';
import type { ZoneNumber } from '@/types';

interface HRDisplayProps {
  bpm: number | null;
  zone: ZoneNumber | null;
  hint?: string | null;
}

const IDLE_COLOR = '#525252';
const PULSE_MIN_BPM = 30;
const PULSE_MAX_BPM = 220;


export function HRDisplay({ bpm, zone, hint = null }: HRDisplayProps) {
  const targetColor = zone !== null ? zoneColor(zone) : IDLE_COLOR;
  const display = bpm !== null ? String(bpm) : '--';
  const label = zone !== null ? zoneLabel(zone) : 'No HR signal';

  // Crossfade color: animate a 0->1 progress whenever target color changes,
  // but the simpler/safer route is to animate the displayed color directly via
  // withTiming on a shared value holding the color string. Reanimated supports
  // color interpolation in animated style transforms when assigning colors.
  const colorProgress = useSharedValue<string>(targetColor);
  const pulseScale = useSharedValue(1);

  // Crossfade color when zone changes.
  useEffect(() => {
    colorProgress.value = withTiming(targetColor, {
      duration: 350,
      easing: Easing.inOut(Easing.quad),
    });
  }, [targetColor, colorProgress]);

  // Pulse tied to bpm. Cycle = 60_000 / bpm.
  useEffect(() => {
    if (bpm === null || bpm < PULSE_MIN_BPM || bpm > PULSE_MAX_BPM) {
      cancelAnimation(pulseScale);
      pulseScale.value = withTiming(1, { duration: 200 });
      return;
    }
    const cycleMs = Math.max(200, Math.round(60_000 / bpm));
    const half = Math.round(cycleMs / 2);
    cancelAnimation(pulseScale);
    pulseScale.value = 1;
    pulseScale.value = withRepeat(
      withTiming(1.04, { duration: half, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    return () => {
      cancelAnimation(pulseScale);
    };
  }, [bpm, pulseScale]);

  const numberAnimatedStyle = useAnimatedStyle(() => ({
    color: colorProgress.value,
    transform: [{ scale: pulseScale.value }],
  }));

  const labelAnimatedStyle = useAnimatedStyle(() => ({
    color: colorProgress.value,
  }));

  return (
    <View className="items-center justify-center py-1">
      <Animated.Text
        className="font-bold"
        style={[{ fontSize: 104, lineHeight: 110 }, numberAnimatedStyle]}
      >
        {display}
      </Animated.Text>
      <Animated.Text
        className="text-base font-semibold"
        style={labelAnimatedStyle}
      >
        {label}
      </Animated.Text>
      <Text className="text-text-muted text-[11px] uppercase mt-0.5">
        {hint ?? 'bpm'}
      </Text>
    </View>
  );
}
