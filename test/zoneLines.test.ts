// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { zoneLineColorExpression, zoneSegmentsCollection } from '@/components/map/zoneLines';
import { zoneColor } from '@/lib/zones';

describe('zoneSegmentsCollection', () => {
  it('emits one LineString per segment tagged with zone and draw order', () => {
    const fc = zoneSegmentsCollection([
      { zone: 2, coordinates: [{ latitude: 1, longitude: 2 }, { latitude: 3, longitude: 4 }] },
      { zone: 3, coordinates: [{ latitude: 3, longitude: 4 }, { latitude: 5, longitude: 6 }] },
      { zone: 2, coordinates: [{ latitude: 5, longitude: 6 }, { latitude: 7, longitude: 8 }] },
    ]);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(3);
    expect(fc.features.map((f) => f.properties)).toEqual([
      { zone: 2, order: 0 },
      { zone: 3, order: 1 },
      { zone: 2, order: 2 },
    ]);
    expect(fc.features[1]!.geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [4, 3],
        [6, 5],
      ],
    });
  });

  it('is empty for no segments', () => {
    expect(zoneSegmentsCollection([]).features).toEqual([]);
  });
});

describe('zoneLineColorExpression', () => {
  it('matches every zone to its colour with a Z2 fallback', () => {
    expect(zoneLineColorExpression()).toEqual([
      'match',
      ['get', 'zone'],
      1,
      zoneColor(1),
      2,
      zoneColor(2),
      3,
      zoneColor(3),
      4,
      zoneColor(4),
      5,
      zoneColor(5),
      zoneColor(2),
    ]);
  });
});
