// SPDX-License-Identifier: GPL-3.0-or-later

import type { GpsPoint } from '@/types';

/**
 * Display-only helpers for the live run screen. Nothing here feeds distance,
 * pace, splits or any saved metric; they only shrink what the map and the
 * elevation sparkline have to redraw during a 45-75 min run.
 */

export type LngLat = [number, number];

const METERS_PER_DEG_LAT = 111_320;

/**
 * Douglas-Peucker simplification of a GPS track for drawing, returned as
 * [lng, lat] pairs. Uses a local equirectangular projection (accurate to well
 * under a meter over a run-sized area) and an explicit stack, so a 4k-point
 * track is simplified in a single linear-ish pass without recursion.
 *
 * `toleranceM` is the max perpendicular deviation allowed. At the live map's
 * zoom one pixel is ~9 m, so a couple of meters is visually lossless. First
 * and last points are always kept.
 */
export function simplifyTrack(
  points: readonly Pick<GpsPoint, 'latitude' | 'longitude'>[],
  toleranceM: number
): LngLat[] {
  const n = points.length;
  if (n === 0) return [];
  const first = points[0] as Pick<GpsPoint, 'latitude' | 'longitude'>;
  if (n <= 2 || !(toleranceM > 0)) {
    return points.map((p) => [p.longitude, p.latitude]);
  }

  const cosLat = Math.cos((first.latitude * Math.PI) / 180);
  const mx = METERS_PER_DEG_LAT * cosLat;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = points[i] as Pick<GpsPoint, 'latitude' | 'longitude'>;
    xs[i] = (p.longitude - first.longitude) * mx;
    ys[i] = (p.latitude - first.latitude) * METERS_PER_DEG_LAT;
  }

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const tol2 = toleranceM * toleranceM;
  const stack: number[] = [0, n - 1];

  while (stack.length > 0) {
    const end = stack.pop() as number;
    const start = stack.pop() as number;
    if (end - start < 2) continue;

    const ax = xs[start] as number;
    const ay = ys[start] as number;
    const dx = (xs[end] as number) - ax;
    const dy = (ys[end] as number) - ay;
    const len2 = dx * dx + dy * dy;

    let maxD2 = -1;
    let maxIdx = -1;
    for (let i = start + 1; i < end; i++) {
      const px = (xs[i] as number) - ax;
      const py = (ys[i] as number) - ay;
      let d2: number;
      if (len2 === 0) {
        d2 = px * px + py * py;
      } else {
        // Distance to the segment (clamped), so out-and-back spurs survive.
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        const ex = px - t * dx;
        const ey = py - t * dy;
        d2 = ex * ex + ey * ey;
      }
      if (d2 > maxD2) {
        maxD2 = d2;
        maxIdx = i;
      }
    }

    if (maxD2 > tol2 && maxIdx > 0) {
      keep[maxIdx] = 1;
      stack.push(start, maxIdx, maxIdx, end);
    }
  }

  const out: LngLat[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i] === 1) {
      const p = points[i] as Pick<GpsPoint, 'latitude' | 'longitude'>;
      out.push([p.longitude, p.latitude]);
    }
  }
  return out;
}

/**
 * Downsample the track's altitude into at most `maxSamples` finite values,
 * oldest to newest, for the live elevation sparkline. Skips points without a
 * finite altitude and always ends on the most recent reading.
 */
export function sampleAltitudes(
  points: readonly Pick<GpsPoint, 'altitude'>[],
  maxSamples: number
): number[] {
  const alts: number[] = [];
  for (const p of points) {
    if (p.altitude != null && Number.isFinite(p.altitude)) {
      alts.push(p.altitude);
    }
  }
  if (alts.length <= maxSamples) return alts;

  const out: number[] = [];
  const stride = alts.length / maxSamples;
  for (let i = 0; i < maxSamples; i++) {
    const idx = Math.min(alts.length - 1, Math.floor(i * stride));
    const v = alts[idx];
    if (v !== undefined) out.push(v);
  }
  // Always include the most recent reading.
  const last = alts[alts.length - 1];
  if (last !== undefined && out[out.length - 1] !== last) out.push(last);
  return out;
}

export interface Throttle {
  /** Request a run. Runs now if the interval has elapsed, else once at its end. */
  request: () => void;
  /** Drop any pending trailing run. */
  cancel: () => void;
}

/**
 * Leading + trailing throttle: the first request runs immediately, requests
 * inside the interval collapse into a single run at the end of it. The last
 * request is never lost, so a throttled view always converges on the latest
 * data at most `intervalMs` late.
 */
export function createThrottle(
  fn: () => void,
  intervalMs: number,
  now: () => number = Date.now
): Throttle {
  let lastRunAt = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const run = () => {
    timer = null;
    lastRunAt = now();
    fn();
  };

  return {
    request() {
      if (timer !== null) return;
      const wait = lastRunAt + intervalMs - now();
      if (wait <= 0) run();
      else timer = setTimeout(run, wait);
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
