// SPDX-License-Identifier: GPL-3.0-or-later

import { memo, useCallback, useMemo, useState } from 'react';
import { LayoutChangeEvent, Text, View } from 'react-native';
import Svg, { Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { CHART_MAX_POINTS, extent, lttb } from '@/lib/charts/downsample';
import { linePath } from '@/lib/charts/series';
import { zoneColor } from '@/lib/zones';
import type { HRSampleRecord, ZoneConfig, ZoneNumber } from '@/types';
import { CHART_COLORS, CHART_EMPTY_CLASS } from './chartColors';

interface HRTimeChartProps {
  samples: HRSampleRecord[];
  zones: ZoneConfig;
  height?: number;
}

const ZONES: readonly ZoneNumber[] = [1, 2, 3, 4, 5];
const PADDING = { top: 8, right: 12, bottom: 24, left: 36 };

function rangeFor(zones: ZoneConfig, zone: ZoneNumber): readonly [number, number] {
  switch (zone) {
    case 1:
      return zones.z1;
    case 2:
      return zones.z2;
    case 3:
      return zones.z3;
    case 4:
      return zones.z4;
    case 5:
      return zones.z5;
  }
}

const sampleTs = (s: HRSampleRecord) => s.timestamp;
const sampleBpm = (s: HRSampleRecord) => s.bpm;

export const HRTimeChart = memo(function HRTimeChart({
  samples,
  zones,
  height = 190,
}: HRTimeChartProps) {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback(
    (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width),
    []
  );

  const innerW = Math.max(0, width - PADDING.left - PADDING.right);
  const innerH = Math.max(0, height - PADDING.top - PADDING.bottom);

  const t0 = samples[0]?.timestamp ?? 0;
  const tEnd = samples[samples.length - 1]?.timestamp ?? t0;
  const tSpan = Math.max(1, tEnd - t0);

  // Axis range from the full trace; only the drawn path is downsampled.
  const [rawMin, rawMax] = useMemo(() => extent(samples, sampleBpm), [samples]);
  const minBpm = rawMin - 5;
  const maxBpm = rawMax + 5;
  const bpmSpan = Math.max(1, maxBpm - minBpm);

  const yFor = (bpm: number) =>
    PADDING.top + innerH - ((bpm - minBpm) / bpmSpan) * innerH;

  const drawn = useMemo(
    () => lttb(samples, CHART_MAX_POINTS, sampleTs, sampleBpm),
    [samples]
  );
  const pathD = useMemo(
    () =>
      linePath(
        drawn,
        (s) => PADDING.left + ((s.timestamp - t0) / tSpan) * innerW,
        (s) => PADDING.top + innerH - ((s.bpm - minBpm) / bpmSpan) * innerH
      ),
    [drawn, t0, tSpan, innerW, innerH, minBpm, bpmSpan]
  );

  if (samples.length < 2) {
    return (
      <View className={CHART_EMPTY_CLASS} style={{ height }}>
        <Text className="text-text-muted text-sm text-center">No HR data</Text>
      </View>
    );
  }

  const totalSec = Math.max(1, Math.round(tSpan / 1000));
  const labelTimes = [0, totalSec * 0.5, totalSec];

  return (
    <View onLayout={onLayout}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          {ZONES.map((zone) => {
            const [lo, hi] = rangeFor(zones, zone);
            if (hi < minBpm || lo > maxBpm) return null;
            const clampedLo = Math.max(lo, minBpm);
            const clampedHi = Math.min(hi, maxBpm);
            const yHi = yFor(clampedHi);
            const yLo = yFor(clampedLo);
            const h = Math.max(0, yLo - yHi);
            if (h <= 0) return null;
            return (
              <Rect
                key={zone}
                x={PADDING.left}
                y={yHi}
                width={innerW}
                height={h}
                fill={zoneColor(zone)}
                opacity={0.12}
              />
            );
          })}
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
          <Path d={pathD} stroke={CHART_COLORS.trace} strokeWidth={1.5} fill="none" />
          {[minBpm, Math.round((minBpm + maxBpm) / 2), maxBpm].map((bpm) => (
            <SvgText
              key={bpm}
              x={PADDING.left - 6}
              y={yFor(bpm) + 4}
              fontSize={10}
              fill={CHART_COLORS.axisText}
              textAnchor="end"
            >
              {Math.round(bpm)}
            </SvgText>
          ))}
          {labelTimes.map((sec, i) => {
            const x = PADDING.left + (sec / totalSec) * innerW;
            const m = Math.floor(sec / 60);
            return (
              <SvgText
                key={i}
                x={x}
                y={height - 6}
                fontSize={10}
                fill={CHART_COLORS.axisText}
                textAnchor="middle"
              >
                {m}m
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
