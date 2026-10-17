// SPDX-License-Identifier: GPL-3.0-or-later

import { memo, useState } from 'react';
import { LayoutChangeEvent, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';

import { zoneColor } from '@/lib/zones';
import { formatPace } from '@/lib/time';
import type { MafDriftPoint } from '@/types';
import { CHART_COLORS, CHART_EMPTY_CLASS } from './chartColors';

interface MafDriftChartProps {
  data: MafDriftPoint[];
  height?: number;
  milestonePace?: number;
  /** X-axis label prefix — 'W' for protocol weeks, 'R' for per-run trends. */
  xLabelPrefix?: string;
}

const PADDING = { top: 16, right: 12, bottom: 28, left: 48 };

export const MafDriftChart = memo(function MafDriftChart({ data, height = 190, milestonePace = 420, xLabelPrefix = 'W' }: MafDriftChartProps) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  if (data.length === 0) {
    return (
      <View className={CHART_EMPTY_CLASS} style={{ height }}>
        <Text className="text-text-muted text-sm text-center">
          Run at MAF to start tracking drift
        </Text>
      </View>
    );
  }

  const innerW = Math.max(0, width - PADDING.left - PADDING.right);
  const innerH = Math.max(0, height - PADDING.top - PADDING.bottom);

  const paces = data.map((d) => d.pace_sec_per_km);
  const minPace = Math.min(...paces, milestonePace) - 20;
  const maxPace = Math.max(...paces, milestonePace) + 20;
  const span = Math.max(1, maxPace - minPace);

  const xFor = (i: number) =>
    data.length === 1
      ? PADDING.left + innerW / 2
      : PADDING.left + (i / (data.length - 1)) * innerW;
  const yFor = (pace: number) =>
    PADDING.top + ((pace - minPace) / span) * innerH;

  const pathD = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(d.pace_sec_per_km).toFixed(1)}`)
    .join(' ');

  const milestoneY = yFor(milestonePace);
  const milestoneCrossing = data.findIndex((d) => d.pace_sec_per_km <= milestonePace);

  return (
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
                stroke={CHART_COLORS.grid}
                strokeWidth={1}
              />
            );
          })}
          <Line
            x1={PADDING.left}
            x2={PADDING.left + innerW}
            y1={milestoneY}
            y2={milestoneY}
            stroke={zoneColor(2)}
            strokeWidth={1}
            strokeDasharray="4 4"
            opacity={0.6}
          />
          <SvgText
            x={PADDING.left + 4}
            y={milestoneY - 4}
            fontSize={9}
            fill={zoneColor(2)}
          >
            {formatPace(milestonePace)}
          </SvgText>

          <Path d={pathD} stroke={zoneColor(2)} strokeWidth={2} fill="none" />
          {data.map((d, i) => (
            <Circle
              key={d.weekStart}
              cx={xFor(i)}
              cy={yFor(d.pace_sec_per_km)}
              r={3}
              fill={zoneColor(2)}
            />
          ))}
          {milestoneCrossing >= 0 ? (
            <Circle
              cx={xFor(milestoneCrossing)}
              cy={yFor(data[milestoneCrossing]?.pace_sec_per_km ?? milestonePace)}
              r={6}
              stroke={CHART_COLORS.trace}
              strokeWidth={1.5}
              fill="none"
            />
          ) : null}

          {[minPace, (minPace + maxPace) / 2, maxPace].map((p) => (
            <SvgText
              key={p}
              x={PADDING.left - 6}
              y={yFor(p) + 4}
              fontSize={9}
              fill={CHART_COLORS.axisText}
              textAnchor="end"
            >
              {formatPace(p)}
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
                return (
                  <SvgText
                    key={`x-${i}-${d.weekStart}`}
                    x={xFor(i)}
                    y={height - 8}
                    fontSize={9}
                    fill={CHART_COLORS.axisText}
                    textAnchor="middle"
                  >
                    {xLabelPrefix}{d.weekNumber}
                  </SvgText>
                );
              });
          })()}
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
    </View>
  );
});
