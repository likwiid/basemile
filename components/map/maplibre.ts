// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Shared MapLibre setup for the route and live-run maps.
 *
 * Centralizes the dark map style and the GeoJSON helpers so the map components
 * stay declarative. Neither MapLibre nor the default OpenFreeMap tiles need a
 * key or an account. Import {@link MAP_STYLE_DARK} and the helpers and render.
 */
import type { StyleSpecification } from '@maplibre/maplibre-react-native';

import { MAP_BACKGROUND_COLOR, OPENFREEMAP_DARK_STYLE } from '@/components/map/openFreeMapDark';
import type { GpsPoint } from '@/types';

/**
 * Raster `{z}/{x}/{y}` style for an optional tile override, with the
 * attribution the provider requires. The background keeps the dark look under
 * tiles that have not loaded yet.
 */
export function rasterTileStyle(tileUrl: string, attribution: string): StyleSpecification {
  return {
    version: 8,
    sources: {
      'custom-tiles': {
        type: 'raster',
        tiles: [tileUrl],
        tileSize: 256,
        attribution: attribution || '© OpenStreetMap contributors',
        maxzoom: 20,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': MAP_BACKGROUND_COLOR } },
      { id: 'custom-tiles', type: 'raster', source: 'custom-tiles' },
    ],
  };
}

/**
 * Picks the map style: OpenFreeMap's dark vector style by default, or a raster
 * provider when a tile URL override is set. Forks are responsible for the
 * terms of whatever tile provider they use.
 */
export function resolveMapStyle(tileUrl = '', attribution = ''): StyleSpecification {
  const url = tileUrl.trim();
  return url ? rasterTileStyle(url, attribution.trim()) : OPENFREEMAP_DARK_STYLE;
}

/**
 * Dark basemap, kept inline so the background and the run track render with
 * no network. EXPO_PUBLIC_MAP_TILE_URL and EXPO_PUBLIC_MAP_ATTRIBUTION swap in
 * a raster provider at build time.
 */
export const MAP_STYLE_DARK: StyleSpecification = resolveMapStyle(
  process.env.EXPO_PUBLIC_MAP_TILE_URL,
  process.env.EXPO_PUBLIC_MAP_ATTRIBUTION,
);

/** A `[longitude, latitude]` pair — the order MapLibre/GeoJSON expects. */
export type LngLat = [number, number];

/**
 * Bounding box as a flat `[west, south, east, north]` tuple — the format
 * MapLibre's `<Camera bounds={...} />` expects.
 */
export type Bounds = [west: number, south: number, east: number, north: number];

/** Convert a GPS point to a MapLibre `[lng, lat]` position. */
export function toLngLat(point: Pick<GpsPoint, 'latitude' | 'longitude'>): LngLat {
  return [point.longitude, point.latitude];
}

/** Build a GeoJSON LineString feature from an ordered list of positions. */
export function lineString(
  coordinates: LngLat[]
): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates },
  };
}

/** Build a GeoJSON Point feature for a single position. */
export function pointFeature(coordinate: LngLat): GeoJSON.Feature<GeoJSON.Point> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: coordinate },
  };
}

/**
 * Build a GeoJSON FeatureCollection of Points — the source shape a MapLibre
 * `heatmap` layer consumes. Each GPS sample becomes one point; density drives
 * the heat.
 */
export function pointsCollection(
  points: readonly Pick<GpsPoint, 'latitude' | 'longitude'>[]
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [p.longitude, p.latitude] },
    })),
  };
}

/**
 * Flat bounding box `[west, south, east, north]` that contains every point,
 * with a little padding. Returns null for an empty list. Feed the result to
 * `<Camera bounds={...} />` to frame a finished route.
 */
export function boundsForPoints(
  points: Pick<GpsPoint, 'latitude' | 'longitude'>[]
): Bounds | null {
  if (points.length === 0) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const p of points) {
    if (p.latitude < minLat) minLat = p.latitude;
    if (p.latitude > maxLat) maxLat = p.latitude;
    if (p.longitude < minLon) minLon = p.longitude;
    if (p.longitude > maxLon) maxLon = p.longitude;
  }
  // Pad so the polyline isn't flush against the frame edges.
  const padLat = Math.max(0.0015, (maxLat - minLat) * 0.2);
  const padLon = Math.max(0.0015, (maxLon - minLon) * 0.2);
  return [minLon - padLon, minLat - padLat, maxLon + padLon, maxLat + padLat];
}
