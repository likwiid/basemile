// SPDX-License-Identifier: GPL-3.0-or-later

import { memo, useCallback, useMemo, useState } from 'react';
import { LayoutChangeEvent, Text, View } from 'react-native';
import Svg, { Path, Polyline } from 'react-native-svg';

import { CHART_COLORS, CHART_EMPTY_CLASS } from '@/components/history/chartColors';
import { CHART_MAX_POINTS, extent, lttb } from '@/lib/charts/downsample';
import { buildTerrainSeries, linePath, type ChartPoint } from '@/lib/charts/series';
import { zoneColor } from '@/lib/zones';
import type { CadenceSampleRecord, GpsPointRecord, HRSampleRecord } from '@/types';

interface TerrainRunChartProps {
  gps: readonly GpsPointRecord[];
  hr: readonly HRSampleRecord[];
  cadence?: readonly CadenceSampleRecord[];
  height?: number;
}

const PADDING = { top: 12, right: 8, bottom: 12, left: 8 };

const EMPTY_CADENCE: readonly CadenceSampleRecord[] = [];
const pointTs = (p: ChartPoint) => p.timestamp;
const pointValue = (p: ChartPoint) => p.value;

/** Lane path: y range from the full series, geometry from a downsampled copy. */
function lanePath(
  values: readonly ChartPoint[],
  lane: number,
  laneH: number,
  xFor: (timestamp: number) => number,
  invert = false
): string {
  const [min, max] = extent(values, pointValue);
  const span = Math.max(1, max - min);
  return linePath(
    lttb(values, CHART_MAX_POINTS, pointTs, pointValue),
    (point) => xFor(point.timestamp),
    (point) => {
      const normalized = (point.value - min) / span;
      return PADDING.top + lane * laneH + (invert ? normalized : 1 - normalized) * (laneH - 10) + 5;
    }
  );
}

export const TerrainRunChart = memo(function TerrainRunChart({
  gps,
  hr,
  cadence = EMPTY_CADENCE,
  height = 190,
}: TerrainRunChartProps) {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width),
    []
  );
  const series = useMemo(() => buildTerrainSeries(gps, hr, cadence), [gps, hr, cadence]);

  const hasCadence = series.cadence.length >= 2;
  const lanes = hasCadence ? 4 : 3;
  const laneH = (height - PADDING.top - PADDING.bottom) / lanes;
  const paths = useMemo(() => {
    const { startMs, endMs } = series;
    if (startMs === null || endMs === null || series.elevation.length < 2) return null;
    const innerW = Math.max(1, width - PADDING.left - PADDING.right);
    const xFor = (timestamp: number) =>
      PADDING.left + ((timestamp - startMs) / (endMs - startMs)) * innerW;
    return {
      hr: lanePath(series.hr, 0, laneH, xFor),
      elevation: lanePath(series.elevation, 1, laneH, xFor),
      pace: lanePath(series.pace, 2, laneH, xFor, true),
      cadence: hasCadence ? lanePath(series.cadence, 3, laneH, xFor) : null,
    };
  }, [series, width, laneH, hasCadence]);

  if (!paths) {
    return (
      <View className={CHART_EMPTY_CLASS} style={{ height }}>
        <Text className="text-text-muted text-sm text-center">
          Need GPS and HR to draw terrain chart
        </Text>
      </View>
    );
  }

  return (
    <View onLayout={onLayout} className="rounded-2xl bg-bg-card overflow-hidden">
      {width > 0 ? (
        <Svg width={width} height={height}>
          {Array.from({ length: lanes - 1 }, (_, i) => (
            <Polyline
              key={i}
              points={`${PADDING.left},${PADDING.top + laneH * (i + 1)} ${width - PADDING.right},${PADDING.top + laneH * (i + 1)}`}
              stroke={CHART_COLORS.grid}
              strokeWidth={1}
            />
          ))}
          <Path d={paths.hr} stroke={zoneColor(5)} strokeWidth={2} fill="none" />
          <Path d={paths.elevation} stroke={zoneColor(2)} strokeWidth={2} fill="none" />
          <Path d={paths.pace} stroke={zoneColor(3)} strokeWidth={2} fill="none" />
          {paths.cadence !== null ? (
            <Path d={paths.cadence} stroke={zoneColor(4)} strokeWidth={2} fill="none" />
          ) : null}
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
      <View className="absolute left-3 top-2 gap-1">
        <Legend color={zoneColor(5)} label="HR" />
        <Legend color={zoneColor(2)} label="Elev" />
        <Legend color={zoneColor(3)} label="Pace" />
        {hasCadence ? <Legend color={zoneColor(4)} label="Cadence" /> : null}
      </View>
    </View>
  );
});

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View className="flex-row items-center">
      <View className="h-2 w-2 rounded-full mr-1.5" style={{ backgroundColor: color }} />
      <Text className="text-text-muted text-[10px] font-semibold">{label}</Text>
    </View>
  );
}
