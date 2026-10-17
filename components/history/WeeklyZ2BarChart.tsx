// SPDX-License-Identifier: GPL-3.0-or-later

import { memo, useState } from 'react';
import { LayoutChangeEvent, Text, View } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';

import { zoneColor } from '@/lib/zones';
import type { WeeklyZ2Point } from '@/types';
import { CHART_COLORS, CHART_EMPTY_CLASS } from './chartColors';

interface WeeklyZ2BarChartProps {
  data: WeeklyZ2Point[];
  targetMinutes?: number;
  height?: number;
}

const PADDING = { top: 16, right: 8, bottom: 24, left: 32 };

export const WeeklyZ2BarChart = memo(function WeeklyZ2BarChart({
  data,
  targetMinutes = 150,
  height = 170,
}: WeeklyZ2BarChartProps) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const lastActive = data.reduce(
    (acc, d) => (d.total_minutes > 0 ? d.weekNumber : acc),
    0
  );
  const cutoff = Math.max(4, lastActive);
  const filtered = data.filter((d) => d.weekNumber <= cutoff);

  if (filtered.length === 0) {
    return (
      <View className={CHART_EMPTY_CLASS} style={{ height }}>
        <Text className="text-text-muted text-sm text-center">No weekly data</Text>
      </View>
    );
  }

  const innerW = Math.max(0, width - PADDING.left - PADDING.right);
  const innerH = Math.max(0, height - PADDING.top - PADDING.bottom);

  const maxVal = Math.max(targetMinutes * 1.2, ...filtered.map((d) => d.z2_minutes));
  const yFor = (v: number) => PADDING.top + innerH - (v / maxVal) * innerH;
  const targetY = yFor(targetMinutes);

  const barW = filtered.length > 0 ? (innerW / filtered.length) * 0.7 : 0;
  const gap = filtered.length > 0 ? (innerW / filtered.length) * 0.3 : 0;
  const xFor = (i: number) => PADDING.left + i * (barW + gap) + gap / 2;

  return (
    <View onLayout={onLayout}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          <Line
            x1={PADDING.left}
            x2={PADDING.left + innerW}
            y1={targetY}
            y2={targetY}
            stroke={zoneColor(2)}
            strokeWidth={1}
            strokeDasharray="4 4"
            opacity={0.6}
          />
          <SvgText
            x={PADDING.left + innerW - 4}
            y={targetY - 4}
            fontSize={9}
            fill={zoneColor(2)}
            textAnchor="end"
          >
            {innerW < 180 ? `${targetMinutes}m` : `${targetMinutes}min target`}
          </SvgText>
          {filtered.map((d, i) => {
            const y = yFor(d.z2_minutes);
            const barH = Math.max(0, PADDING.top + innerH - y);
            const hit = d.z2_minutes >= targetMinutes;
            return (
              <Rect
                key={d.weekStart}
                x={xFor(i)}
                y={y}
                width={barW}
                height={barH}
                fill={zoneColor(2)}
                opacity={hit ? 1 : 0.5}
                rx={2}
              />
            );
          })}
          {filtered.map((d, i) => (
            <SvgText
              key={`l-${d.weekStart}`}
              x={xFor(i) + barW / 2}
              y={height - 8}
              fontSize={9}
              fill={CHART_COLORS.axisText}
              textAnchor="middle"
            >
              W{d.weekNumber}
            </SvgText>
          ))}
          <SvgText
            x={PADDING.left - 4}
            y={yFor(maxVal) + 3}
            fontSize={9}
            fill={CHART_COLORS.axisText}
            textAnchor="end"
          >
            {Math.round(maxVal)}
          </SvgText>
          <SvgText
            x={PADDING.left - 4}
            y={yFor(0) + 3}
            fontSize={9}
            fill={CHART_COLORS.axisText}
            textAnchor="end"
          >
            0
          </SvgText>
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
    </View>
  );
});
