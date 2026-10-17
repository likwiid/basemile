// SPDX-License-Identifier: GPL-3.0-or-later

import { memo, useState } from 'react';
import { LayoutChangeEvent, Text, View } from 'react-native';
import Svg, { Line, Path, Text as SvgText } from 'react-native-svg';

import { zoneColor } from '@/lib/zones';
import type { TrainingLoadPoint } from '@/types';
import { CHART_COLORS, CHART_EMPTY_CLASS } from './chartColors';

interface LoadChartProps {
  data: TrainingLoadPoint[];
  height?: number;
}

const PADDING = { top: 16, right: 12, bottom: 28, left: 36 };

// CTL/ATL/TSB are conventionally colored by load semantics rather than HR
// zones, but we reuse the zone palette here so they stay aligned with the
// rest of the design tokens.
const CTL_COLOR = zoneColor(2); // green — fitness
const ATL_COLOR = zoneColor(4); // orange — fatigue
const TSB_COLOR = zoneColor(1); // blue — freshness
const ZERO_LINE_COLOR = CHART_COLORS.axisText;
const GRID_COLOR = CHART_COLORS.grid;

function buildPath(
  data: TrainingLoadPoint[],
  pick: (p: TrainingLoadPoint) => number,
  xFor: (i: number) => number,
  yFor: (v: number) => number
): string {
  return data
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(pick(p)).toFixed(1)}`
    )
    .join(' ');
}

export const LoadChart = memo(function LoadChart({ data, height = 190 }: LoadChartProps) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  if (data.length < 2) {
    return (
      <View className={CHART_EMPTY_CLASS} style={{ height }}>
        <Text className="text-text-muted text-sm text-center">
          Not enough run data yet for fitness trend
        </Text>
      </View>
    );
  }

  const innerW = Math.max(0, width - PADDING.left - PADDING.right);
  const innerH = Math.max(0, height - PADDING.top - PADDING.bottom);

  let minVal = 0;
  let maxVal = 0;
  for (const p of data) {
    if (p.ctl > maxVal) maxVal = p.ctl;
    if (p.atl > maxVal) maxVal = p.atl;
    if (p.tsb > maxVal) maxVal = p.tsb;
    if (p.ctl < minVal) minVal = p.ctl;
    if (p.atl < minVal) minVal = p.atl;
    if (p.tsb < minVal) minVal = p.tsb;
  }
  // Pad the range a touch so lines never touch the frame.
  const pad = Math.max(2, (maxVal - minVal) * 0.1);
  const yMin = minVal - pad;
  const yMax = maxVal + pad;
  const span = Math.max(1, yMax - yMin);

  const xFor = (i: number) =>
    data.length === 1
      ? PADDING.left + innerW / 2
      : PADDING.left + (i / (data.length - 1)) * innerW;
  // SVG y grows downward, but higher TRIMP should sit higher on the chart.
  const yFor = (v: number) =>
    PADDING.top + innerH - ((v - yMin) / span) * innerH;

  const ctlPath = buildPath(data, (p) => p.ctl, xFor, yFor);
  const atlPath = buildPath(data, (p) => p.atl, xFor, yFor);
  const tsbPath = buildPath(data, (p) => p.tsb, xFor, yFor);

  const zeroY = yFor(0);
  const midVal = (yMin + yMax) / 2;

  return (
    <View>
      <View onLayout={onLayout}>
        {width > 0 ? (
          <Svg width={width} height={height}>
            {[0.25, 0.5, 0.75].map((p) => {
              const y = PADDING.top + innerH * p;
              return (
                <Line
                  key={p}
                  x1={PADDING.left}
                  x2={PADDING.left + innerW}
                  y1={y}
                  y2={y}
                  stroke={GRID_COLOR}
                  strokeWidth={1}
                />
              );
            })}

            {zeroY >= PADDING.top && zeroY <= PADDING.top + innerH ? (
              <Line
                x1={PADDING.left}
                x2={PADDING.left + innerW}
                y1={zeroY}
                y2={zeroY}
                stroke={ZERO_LINE_COLOR}
                strokeWidth={1}
                strokeDasharray="4 4"
                opacity={0.6}
              />
            ) : null}

            <Path d={ctlPath} stroke={CTL_COLOR} strokeWidth={2} fill="none" />
            <Path d={atlPath} stroke={ATL_COLOR} strokeWidth={2} fill="none" />
            <Path d={tsbPath} stroke={TSB_COLOR} strokeWidth={2} fill="none" />

            {[yMax, midVal, yMin].map((v) => (
              <SvgText
                key={v}
                x={PADDING.left - 6}
                y={yFor(v) + 4}
                fontSize={9}
                fill={CHART_COLORS.axisText}
                textAnchor="end"
              >
                {Math.round(v)}
              </SvgText>
            ))}

            {(() => {
              const indices = new Set<number>();
              indices.add(0);
              indices.add(data.length - 1);
              indices.add(Math.floor(data.length / 2));
              return Array.from(indices)
                .filter((i) => i >= 0 && i < data.length)
                .map((i) => {
                  const d = data[i];
                  if (!d) return null;
                  const slice = d.date.slice(5);
                  return (
                    <SvgText
                      key={`x-${i}-${d.date}`}
                      x={xFor(i)}
                      y={height - 8}
                      fontSize={9}
                      fill={CHART_COLORS.axisText}
                      textAnchor="middle"
                    >
                      {slice}
                    </SvgText>
                  );
                });
            })()}
          </Svg>
        ) : (
          <View style={{ height }} />
        )}
      </View>
      <View className="flex-row mt-2 px-1">
        <LegendDot color={CTL_COLOR} label="CTL" />
        <LegendDot color={ATL_COLOR} label="ATL" />
        <LegendDot color={TSB_COLOR} label="TSB" />
      </View>
    </View>
  );
});

interface LegendDotProps {
  color: string;
  label: string;
}

function LegendDot({ color, label }: LegendDotProps) {
  return (
    <View className="flex-row items-center mr-4">
      <View
        className="w-2 h-2 rounded-full mr-1.5"
        style={{ backgroundColor: color }}
      />
      <Text className="text-text-secondary text-xs">{label}</Text>
    </View>
  );
}
