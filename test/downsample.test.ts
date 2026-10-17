// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { CHART_MAX_POINTS, extent, lttb } from '@/lib/charts/downsample';
import { linePath } from '@/lib/charts/series';

interface P {
  t: number;
  v: number;
}
const px = (p: P) => p.t;
const py = (p: P) => p.v;

function series(n: number, f: (i: number) => number): P[] {
  return Array.from({ length: n }, (_, i) => ({ t: i * 1000, v: f(i) }));
}

describe('lttb', () => {
  it('returns the input array untouched when already under the threshold', () => {
    const data = series(120, (i) => i);
    expect(lttb(data, CHART_MAX_POINTS, px, py)).toBe(data);
    expect(lttb(data, 120, px, py)).toBe(data);
  });

  it('ignores degenerate thresholds', () => {
    const data = series(50, (i) => i);
    expect(lttb(data, 2, px, py)).toBe(data);
    expect(lttb(data, 0, px, py)).toBe(data);
  });

  it('keeps exactly `threshold` points, first and last included, in order', () => {
    const data = series(2000, (i) => 130 + 10 * Math.sin(i / 40));
    const out = lttb(data, 300, px, py);
    expect(out).toHaveLength(300);
    expect(out[0]).toBe(data[0]);
    expect(out[out.length - 1]).toBe(data[data.length - 1]);
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.t).toBeGreaterThan(out[i - 1]!.t);
    }
    // Only original points are emitted — nothing is interpolated.
    const originals = new Set(data);
    for (const p of out) expect(originals.has(p)).toBe(true);
  });

  it('preserves an isolated spike', () => {
    const data = series(2000, (i) => (i === 1234 ? 190 : 140));
    const out = lttb(data, 300, px, py);
    expect(out.some((p) => p.v === 190)).toBe(true);
  });

  it('does not mutate the input', () => {
    const data = series(1000, (i) => i % 7);
    const copy = data.map((p) => ({ ...p }));
    lttb(data, 100, px, py);
    expect(data).toEqual(copy);
  });
});

describe('extent', () => {
  it('matches Math.min/Math.max over the projection', () => {
    const data = series(5000, (i) => Math.cos(i) * 50 + i / 100);
    const values = data.map(py);
    expect(extent(data, py)).toEqual([Math.min(...values), Math.max(...values)]);
  });

  it('matches the empty and NaN behaviour of Math.min/max', () => {
    expect(extent([] as P[], py)).toEqual([Math.min(), Math.max()]);
    const withNaN = [{ t: 0, v: 1 }, { t: 1, v: Number.NaN }];
    const [lo, hi] = extent(withNaN, py);
    expect(Number.isNaN(lo) && Number.isNaN(hi)).toBe(true);
  });
});

describe('linePath', () => {
  it('uses the M/L one-decimal format of the original chart code', () => {
    const data = [
      { t: 0, v: 1.26 },
      { t: 1.04, v: 2 },
    ];
    expect(linePath(data, px, py)).toBe('M 0.0 1.3 L 1.0 2.0');
    expect(linePath([] as P[], px, py)).toBe('');
  });
});
