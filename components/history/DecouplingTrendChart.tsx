// SPDX-License-Identifier: GPL-3.0-or-later

import { memo, useState } from 'react';
import { LayoutChangeEvent, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';

import { zoneColor } from '@/lib/zones';
import type { DecouplingPoint } from '@/types';
import { CHART_COLORS, CHART_EMPTY_CLASS } from './chartColors';

interface DecouplingTrendChartProps {
  points: DecouplingPoint[];
  height?: number;
}

const PADDING = { top: 16, right: 12, bottom: 28, left: 40 };
const THRESHOLD_PCT = 5;
const COLOR_LINE = zoneColor(2);
const COLOR_THRESHOLD = zoneColor(4);
const COLOR_GRID = CHART_COLORS.grid;
const COLOR_AXIS_TEXT = CHART_COLORS.axisText;

function formatTick(pct: number): string {
  return `${pct >= 0 ? '+' : ''}${Math.round(pct)}%`;
}

function formatDateLabel(ms: number): string {
  const d = new Date(ms);
  const month = d.toLocaleString('en-US', { month: 'short' });
  return `${month} ${d.getDate()}`;
}

export const DecouplingTrendChart = memo(function DecouplingTrendChart({
  points,
  height = 190,
}: DecouplingTrendChartProps) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  if (points.length < 3) {
    return (
      <View className={CHART_EMPTY_CLASS} style={{ height }}>
        <Text className="text-text-muted text-sm text-center">
          Need 3+ long runs to track decoupling
        </Text>
      </View>
    );
  }

  const innerW = Math.max(0, width - PADDING.left - PADDING.right);
  const innerH = Math.max(0, height - PADDING.top - PADDING.bottom);

  const values = points.map((p) => p.decoupling_pct);
  const rawMin = Math.min(...values, 0);
  const rawMax = Math.max(...values, THRESHOLD_PCT + 1);
  const min = Math.floor(rawMin - 1);
  const max = Math.ceil(rawMax + 1);
  const span = Math.max(1, max - min);

  const xFor = (i: number) =>
    points.length === 1
      ? PADDING.left + innerW / 2
      : PADDING.left + (i / (points.length - 1)) * innerW;
  const yFor = (pct: number) =>
    PADDING.top + innerH - ((pct - min) / span) * innerH;

  const pathD = points
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(p.decoupling_pct).toFixed(1)}`
    )
    .join(' ');

  const thresholdY = yFor(THRESHOLD_PCT);
  const zeroY = yFor(0);

  const tickCount = 4;
  const ticks: number[] = [];
  for (let i = 0; i <= tickCount; i++) {
    ticks.push(min + (span * i) / tickCount);
  }

  const labelIndices = new Set<number>();
  labelIndices.add(0);
  labelIndices.add(points.length - 1);
  if (points.length >= 3) labelIndices.add(Math.floor(points.length / 2));

  return (
    <View onLayout={onLayout}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          {ticks.map((t) => (
            <Line
              key={`grid-${t}`}
              x1={PADDING.left}
              x2={PADDING.left + innerW}
              y1={yFor(t)}
              y2={yFor(t)}
              stroke={COLOR_GRID}
              strokeWidth={1}
            />
          ))}

          {min < 0 && max > 0 ? (
            <Line
              x1={PADDING.left}
              x2={PADDING.left + innerW}
              y1={zeroY}
              y2={zeroY}
              stroke={COLOR_AXIS_TEXT}
              strokeWidth={1}
              opacity={0.5}
            />
          ) : null}

          <Line
            x1={PADDING.left}
            x2={PADDING.left + innerW}
            y1={thresholdY}
            y2={thresholdY}
            stroke={COLOR_THRESHOLD}
            strokeWidth={1}
            strokeDasharray="4 4"
            opacity={0.7}
          />
          <SvgText
            x={PADDING.left + innerW - 4}
            y={thresholdY - 4}
            fontSize={9}
            fill={COLOR_THRESHOLD}
            textAnchor="end"
          >
            5% drift
          </SvgText>

          <Path d={pathD} stroke={COLOR_LINE} strokeWidth={2} fill="none" />
          {points.map((p, i) => (
            <Circle
              key={`${p.run_id}-${i}`}
              cx={xFor(i)}
              cy={yFor(p.decoupling_pct)}
              r={3}
              fill={p.decoupling_pct > THRESHOLD_PCT ? COLOR_THRESHOLD : COLOR_LINE}
            />
          ))}

          {ticks.map((t) => (
            <SvgText
              key={`y-${t}`}
              x={PADDING.left - 6}
              y={yFor(t) + 3}
              fontSize={9}
              fill={COLOR_AXIS_TEXT}
              textAnchor="end"
            >
              {formatTick(t)}
            </SvgText>
          ))}

          {Array.from(labelIndices)
            .filter((i) => i >= 0 && i < points.length)
            .map((i) => {
              const p = points[i];
              if (!p) return null;
              return (
                <SvgText
                  key={`x-${i}-${p.run_id}`}
                  x={xFor(i)}
                  y={height - 8}
                  fontSize={9}
                  fill={COLOR_AXIS_TEXT}
                  textAnchor="middle"
                >
                  {formatDateLabel(p.started_at)}
                </SvgText>
              );
            })}
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
    </View>
  );
});
