// SPDX-License-Identifier: GPL-3.0-or-later

import { memo, useState } from 'react';
import { LayoutChangeEvent, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';

import { zoneColor } from '@/lib/zones';
import type { HrvRecord } from '@/types';
import { CHART_COLORS, CHART_EMPTY_CLASS } from './chartColors';

interface HrvTrendChartProps {
  history: HrvRecord[];
  height?: number;
}

const PADDING = { top: 16, right: 12, bottom: 28, left: 40 };
const COLOR_LINE = zoneColor(2);
const COLOR_GRID = CHART_COLORS.grid;
const COLOR_AXIS_TEXT = CHART_COLORS.axisText;
const MIN_READINGS = 5;
const ROLLING_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function formatDateLabel(ms: number): string {
  const d = new Date(ms);
  const month = d.toLocaleString('en-US', { month: 'short' });
  return `${month} ${d.getDate()}`;
}

function rollingMeanAt(sorted: HrvRecord[], idx: number): number | null {
  const point = sorted[idx];
  if (!point) return null;
  const cutoff = point.measured_at - ROLLING_WINDOW_DAYS * DAY_MS;
  let sum = 0;
  let count = 0;
  for (let i = idx; i >= 0; i -= 1) {
    const r = sorted[i];
    if (!r) break;
    if (r.measured_at < cutoff) break;
    sum += r.rmssd_ms;
    count += 1;
  }
  return count === 0 ? null : sum / count;
}

export const HrvTrendChart = memo(function HrvTrendChart({ history, height = 190 }: HrvTrendChartProps) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  if (history.length < MIN_READINGS) {
    return (
      <View className={CHART_EMPTY_CLASS} style={{ height }}>
        <Text className="text-text-muted text-sm text-center px-6">
          Run the HRV test in Settings 5+ times to see trend.
        </Text>
      </View>
    );
  }

  const sorted = [...history].sort((a, b) => a.measured_at - b.measured_at);

  const innerW = Math.max(0, width - PADDING.left - PADDING.right);
  const innerH = Math.max(0, height - PADDING.top - PADDING.bottom);

  const values = sorted.map((p) => p.rmssd_ms);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const pad = Math.max(2, (rawMax - rawMin) * 0.1);
  const min = Math.max(0, Math.floor(rawMin - pad));
  const max = Math.ceil(rawMax + pad);
  const span = Math.max(1, max - min);

  const firstMs = sorted[0]?.measured_at ?? 0;
  const lastMs = sorted[sorted.length - 1]?.measured_at ?? firstMs;
  const tSpan = Math.max(1, lastMs - firstMs);

  const xFor = (ms: number) =>
    sorted.length === 1
      ? PADDING.left + innerW / 2
      : PADDING.left + ((ms - firstMs) / tSpan) * innerW;
  const yFor = (rmssd: number) =>
    PADDING.top + innerH - ((rmssd - min) / span) * innerH;

  const rawPath = sorted
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'} ${xFor(p.measured_at).toFixed(1)} ${yFor(p.rmssd_ms).toFixed(1)}`
    )
    .join(' ');

  const rollingPoints: { x: number; y: number }[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const r = sorted[i];
    if (!r) continue;
    const v = rollingMeanAt(sorted, i);
    if (v === null) continue;
    rollingPoints.push({ x: xFor(r.measured_at), y: yFor(v) });
  }
  const rollingPath = rollingPoints
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');

  const tickCount = 4;
  const ticks: number[] = [];
  for (let i = 0; i <= tickCount; i += 1) {
    ticks.push(min + (span * i) / tickCount);
  }

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

          {rollingPoints.length >= 2 ? (
            <Path
              d={rollingPath}
              stroke={COLOR_LINE}
              strokeWidth={2}
              fill="none"
              opacity={0.35}
            />
          ) : null}

          <Path d={rawPath} stroke={COLOR_LINE} strokeWidth={2} fill="none" />
          {sorted.map((p) => (
            <Circle
              key={`${p.measured_at}`}
              cx={xFor(p.measured_at)}
              cy={yFor(p.rmssd_ms)}
              r={2.5}
              fill={COLOR_LINE}
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
              {Math.round(t)}
            </SvgText>
          ))}

          <SvgText
            x={PADDING.left}
            y={height - 8}
            fontSize={9}
            fill={COLOR_AXIS_TEXT}
            textAnchor="start"
          >
            {formatDateLabel(firstMs)}
          </SvgText>
          <SvgText
            x={PADDING.left + innerW}
            y={height - 8}
            fontSize={9}
            fill={COLOR_AXIS_TEXT}
            textAnchor="end"
          >
            {formatDateLabel(lastMs)}
          </SvgText>
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
    </View>
  );
});
