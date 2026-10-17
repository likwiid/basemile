// SPDX-License-Identifier: GPL-3.0-or-later

import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
} from '@maplibre/maplibre-react-native';
import { memo, useMemo } from 'react';
import { Text, View } from 'react-native';

import {
  MAP_STYLE_DARK,
  boundsForPoints,
  lineString,
  toLngLat,
} from '@/components/map/maplibre';
import { zoneLineColorExpression, zoneSegmentsCollection } from '@/components/map/zoneLines';
import { routeNote, routeZoneSegments } from '@/lib/route/intelligence';
import { zoneColor } from '@/lib/zones';
import type { GpsPointRecord, HRSampleRecord, ZoneConfig, ZoneNumber } from '@/types';

interface RunMapProps {
  points: GpsPointRecord[];
  hrSamples?: HRSampleRecord[];
  zones?: ZoneConfig;
  height?: number;
}

const NO_HR: HRSampleRecord[] = [];
const ZONE_LINE_COLOR = zoneLineColorExpression();

export const RunMap = memo(function RunMap({
  points,
  hrSamples = NO_HR,
  zones,
  height = 220,
}: RunMapProps) {
  const bounds = useMemo(() => boundsForPoints(points), [points]);
  const fullRoute = useMemo(() => points.map(toLngLat), [points]);
  const segments = useMemo(
    () => routeZoneSegments(points, hrSamples, zones),
    [hrSamples, points, zones]
  );
  const note = useMemo(() => routeNote(points, hrSamples), [hrSamples, points]);
  // Stable GeoJSON identities: a new `data` object makes MapLibre re-upload
  // the source to native even when the geometry is unchanged. Every zone
  // segment shares one source and one data-driven layer.
  const segmentsShape = useMemo(
    () => (segments.length > 0 ? zoneSegmentsCollection(segments) : null),
    [segments]
  );
  const routeShape = useMemo(() => lineString(fullRoute), [fullRoute]);

  const start = fullRoute[0];
  const end = fullRoute[fullRoute.length - 1];
  const endpoints = useMemo(
    () => (start && end ? endpointFeatures(start, end) : null),
    [start, end]
  );

  if (!bounds || !endpoints) return null;

  return (
    <View>
      <View className="rounded-xl overflow-hidden" style={{ height }}>
        <Map
          style={{ flex: 1 }}
          mapStyle={MAP_STYLE_DARK}
          scaleBar={false}
          logo={false}
          attribution
          touchRotate={false}
          touchPitch={false}
        >
          <Camera bounds={bounds} duration={0} />

          {segmentsShape ? (
            <GeoJSONSource id="zone-segments" data={segmentsShape}>
              <Layer
                type="line"
                id="zone-segment-lines"
                style={{
                  lineColor: ZONE_LINE_COLOR,
                  lineWidth: 4,
                  lineCap: 'round',
                  lineJoin: 'round',
                  lineSortKey: ['get', 'order'],
                }}
              />
            </GeoJSONSource>
          ) : (
            <GeoJSONSource id="route" data={routeShape}>
              <Layer
                type="line"
                id="route-line"
                style={{
                  lineColor: zoneColor(2),
                  lineWidth: 3,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
            </GeoJSONSource>
          )}

          <GeoJSONSource id="endpoints" data={endpoints}>
            <Layer
              type="circle"
              id="endpoint-dots"
              style={{
                circleRadius: 6,
                circleColor: ['get', 'color'],
                circleStrokeWidth: 2,
                circleStrokeColor: '#050505',
              }}
            />
          </GeoJSONSource>
        </Map>
      </View>
      {segments.length > 0 ? <RouteLegend /> : null}
      {note ? (
        <Text className="text-text-secondary text-xs mt-2">{note.label}</Text>
      ) : null}
    </View>
  );
});

function endpointFeatures(
  start: [number, number],
  end: [number, number]
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { color: zoneColor(2) },
        geometry: { type: 'Point', coordinates: start },
      },
      {
        type: 'Feature',
        properties: { color: zoneColor(5) },
        geometry: { type: 'Point', coordinates: end },
      },
    ],
  };
}

function RouteLegend() {
  return (
    <View className="mt-2 flex-row flex-wrap items-center" style={{ gap: 8 }}>
      {([1, 2, 3, 4, 5] as ZoneNumber[]).map((zone) => (
        <View key={zone} className="flex-row items-center">
          <View
            className="h-2.5 w-2.5 rounded-full mr-1"
            style={{ backgroundColor: zoneColor(zone) }}
          />
          <Text className="text-text-secondary text-xs">Z{zone}</Text>
        </View>
      ))}
    </View>
  );
}
