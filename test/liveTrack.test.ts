// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createThrottle,
  sampleAltitudes,
  simplifyTrack,
} from '@/lib/run/liveTrack';

const M_PER_DEG = 111_320;

/** Point `north`/`east` meters from a fixed origin. */
function at(north: number, east: number) {
  const lat0 = 45;
  return {
    latitude: lat0 + north / M_PER_DEG,
    longitude: 6 + east / (M_PER_DEG * Math.cos((lat0 * Math.PI) / 180)),
  };
}

/** Perpendicular distance (m) from p to segment a-b in the local plane. */
function segDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const cos = Math.cos((45 * Math.PI) / 180);
  const toXY = (q: [number, number]) => [
    (q[0] - 6) * M_PER_DEG * cos,
    (q[1] - 45) * M_PER_DEG,
  ];
  const [px, py] = toXY(p) as [number, number];
  const [ax, ay] = toXY(a) as [number, number];
  const [bx, by] = toXY(b) as [number, number];
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

describe('simplifyTrack', () => {
  it('handles empty, single and two-point tracks', () => {
    expect(simplifyTrack([], 2)).toEqual([]);
    const a = at(0, 0);
    const b = at(10, 0);
    expect(simplifyTrack([a], 2)).toEqual([[a.longitude, a.latitude]]);
    expect(simplifyTrack([a, b], 2)).toEqual([
      [a.longitude, a.latitude],
      [b.longitude, b.latitude],
    ]);
  });

  it('collapses a straight line to its endpoints', () => {
    const pts = Array.from({ length: 500 }, (_, i) => at(i * 3, i * 1));
    const out = simplifyTrack(pts, 2);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual([pts[0]!.longitude, pts[0]!.latitude]);
    expect(out[1]).toEqual([pts[499]!.longitude, pts[499]!.latitude]);
  });

  it('keeps corners and an out-and-back spur', () => {
    const pts = [
      ...Array.from({ length: 50 }, (_, i) => at(i * 4, 0)), // north 196 m
      ...Array.from({ length: 50 }, (_, i) => at(196, (i + 1) * 4)), // east
      ...Array.from({ length: 20 }, (_, i) => at(196 - (i + 1) * 4, 200)), // spur south
      ...Array.from({ length: 20 }, (_, i) => at(196 - 80 + (i + 1) * 4, 200)), // back north
    ];
    const out = simplifyTrack(pts, 2);
    const corner = at(196, 0);
    const spurTip = at(116, 200);
    expect(out).toContainEqual([corner.longitude, corner.latitude]);
    expect(out).toContainEqual([spurTip.longitude, spurTip.latitude]);
    expect(out.length).toBeLessThan(10);
  });

  it('never deviates from the original track by more than the tolerance', () => {
    const pts = Array.from({ length: 3600 }, (_, i) => {
      const t = i / 60;
      return at(i * 2.5 + 40 * Math.sin(t), 30 * Math.cos(t / 2) + 3 * Math.sin(i));
    });
    const tol = 2;
    const out = simplifyTrack(pts, tol);
    expect(out.length).toBeLessThan(pts.length);
    // Every original point lies within tol of the segment spanning it.
    let seg = 0;
    for (const p of pts) {
      const ll: [number, number] = [p.longitude, p.latitude];
      while (
        seg < out.length - 2 &&
        !(out[seg + 1]![0] === ll[0] && out[seg + 1]![1] === ll[1]) &&
        segDist(ll, out[seg]!, out[seg + 1]!) > tol + 1e-6
      ) {
        seg++;
      }
      expect(segDist(ll, out[seg]!, out[seg + 1]!)).toBeLessThanOrEqual(tol + 1e-6);
      if (out[seg + 1]![0] === ll[0] && out[seg + 1]![1] === ll[1]) seg++;
      seg = Math.min(seg, out.length - 2);
    }
  });

  it('returns every point unchanged when tolerance is 0', () => {
    const pts = Array.from({ length: 20 }, (_, i) => at(i, i % 2));
    expect(simplifyTrack(pts, 0)).toHaveLength(20);
  });
});

describe('sampleAltitudes', () => {
  it('drops missing altitudes and returns short tracks unchanged', () => {
    expect(
      sampleAltitudes([{ altitude: 1 }, { altitude: null }, { altitude: NaN }, { altitude: 3 }], 40)
    ).toEqual([1, 3]);
  });

  it('downsamples long tracks and ends on the latest reading', () => {
    const pts = Array.from({ length: 1001 }, (_, i) => ({ altitude: i }));
    const out = sampleAltitudes(pts, 40);
    expect(out.length).toBeLessThanOrEqual(41);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(1000);
  });
});

describe('createThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the first request immediately', () => {
    const fn = vi.fn();
    createThrottle(fn, 3000).request();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('collapses bursts into one trailing run at the interval end', () => {
    const fn = vi.fn();
    const t = createThrottle(fn, 3000);
    t.request(); // t=0 runs
    for (let i = 1; i <= 5; i++) {
      vi.advanceTimersByTime(400);
      t.request();
    }
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(999); // t=2999
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1); // t=3000
    expect(fn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(10_000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('runs at most once per interval under a steady 1 Hz stream', () => {
    const fn = vi.fn();
    const t = createThrottle(fn, 3000);
    for (let s = 0; s < 60; s++) {
      t.request();
      vi.advanceTimersByTime(1000);
    }
    // Runs at 0, 3, ..., 57 s plus the trailing run for the 59 s request.
    expect(fn).toHaveBeenCalledTimes(21);
  });

  it('cancel drops the pending trailing run', () => {
    const fn = vi.fn();
    const t = createThrottle(fn, 3000);
    t.request();
    vi.advanceTimersByTime(100);
    t.request();
    t.cancel();
    vi.advanceTimersByTime(10_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
