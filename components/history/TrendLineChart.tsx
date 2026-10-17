// SPDX-License-Identifier: GPL-3.0-or-later

import { memo, useState } from 'react';
import { LayoutChangeEvent, Text, View } from 'react-native';
import Svg, { Circle, Path, Text as SvgText } from 'react-native-svg';

import { CHART_COLORS, CHART_EMPTY_CLASS } from './chartColors';

interface TrendPoint {
  date: string;
  bpm: number;
}

interface TrendLineChartProps {
  data: TrendPoint[];
  color: string;
  height?: number;
  emptyMessage?: string;
  showDots?: boolean;
}

const PADDING = { top: 8, right: 8, bottom: 18, left: 32 };

export const TrendLineChart = memo(function TrendLineChart({
  data,
  color,
  height = 100,
  emptyMessage = 'No data yet',
  showDots = true,
}: TrendLineChartProps) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  if (data.length === 0) {
    return (
      <View className={CHART_EMPTY_CLASS} style={{ height }}>
        <Text className="text-text-muted text-xs text-center">{emptyMessage}</Text>
      </View>
    );
  }

  const innerW = Math.max(0, width - PADDING.left - PADDING.right);
  const innerH = Math.max(0, height - PADDING.top - PADDING.bottom);

  const values = data.map((d) => d.bpm);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  let min: number;
  let max: number;
  if (rawMax - rawMin < 4) {
    const mid = (rawMin + rawMax) / 2;
    min = mid - 2;
    max = mid + 2;
  } else {
    min = rawMin - 2;
    max = rawMax + 2;
  }
  const span = Math.max(1, max - min);

  const xFor = (i: number) =>
    data.length === 1
      ? PADDING.left + innerW / 2
      : PADDING.left + (i / (data.length - 1)) * innerW;
  const yFor = (v: number) => PADDING.top + innerH - ((v - min) / span) * innerH;

  const pathD = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(d.bpm).toFixed(1)}`)
    .join(' ');

  return (
    <View onLayout={onLayout}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          <Path d={pathD} stroke={color} strokeWidth={1.5} fill="none" />
          {showDots
            ? data.map((d, i) => (
                <Circle
                  key={`${d.date}-${i}`}
                  cx={xFor(i)}
                  cy={yFor(d.bpm)}
                  r={2.5}
                  fill={color}
                />
              ))
            : null}
          <SvgText
            x={PADDING.left - 4}
            y={yFor(min) + 3}
            fontSize={9}
            fill={CHART_COLORS.axisText}
            textAnchor="end"
          >
            {Math.round(min)}
          </SvgText>
          <SvgText
            x={PADDING.left - 4}
            y={yFor(max) + 3}
            fontSize={9}
            fill={CHART_COLORS.axisText}
            textAnchor="end"
          >
            {Math.round(max)}
          </SvgText>
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
    </View>
  );
});
