// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Trimmed, inline copy of OpenFreeMap's "dark" style
 * (https://tiles.openfreemap.org/styles/dark), the default basemap.
 *
 * OpenFreeMap's public instance needs no key, account or registration. The
 * style lives in the app instead of being fetched as a remote style URL, so the
 * background (and the run track drawn on top) still renders with no network.
 * Only the vector tiles and the label glyphs come from tiles.openfreemap.org.
 *
 * Kept: water, parks and woods, buildings, roads and paths, street names and
 * place names. Dropped: the low zoom shaded relief raster, rail, airports,
 * borders, one way arrows and every sprite icon, so no sprite sheet is fetched.
 */
import type {
  FilterSpecification,
  LayerSpecification,
  StyleSpecification,
  SymbolLayerSpecification,
} from '@maplibre/maplibre-react-native';

/** TileJSON for the OpenMapTiles planet vector tiles. */
export const OPENFREEMAP_TILEJSON_URL = 'https://tiles.openfreemap.org/planet';

/** Label font glyphs, served by the same host as the tiles. */
export const OPENFREEMAP_GLYPHS_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

/** Attribution OpenFreeMap asks for (https://openfreemap.org). */
export const OPENFREEMAP_ATTRIBUTION = 'OpenFreeMap © OpenMapTiles © OpenStreetMap contributors';

/** Matches the app's dark surfaces. */
export const MAP_BACKGROUND_COLOR = '#050505';

const SOURCE = 'openmaptiles';
const FONT = ['Noto Sans Regular'];
const MAJOR_ROADS = ['primary', 'secondary', 'tertiary', 'trunk'];

type SymbolLayout = NonNullable<SymbolLayerSpecification['layout']>;
type SymbolPaint = NonNullable<SymbolLayerSpecification['paint']>;

/** Line features of the given `class` values (drops pier and bridge areas). */
function linesOfClass(...classes: string[]): FilterSpecification {
  return [
    'all',
    ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
    ['match', ['get', 'class'], classes, true, false],
  ];
}

/** Place points of the given `class` values. */
function placesOfClass(...classes: string[]): FilterSpecification {
  return [
    'all',
    ['match', ['geometry-type'], ['MultiPoint', 'Point'], true, false],
    ['match', ['get', 'class'], classes, true, false],
  ];
}

const PLACE_LAYOUT: SymbolLayout = {
  'text-field': [
    'case',
    ['has', 'name:nonlatin'],
    ['concat', ['get', 'name:latin'], '\n', ['get', 'name:nonlatin']],
    ['coalesce', ['get', 'name_en'], ['get', 'name']],
  ],
  'text-font': FONT,
  'text-size': 10,
  'text-transform': 'uppercase',
  'text-anchor': 'center',
  'text-justify': 'center',
};

const PLACE_PAINT: SymbolPaint = {
  'text-color': 'rgb(101,101,101)',
  'text-halo-blur': 1,
  'text-halo-color': 'rgba(0,0,0,0.7)',
  'text-halo-width': 1,
};

const layers: LayerSpecification[] = [
  { id: 'background', type: 'background', paint: { 'background-color': MAP_BACKGROUND_COLOR } },
  {
    id: 'water',
    type: 'fill',
    source: SOURCE,
    'source-layer': 'water',
    filter: ['!=', ['get', 'brunnel'], 'tunnel'],
    paint: { 'fill-antialias': false, 'fill-color': 'rgb(27,27,29)' },
  },
  {
    id: 'landcover_wood',
    type: 'fill',
    source: SOURCE,
    'source-layer': 'landcover',
    minzoom: 10,
    filter: ['==', ['get', 'class'], 'wood'],
    paint: {
      'fill-color': 'rgb(32,32,32)',
      'fill-opacity': ['interpolate', ['exponential', 0.3], ['zoom'], 8, 0, 10, 0.8, 13, 0.4],
    },
  },
  {
    id: 'landuse_park',
    type: 'fill',
    source: SOURCE,
    'source-layer': 'landuse',
    filter: ['==', ['get', 'class'], 'park'],
    paint: { 'fill-color': 'rgb(32,32,32)' },
  },
  {
    id: 'waterway',
    type: 'line',
    source: SOURCE,
    'source-layer': 'waterway',
    paint: { 'line-color': 'rgb(27,27,29)' },
  },
  {
    id: 'building',
    type: 'fill',
    source: SOURCE,
    'source-layer': 'building',
    minzoom: 12,
    paint: { 'fill-color': 'rgb(10,10,10)', 'fill-outline-color': 'rgb(27,27,29)' },
  },
  {
    id: 'highway_path',
    type: 'line',
    source: SOURCE,
    'source-layer': 'transportation',
    filter: linesOfClass('path'),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': 'rgb(27,27,29)',
      'line-dasharray': [1.5, 1.5],
      'line-opacity': 0.9,
      'line-width': ['interpolate', ['exponential', 1.2], ['zoom'], 13, 1, 20, 10],
    },
  },
  {
    id: 'highway_minor',
    type: 'line',
    source: SOURCE,
    'source-layer': 'transportation',
    minzoom: 8,
    filter: linesOfClass('minor', 'service', 'track'),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#181818',
      'line-opacity': 0.9,
      'line-width': ['interpolate', ['exponential', 1.55], ['zoom'], 13, 1.8, 20, 20],
    },
  },
  {
    id: 'highway_major_casing',
    type: 'line',
    source: SOURCE,
    'source-layer': 'transportation',
    minzoom: 11,
    filter: linesOfClass(...MAJOR_ROADS),
    layout: { 'line-cap': 'butt', 'line-join': 'miter' },
    paint: {
      'line-color': 'rgba(60,60,60,0.8)',
      'line-width': ['interpolate', ['exponential', 1.3], ['zoom'], 10, 3, 20, 23],
    },
  },
  {
    id: 'highway_major_inner',
    type: 'line',
    source: SOURCE,
    'source-layer': 'transportation',
    minzoom: 11,
    filter: linesOfClass(...MAJOR_ROADS),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': 'hsl(0,0%,7%)',
      'line-width': ['interpolate', ['exponential', 1.3], ['zoom'], 10, 2, 20, 20],
    },
  },
  {
    id: 'highway_major_subtle',
    type: 'line',
    source: SOURCE,
    'source-layer': 'transportation',
    minzoom: 6,
    maxzoom: 11,
    filter: linesOfClass(...MAJOR_ROADS),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#2a2a2a',
      'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0, 8, 2],
    },
  },
  {
    id: 'highway_motorway_casing',
    type: 'line',
    source: SOURCE,
    'source-layer': 'transportation',
    minzoom: 6,
    filter: linesOfClass('motorway'),
    layout: { 'line-cap': 'butt', 'line-join': 'miter' },
    paint: {
      'line-color': 'rgba(60,60,60,0.8)',
      'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 5.8, 0, 6, 3, 20, 40],
    },
  },
  {
    id: 'highway_motorway_inner',
    type: 'line',
    source: SOURCE,
    'source-layer': 'transportation',
    minzoom: 6,
    filter: linesOfClass('motorway'),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#000',
      'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 4, 2, 6, 1.3, 20, 30],
    },
  },
  {
    id: 'highway_name_other',
    type: 'symbol',
    source: SOURCE,
    'source-layer': 'transportation_name',
    filter: [
      'all',
      ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
      ['!=', ['get', 'class'], 'motorway'],
    ],
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 350,
      'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']],
      'text-font': FONT,
      'text-max-angle': 30,
      'text-pitch-alignment': 'viewport',
      'text-rotation-alignment': 'map',
      'text-size': 10,
      'text-transform': 'uppercase',
    },
    paint: {
      'text-color': 'rgba(80,78,78,1)',
      'text-halo-color': 'rgba(0,0,0,1)',
      'text-halo-width': 1,
    },
  },
  {
    id: 'place_other',
    type: 'symbol',
    source: SOURCE,
    'source-layer': 'place',
    maxzoom: 14,
    filter: placesOfClass('hamlet', 'isolated_dwelling', 'neighbourhood'),
    layout: PLACE_LAYOUT,
    paint: PLACE_PAINT,
  },
  {
    id: 'place_suburb_village',
    type: 'symbol',
    source: SOURCE,
    'source-layer': 'place',
    maxzoom: 15,
    filter: placesOfClass('suburb', 'village'),
    layout: PLACE_LAYOUT,
    paint: PLACE_PAINT,
  },
  {
    id: 'place_town_city',
    type: 'symbol',
    source: SOURCE,
    'source-layer': 'place',
    maxzoom: 15,
    filter: placesOfClass('town', 'city'),
    layout: { ...PLACE_LAYOUT, 'text-size': ['case', ['<=', ['get', 'rank'], 3], 14, 10] },
    paint: PLACE_PAINT,
  },
];

/** OpenFreeMap's dark look as an inline style. No key, no sprite. */
export const OPENFREEMAP_DARK_STYLE: StyleSpecification = {
  version: 8,
  glyphs: OPENFREEMAP_GLYPHS_URL,
  sources: {
    [SOURCE]: {
      type: 'vector',
      url: OPENFREEMAP_TILEJSON_URL,
      attribution: OPENFREEMAP_ATTRIBUTION,
    },
  },
  layers,
};
