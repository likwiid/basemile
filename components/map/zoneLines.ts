// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * GeoJSON + style helpers for drawing an HR-zone coloured route with ONE
 * MapLibre source and ONE line layer. Each contiguous zone segment becomes a
 * LineString feature tagged with its `zone`; the layer colours features with a
 * data-driven `match` expression instead of mounting a source + layer per
 * segment (hundreds of native layers on a run hovering at a zone boundary).
 */
import { zoneColor } from '@/lib/zones';
import type { ZoneNumber } from '@/types';

import { toLngLat, type LngLat } from './maplibre';

export interface ZoneSegmentInput {
  zone: ZoneNumber;
  coordinates: readonly { latitude: number; longitude: number }[];
}

export interface ZoneLineProperties {
  zone: ZoneNumber;
  /** Original segment index, used as the sort key to keep the old draw order. */
  order: number;
}

const ZONES: readonly ZoneNumber[] = [1, 2, 3, 4, 5];

/** One LineString feature per zone segment, in segment order. */
export function zoneSegmentsCollection(
  segments: readonly ZoneSegmentInput[]
): GeoJSON.FeatureCollection<GeoJSON.LineString, ZoneLineProperties> {
  return {
    type: 'FeatureCollection',
    features: segments.map((segment, order) => ({
      type: 'Feature',
      properties: { zone: segment.zone, order },
      geometry: {
        type: 'LineString',
        coordinates: segment.coordinates.map((c): LngLat => toLngLat(c)),
      },
    })),
  };
}

/**
 * `['match', ['get', 'zone'], 1, c1, 2, c2, ..., fallback]`: the per-feature
 * colour each segment used to get from its own layer's `lineColor`.
 */
export function zoneLineColorExpression(): ['match', ...(string | number | string[])[]] {
  const stops: (string | number)[] = [];
  for (const zone of ZONES) stops.push(zone, zoneColor(zone));
  return ['match', ['get', 'zone'], ...stops, zoneColor(2)];
}
