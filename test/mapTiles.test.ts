// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { MAP_STYLE_DARK, resolveMapStyle } from '@/components/map/maplibre';
import { OPENFREEMAP_DARK_STYLE } from '@/components/map/openFreeMapDark';

/** Every URL the style can make MapLibre fetch. */
function styleUrls(style: typeof MAP_STYLE_DARK): string[] {
  const urls: string[] = [];
  if (style.glyphs) urls.push(style.glyphs);
  if (typeof style.sprite === 'string') urls.push(style.sprite);
  for (const source of Object.values(style.sources)) {
    if ('url' in source && source.url) urls.push(source.url);
    if ('tiles' in source && source.tiles) urls.push(...source.tiles);
  }
  return urls;
}

describe('default map style', () => {
  it('is the inline OpenFreeMap dark style when no override is set', () => {
    expect(resolveMapStyle()).toBe(OPENFREEMAP_DARK_STYLE);
    expect(resolveMapStyle('  ', 'ignored')).toBe(OPENFREEMAP_DARK_STYLE);
    expect(MAP_STYLE_DARK).toBe(OPENFREEMAP_DARK_STYLE);
  });

  it('loads everything from tiles.openfreemap.org with no key', () => {
    const urls = styleUrls(OPENFREEMAP_DARK_STYLE);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(new URL(url.replace(/[{}]/g, '')).host).toBe('tiles.openfreemap.org');
      expect(url).not.toMatch(/key|token/i);
    }
  });

  it('needs no sprite sheet', () => {
    expect(OPENFREEMAP_DARK_STYLE.sprite).toBeUndefined();
  });

  it('starts with a dark background layer so it renders offline', () => {
    const [first] = OPENFREEMAP_DARK_STYLE.layers;
    expect(first).toMatchObject({ id: 'background', type: 'background' });
    expect(first?.paint).toEqual({ 'background-color': '#050505' });
  });

  it('credits OpenFreeMap, OpenMapTiles and OpenStreetMap', () => {
    const attribution = Object.values(OPENFREEMAP_DARK_STYLE.sources)
      .map((source) => ('attribution' in source ? source.attribution : ''))
      .join(' ');
    expect(attribution).toContain('OpenFreeMap');
    expect(attribution).toContain('OpenMapTiles');
    expect(attribution).toContain('OpenStreetMap');
  });
});

describe('raster tile override', () => {
  it('replaces the source with the given raster provider', () => {
    const style = resolveMapStyle(' https://tiles.example.com/{z}/{x}/{y}.png ', ' © Example ');
    expect(Object.keys(style.sources)).toEqual(['custom-tiles']);
    expect(style.sources['custom-tiles']).toMatchObject({
      type: 'raster',
      tiles: ['https://tiles.example.com/{z}/{x}/{y}.png'],
      attribution: '© Example',
    });
    expect(style.glyphs).toBeUndefined();
    expect(styleUrls(style).join(' ')).not.toContain('openfreemap');
    expect(style.layers.map((layer) => layer.id)).toEqual(['background', 'custom-tiles']);
  });

  it('falls back to an OpenStreetMap credit when no attribution is given', () => {
    const style = resolveMapStyle('https://tiles.example.com/{z}/{x}/{y}.png');
    expect(style.sources['custom-tiles']).toMatchObject({ attribution: '© OpenStreetMap contributors' });
  });
});
