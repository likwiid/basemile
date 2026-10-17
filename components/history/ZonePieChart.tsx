// SPDX-License-Identifier: GPL-3.0-or-later

import { memo } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { totalZoneSec, zoneSeconds } from '@/lib/metrics/zones';
import { zoneColor } from '@/lib/zones';
import type { ZoneDistribution, ZoneNumber } from '@/types';

interface ZonePieChartProps {
  distribution: ZoneDistribution;
  size?: number;
  strokeWidth?: number;
}

const ZONES: readonly ZoneNumber[] = [1, 2, 3, 4, 5];

function arcPath(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number
): string {
  const start = polar(cx, cy, r, endAngle);
  const end = polar(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return [
    `M ${start.x} ${start.y}`,
    `A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`,
    `L ${cx} ${cy}`,
    'Z',
  ].join(' ');
}

function polar(cx: number, cy: number, r: number, angleRad: number): { x: number; y: number } {
  return {
    x: cx + r * Math.cos(angleRad - Math.PI / 2),
    y: cy + r * Math.sin(angleRad - Math.PI / 2),
  };
}

export const ZonePieChart = memo(function ZonePieChart({ distribution, size = 180, strokeWidth = 0 }: ZonePieChartProps) {
  const total = totalZoneSec(distribution);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - strokeWidth;

  if (total === 0) {
    return (
      <View
        className="items-center justify-center bg-bg-elevated/35 border border-bg-border/60 rounded-full"
        style={{ width: size, height: size }}
      >
        <Text className="text-text-muted text-xs text-center">No HR data</Text>
      </View>
    );
  }

  let cursor = 0;
  const slices: { path: string; color: string; key: ZoneNumber }[] = [];
  for (const zone of ZONES) {
    const sec = zoneSeconds(distribution, zone);
    if (sec <= 0) continue;
    const angle = (sec / total) * Math.PI * 2;
    const start = cursor;
    const end = cursor + angle;
    cursor = end;
    if (angle >= Math.PI * 2 - 1e-6) {
      slices.push({ path: '', color: zoneColor(zone), key: zone });
      continue;
    }
    slices.push({ path: arcPath(cx, cy, r, start, end), color: zoneColor(zone), key: zone });
  }

  const isFullCircle = slices.length === 1 && slices[0]?.path === '';

  return (
    <Svg width={size} height={size}>
      <G>
        {isFullCircle && slices[0] ? (
          <Circle cx={cx} cy={cy} r={r} fill={slices[0].color} />
        ) : (
          slices.map((s) => <Path key={s.key} d={s.path} fill={s.color} />)
        )}
      </G>
    </Svg>
  );
});
