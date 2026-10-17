// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { classifyHR, zoneColor, zoneRange } from '@/lib/zones';
import type { ZoneConfig, ZoneNumber } from '@/types';

interface ZoneBarProps {
  zones: ZoneConfig;
  bpm: number | null;
}

const ZONE_NUMBERS: readonly ZoneNumber[] = [1, 2, 3, 4, 5];

export function ZoneBar({ zones, bpm }: ZoneBarProps) {
  const min = zones.z1[0];
  const max = zones.z5[1];
  const range = max - min;

  const markerPct =
    bpm !== null && range > 0
      ? Math.min(100, Math.max(0, ((bpm - min) / range) * 100))
      : null;

  const activeZone = bpm !== null ? classifyHR(bpm, zones) : null;

  // Animate marker position.
  const markerLeft = useSharedValue(markerPct ?? 0);
  const markerOpacity = useSharedValue(markerPct === null ? 0 : 1);

  useEffect(() => {
    if (markerPct === null) {
      markerOpacity.value = withTiming(0, { duration: 200 });
      return;
    }
    markerOpacity.value = withTiming(1, { duration: 200 });
    markerLeft.value = withSpring(markerPct, {
      damping: 18,
      stiffness: 140,
      mass: 0.6,
    });
  }, [markerPct, markerLeft, markerOpacity]);

  const markerStyle = useAnimatedStyle(() => ({
    left: `${markerLeft.value}%`,
    opacity: markerOpacity.value,
  }));

  // Pre-compute segment widths.
  const segments = useMemo(() => {
    return ZONE_NUMBERS.map((z) => {
      const r = zoneRange(zones, z);
      const width = ((r[1] - r[0]) / range) * 100;
      return { zone: z, width, color: zoneColor(z) };
    });
  }, [zones, range]);

  return (
    <View className="w-full">
      <View className="h-2.5 flex-row rounded-full overflow-hidden bg-bg-elevated">
        {segments.map(({ zone, width, color }) => {
          const isActive = activeZone === zone;
          return (
            <ZoneSegment
              key={zone}
              width={width}
              color={color}
              isActive={isActive}
            />
          );
        })}
      </View>
      <Animated.View
        className="absolute -top-1 w-1 h-[18px] bg-white rounded-full"
        style={[{ marginLeft: -2, pointerEvents: 'none' }, markerStyle]}
      />
    </View>
  );
}

interface ZoneSegmentProps {
  width: number;
  color: string;
  isActive: boolean;
}

function ZoneSegment({ width, color, isActive }: ZoneSegmentProps) {
  // Active segments get a brighter inner highlight. We fake a gradient with two
  // stacked layers (top half lighter, bottom half base) since we don't have
  // a gradient lib available.
  const glow = useSharedValue(isActive ? 1 : 0);

  useEffect(() => {
    glow.value = withTiming(isActive ? 1 : 0, { duration: 250 });
  }, [isActive, glow]);

  const highlightStyle = useAnimatedStyle(() => ({
    opacity: glow.value * 0.45,
  }));

  return (
    <View style={{ width: `${width}%`, backgroundColor: color }}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '50%',
            backgroundColor: '#ffffff',
            pointerEvents: 'none',
          },
          highlightStyle,
        ]}
      />
    </View>
  );
}
