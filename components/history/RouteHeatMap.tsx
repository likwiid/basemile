// SPDX-License-Identifier: GPL-3.0-or-later

import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
} from '@maplibre/maplibre-react-native';
import { memo, useMemo } from 'react';
import { Text, View } from 'react-native';

import { CHART_EMPTY_CLASS } from '@/components/history/chartColors';
import { MAP_STYLE_DARK, boundsForPoints } from '@/components/map/maplibre';
import { mergeExtents, type HeatTrack } from '@/lib/route/heatTracks';
import { zoneColor } from '@/lib/zones';
import type { ZoneNumber } from '@/types';

interface RouteHeatMapProps {
  /** One entry per run with GPS: thinned heat points and a simplified trace. */
  tracks: readonly HeatTrack[];
  height?: number;
}

/**
 * MapLibre map of everywhere you've run: a density heat layer over every
 * run's thinned GPS samples (each weighted by the raw samples it stands for)
 * plus each run's faint trace, on the OpenFreeMap dark basemap.
 */
export const RouteHeatMap = memo(function RouteHeatMap({ tracks, height = 280 }: RouteHeatMapProps) {
  const bounds = useMemo(() => {
    const extent = mergeExtents(tracks);
    return extent
      ? boundsForPoints([
          { latitude: extent.minLat, longitude: extent.minLon },
          { latitude: extent.maxLat, longitude: extent.maxLon },
        ])
      : null;
  }, [tracks]);
  const heat = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(
    () => ({ type: 'FeatureCollection', features: tracks.flatMap((t) => t.heat) }),
    [tracks]
  );
  const lines = useMemo<GeoJSON.FeatureCollection<GeoJSON.LineString>>(
    () => ({ type: 'FeatureCollection', features: tracks.map((t) => t.line) }),
    [tracks]
  );

  if (!bounds || tracks.length === 0) {
    return (
      <View className={CHART_EMPTY_CLASS} style={{ height }}>
        <Text className="text-text-muted text-sm text-center">No route GPS yet</Text>
      </View>
    );
  }

  return (
    <View>
      <View className="rounded-2xl overflow-hidden" style={{ height }}>
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

          <GeoJSONSource id="heat-src" data={heat}>
            <Layer
              type="heatmap"
              id="heat-layer"
              style={{
                heatmapWeight: ['get', 'w'],
                heatmapIntensity: 1,
                heatmapRadius: 16,
                heatmapOpacity: 0.8,
                heatmapColor: [
                  'interpolate',
                  ['linear'],
                  ['heatmap-density'],
                  0,
                  'rgba(0,0,0,0)',
                  0.2,
                  zoneColor(1),
                  0.45,
                  zoneColor(2),
                  0.65,
                  zoneColor(3),
                  0.85,
                  zoneColor(4),
                  1,
                  zoneColor(5),
                ],
              }}
            />
          </GeoJSONSource>

          <GeoJSONSource id="lines-src" data={lines}>
            <Layer
              type="line"
              id="lines-layer"
              style={{
                lineColor: '#e5e5e5',
                lineWidth: 1.5,
                lineOpacity: 0.5,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </GeoJSONSource>
        </Map>
      </View>
      <HeatLegend />
    </View>
  );
});

function HeatLegend() {
  return (
    <View className="mt-2 flex-row items-center" style={{ gap: 8 }}>
      <Text className="text-text-muted text-xs">Less</Text>
      {([1, 2, 3, 4, 5] as ZoneNumber[]).map((zone) => (
        <View
          key={zone}
          className="h-2.5 flex-1 rounded-full"
          style={{ backgroundColor: zoneColor(zone) }}
        />
      ))}
      <Text className="text-text-muted text-xs">More</Text>
    </View>
  );
}
