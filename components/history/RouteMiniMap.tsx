// SPDX-License-Identifier: GPL-3.0-or-later

import { memo, useState } from 'react';
import { LayoutChangeEvent, Text, View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';

import { CHART_EMPTY_CLASS } from '@/components/history/chartColors';
import type { GpsPoint, RouteSummary } from '@/types';

interface RouteMiniMapProps {
  tracks: readonly (readonly GpsPoint[])[];
  routes?: readonly RouteSummary[];
  height?: number;
}

const PADDING = 10;

export const RouteMiniMap = memo(function RouteMiniMap({ tracks, routes = [], height = 220 }: RouteMiniMapProps) {
  const [width, setWidth] = useState(0);
  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
  const nonEmpty = tracks.filter((track) => track.length >= 2);
  if (nonEmpty.length === 0) {
    return (
      <View className={CHART_EMPTY_CLASS} style={{ height }}>
        <Text className="text-text-muted text-sm text-center">No route GPS yet</Text>
      </View>
    );
  }

  const bounds = boundsFor(nonEmpty);
  if (!bounds) {
    return (
      <View className={CHART_EMPTY_CLASS} style={{ height }}>
        <Text className="text-text-muted text-sm text-center">No route GPS yet</Text>
      </View>
    );
  }

  const routeColor = (index: number) => routes[index]?.color ?? '#10b981';

  return (
    <View onLayout={onLayout} className="rounded-2xl overflow-hidden bg-bg-card">
      {width > 0 ? (
        <Svg width={width} height={height}>
          {nonEmpty.map((track, index) => (
            <Polyline
              key={index}
              points={track.map((point) => project(point, bounds, width, height)).join(' ')}
              fill="none"
              stroke={routeColor(index)}
              strokeWidth={Math.max(2, Math.min(7, 2 + index))}
              opacity={routes.length > 0 ? 0.75 : 0.18}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
    </View>
  );
});

function boundsFor(tracks: readonly (readonly GpsPoint[])[]) {
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let minLon = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  for (const track of tracks) {
    for (const point of track) {
      minLat = Math.min(minLat, point.latitude);
      maxLat = Math.max(maxLat, point.latitude);
      minLon = Math.min(minLon, point.longitude);
      maxLon = Math.max(maxLon, point.longitude);
    }
  }
  if (!Number.isFinite(minLat) || !Number.isFinite(minLon)) return null;
  return { minLat, maxLat, minLon, maxLon };
}

function project(
  point: GpsPoint,
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number },
  width: number,
  height: number
): string {
  const lonSpan = Math.max(0.000001, bounds.maxLon - bounds.minLon);
  const latSpan = Math.max(0.000001, bounds.maxLat - bounds.minLat);
  const x = PADDING + ((point.longitude - bounds.minLon) / lonSpan) * (width - PADDING * 2);
  const y =
    PADDING +
    (1 - (point.latitude - bounds.minLat) / latSpan) * (height - PADDING * 2);
  return `${x.toFixed(1)},${y.toFixed(1)}`;
}
