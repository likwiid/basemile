// SPDX-License-Identifier: GPL-3.0-or-later

import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import { memo, useMemo } from 'react';
import { View } from 'react-native';

import { MAP_STYLE_DARK, lineString } from '@/components/map/maplibre';
import { MAPLIBRE } from '@/config/constants';
import { simplifyTrack } from '@/lib/run/liveTrack';
import { zoneColor } from '@/lib/zones';

import { useThrottledTrack } from './liveRunHooks';

/**
 * The map redraws the route and re-centers at most this often. Every redraw
 * serializes the whole GeoJSON line across the bridge, so doing it on every
 * 1 Hz fix over a 3-4k point run was a steady source of jank.
 */
export const LIVE_MAP_REFRESH_MS = 3000;
/** Douglas-Peucker tolerance for the drawn line; ~1/4 px at the live zoom. */
const LIVE_MAP_TOLERANCE_M = 2;

export interface LiveRunMapProps {
  /**
   * When true, the camera tracks the device's own location (auto-follow)
   * instead of re-centering on the latest GPS point. Defaults to false so the
   * map follows the recorded track even if the OS location puck lags.
   */
  followUser?: boolean;
  /** Map height in px. Defaults to 220. */
  height?: number;
}

/**
 * Live, in-progress run map. Reads the GPS track from the run store itself,
 * throttled to LIVE_MAP_REFRESH_MS, and draws a display-simplified copy of it
 * as a green (Z2) polyline with the latest point centered. The simplified line
 * is display-only; distance and splits always use the full track.
 *
 * MapLibre + OpenFreeMap need no token, so the map always renders.
 */
function LiveRunMapComponent({ followUser = false, height = 220 }: LiveRunMapProps) {
  const { points, count } = useThrottledTrack(LIVE_MAP_REFRESH_MS);
  const route = useMemo(
    () => simplifyTrack(points.slice(0, count), LIVE_MAP_TOLERANCE_M),
    [points, count]
  );
  const latest = route[route.length - 1];
  const geojson = useMemo(() => (route.length >= 2 ? lineString(route) : null), [route]);

  return (
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
        {followUser ? (
          <Camera
            trackUserLocation="default"
            zoom={MAPLIBRE.DEFAULT_ZOOM}
            duration={500}
          />
        ) : (
          <Camera
            center={latest}
            zoom={MAPLIBRE.DEFAULT_ZOOM}
            duration={500}
          />
        )}

        {geojson ? (
          <GeoJSONSource id="live-route" data={geojson}>
            <Layer
              type="line"
              id="live-route-line"
              style={{
                lineColor: zoneColor(2),
                lineWidth: 4,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </GeoJSONSource>
        ) : null}
      </Map>
    </View>
  );
}

export const LiveRunMap = memo(LiveRunMapComponent);
