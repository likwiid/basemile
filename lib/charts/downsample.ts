// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Render-only downsampling for SVG charts. A 1 Hz HR trace is ~2000 points on
 * a ~330 px wide chart, so several samples land on every pixel; building and
 * rasterising that path on a mid-range Android phone costs frames for no
 * visible gain. Never feed the output into metrics — it is for drawing only.
 */

/** Max points any chart path is drawn with. */
export const CHART_MAX_POINTS = 300;

/**
 * Largest-Triangle-Three-Buckets (Steinarsson 2013). Keeps the first and last
 * point and, per bucket, the point forming the largest triangle with the
 * previously kept point and the next bucket's average — which preserves peaks
 * and troughs far better than a fixed stride.
 *
 * Returns the input array itself when it is already small enough, so callers
 * can rely on referential stability.
 */
export function lttb<T>(
  data: readonly T[],
  threshold: number,
  x: (d: T) => number,
  y: (d: T) => number
): readonly T[] {
  const n = data.length;
  if (threshold >= n || threshold < 3) return data;

  const out: T[] = [data[0] as T];
  const bucketSize = (n - 2) / (threshold - 2);
  let a = 0;

  for (let i = 0; i < threshold - 2; i++) {
    const nextStart = Math.floor((i + 1) * bucketSize) + 1;
    const nextEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, n);
    let avgX = 0;
    let avgY = 0;
    const nextLen = nextEnd - nextStart;
    if (nextLen > 0) {
      for (let j = nextStart; j < nextEnd; j++) {
        const d = data[j] as T;
        avgX += x(d);
        avgY += y(d);
      }
      avgX /= nextLen;
      avgY /= nextLen;
    } else {
      const last = data[n - 1] as T;
      avgX = x(last);
      avgY = y(last);
    }

    const start = Math.floor(i * bucketSize) + 1;
    const end = Math.floor((i + 1) * bucketSize) + 1;
    const pa = data[a] as T;
    const ax = x(pa);
    const ay = y(pa);
    let maxArea = -1;
    let pick = start;
    for (let j = start; j < end; j++) {
      const d = data[j] as T;
      const area = Math.abs((ax - avgX) * (y(d) - ay) - (ax - x(d)) * (avgY - ay));
      if (area > maxArea) {
        maxArea = area;
        pick = j;
      }
    }
    out.push(data[pick] as T);
    a = pick;
  }

  out.push(data[n - 1] as T);
  return out;
}

/**
 * Min and max of a numeric projection. Same result as
 * `Math.min(...data.map(value))` / `Math.max(...)` without the intermediate
 * array or the argument-count limit of spreading.
 */
export function extent<T>(data: readonly T[], value: (d: T) => number): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const d of data) {
    const v = value(d);
    // Math.min/max propagate NaN; mirror that so axis ranges stay identical.
    if (Number.isNaN(v)) return [NaN, NaN];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return [min, max];
}
