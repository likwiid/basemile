// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Proof that the indexed HR/cadence lookups in lib/metrics/terrain.ts return
 * exactly what the original linear scans did (test/perf/legacyTerrain.ts):
 * helper by helper on adversarial synthetic inputs, end to end on random
 * runs, and on every run of a real data fixture when it is present
 * (BASEMILE_PERF_FIXTURE=/path/to/runs.json; skipped cleanly otherwise).
 */
import { describe, expect, it } from 'vitest';

import {
  avgInClosedWindowSorted,
  avgInHalfOpenWindowSorted,
  avgInSpans,
  buildNearestIndex,
  isSortedByTimestamp,
  nearestByTimestamp,
  type TimeSpan,
} from '@/lib/metrics/sampleIndex';
import { computeRunTerrainMetrics, summarizeTerrainForDisplay } from '@/lib/metrics/terrain';
import { avgHrInWindow } from '@/lib/run/distance';
import { mafWindowFromCeiling } from '@/lib/zones';
import type { CadenceSample, GpsPoint, HRSample } from '@/types';

import { loadFixture } from './perf/fixture';
import {
  legacyAvgCadenceInWindow,
  legacyAvgHrForSegments,
  legacyComputeRunTerrainMetrics,
  legacyNearestHr,
  legacySummarizeTerrainForDisplay,
} from './perf/legacyTerrain';

/** Deterministic PRNG (mulberry32) so any failure reproduces from its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function int(rand: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rand() * (hi - lo + 1));
}

function pick<T>(rand: () => number, values: readonly T[]): T {
  return values[Math.floor(rand() * values.length)] as T;
}

function shuffleSome<T>(rand: () => number, values: T[], swaps: number): T[] {
  const out = values.slice();
  for (let k = 0; k < swaps && out.length > 1; k += 1) {
    const i = int(rand, 0, out.length - 1);
    const j = int(rand, 0, out.length - 1);
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

const ODD_TIMESTAMPS = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

/**
 * Timestamps on a coarse grid (so duplicates, exact boundary hits and
 * equidistant ties are common), optionally with non-finite values and
 * optionally out of order.
 */
function randomTimestamps(rand: () => number, n: number, odd: boolean, unsorted: boolean): number[] {
  const ts: number[] = [];
  let t = int(rand, 0, 5) * 500;
  for (let i = 0; i < n; i += 1) {
    t += pick(rand, [0, 0, 500, 1000, 1000, 1000, 1500, 20_000, 40_000]);
    ts.push(t);
  }
  if (odd && n > 0 && rand() < 0.5) ts[int(rand, 0, n - 1)] = pick(rand, ODD_TIMESTAMPS);
  if (!unsorted) return ts;
  return rand() < 0.3 ? ts.reverse() : shuffleSome(rand, ts, int(rand, 1, 4));
}

function randomHr(rand: () => number, timestamps: readonly number[]): HRSample[] {
  // Fractional bpm makes any change in summation order visible.
  return timestamps.map((timestamp) => ({ timestamp, bpm: 120 + rand() * 40 }));
}

function randomQuery(rand: () => number, ts: readonly number[]): number {
  const base = ts.length > 0 ? pick(rand, ts) : 0;
  const roll = rand();
  if (roll < 0.05) return pick(rand, ODD_TIMESTAMPS);
  if (roll < 0.35) return base;
  if (roll < 0.7) return base + pick(rand, [-750, -500, -250, 250, 500, 750]);
  return base + int(rand, -30_000, 30_000);
}

describe('sampleIndex helpers match the linear scans', () => {
  it('nearestByTimestamp picks the same sample (identity) as the legacy nearestHr', () => {
    const rand = rng(1);
    for (let trial = 0; trial < 3000; trial += 1) {
      const n = int(rand, 0, 12);
      const ts = randomTimestamps(rand, n, rand() < 0.3, rand() < 0.4);
      const samples = randomHr(rand, ts);
      const index = buildNearestIndex(samples);
      for (let q = 0; q < 8; q += 1) {
        const query = randomQuery(rand, ts);
        expect(nearestByTimestamp(index, query, 15_000), `trial ${trial} query ${query}`).toBe(
          legacyNearestHr(samples, query)
        );
      }
    }
  });

  it('nearestByTimestamp breaks equidistant ties toward the earlier input sample', () => {
    const a = { timestamp: 1000, bpm: 130 };
    const b = { timestamp: 2000, bpm: 140 };
    const dupA = { timestamp: 1000, bpm: 150 };
    for (const samples of [[a, b], [b, a], [a, dupA, b], [b, dupA, a], [dupA, b, a]]) {
      const got = nearestByTimestamp(buildNearestIndex(samples), 1500, 15_000);
      expect(got).toBe(legacyNearestHr(samples, 1500));
    }
    expect(nearestByTimestamp(buildNearestIndex([]), 1500, 15_000)).toBeNull();
    expect(nearestByTimestamp(buildNearestIndex([a]), 1000 + 15_000, 15_000)).toBe(a);
    expect(nearestByTimestamp(buildNearestIndex([a]), 1000 + 15_001, 15_000)).toBeNull();
  });

  it('avgInSpans matches the legacy per-sample segments.some scan', () => {
    const rand = rng(2);
    for (let trial = 0; trial < 3000; trial += 1) {
      const ts = randomTimestamps(rand, int(rand, 0, 15), rand() < 0.3, rand() < 0.4);
      const samples = randomHr(rand, ts);
      const spans: TimeSpan[] = [];
      const spanCount = int(rand, 0, 8);
      for (let k = 0; k < spanCount; k += 1) {
        const start = randomQuery(rand, ts);
        const roll = rand();
        // Zero-length, touching, overlapping, inverted and NaN spans all occur.
        const end =
          roll < 0.1
            ? start
            : roll < 0.15
              ? start - 500
              : roll < 0.2
                ? Number.NaN
                : start + pick(rand, [500, 1000, 1500, 5000, 30_000]);
        spans.push({ startMs: start, endMs: end });
      }
      if (rand() < 0.3 && spans.length > 0) {
        const last = spans[spans.length - 1] as TimeSpan;
        spans.push({ startMs: last.endMs, endMs: last.endMs + 1000 });
      }
      const legacy = samples.length === 0 || spans.length === 0
        ? null
        : legacyAvgHrForSegments(samples, spans);
      const got = samples.length === 0 || spans.length === 0
        ? null
        : avgInSpans(samples, (s) => s.bpm, spans);
      expect(got, `trial ${trial}`).toBe(legacy);
    }
  });

  it('sorted window averages match avgHrInWindow and the legacy cadence scan', () => {
    const rand = rng(3);
    for (let trial = 0; trial < 3000; trial += 1) {
      const ts = randomTimestamps(rand, int(rand, 0, 15), rand() < 0.3, false);
      if (!isSortedByTimestamp(ts.map((timestamp) => ({ timestamp })))) continue;
      const hr = randomHr(rand, ts);
      const cadence: CadenceSample[] = ts.map((timestamp) => ({ timestamp, spm: 150 + rand() * 30 }));
      for (let q = 0; q < 6; q += 1) {
        const start = randomQuery(rand, ts);
        const end = rand() < 0.1 ? randomQuery(rand, ts) : start + int(rand, 0, 8) * 500;
        expect(avgInHalfOpenWindowSorted(hr, (s) => s.bpm, start, end)).toBe(
          avgHrInWindow(hr, start, end)
        );
        expect(avgInClosedWindowSorted(cadence, (s) => s.spm, start, end)).toBe(
          legacyAvgCadenceInWindow(cadence, start, end)
        );
      }
    }
  });
});

interface SyntheticRun {
  points: GpsPoint[];
  hr: HRSample[];
  cadence: CadenceSample[];
}

function syntheticRun(rand: () => number): SyntheticRun {
  const n = int(rand, 0, 400);
  const points: GpsPoint[] = [];
  let t = 1_700_000_000_000;
  let lon = 0;
  let alt = 100;
  for (let i = 0; i < n; i += 1) {
    t += pick(rand, [1000, 1000, 1000, 1000, 2000, 0, 45_000, -1000]);
    lon += rand() < 0.05 ? 0 : 0.00002 + rand() * 0.00003;
    alt += (rand() - 0.45) * 3;
    const roll = rand();
    points.push({
      timestamp: t,
      latitude: 0,
      longitude: lon,
      altitude: roll < 0.05 ? null : alt,
      groundElevation: roll > 0.7 ? alt + 1.5 : null,
      accuracy: 5,
    });
  }
  const first = points[0]?.timestamp ?? 0;
  const last = points[points.length - 1]?.timestamp ?? first;
  const hr: HRSample[] = [];
  let h = first - int(rand, 0, 3) * 500;
  while (h <= last + 2000 && hr.length < 800) {
    hr.push({ timestamp: h, bpm: 125 + rand() * 30 });
    h += pick(rand, [500, 1000, 1000, 1000, 0, 20_000]);
  }
  const cadence: CadenceSample[] = [];
  for (let c = first; c <= last && cadence.length < 400; c += pick(rand, [1000, 2000, 5000])) {
    cadence.push({ timestamp: c, spm: 160 + rand() * 20 });
  }
  const hrOrder = rand();
  return {
    points,
    hr: hrOrder < 0.15 ? shuffleSome(rand, hr, 5) : hrOrder < 0.2 ? hr.slice().reverse() : hr,
    cadence: rand() < 0.15 ? shuffleSome(rand, cadence, 3) : cadence,
  };
}

describe('terrain outputs are unchanged on synthetic runs', () => {
  it('matches the legacy pipeline on randomized runs', () => {
    const rand = rng(4);
    const windows: [number, number][] = [
      [130, 145],
      [120, 160],
      [0, 0],
    ];
    for (let trial = 0; trial < 300; trial += 1) {
      const { points, hr, cadence } = syntheticRun(rand);
      const maf = pick(rand, windows);
      expect(computeRunTerrainMetrics(points, hr, cadence, maf), `trial ${trial}`).toStrictEqual(
        legacyComputeRunTerrainMetrics(points, hr, cadence, maf)
      );
      expect(summarizeTerrainForDisplay(points, hr), `trial ${trial}`).toStrictEqual(
        legacySummarizeTerrainForDisplay(points, hr)
      );
    }
  });

  it('matches on empty and single-sample edge cases', () => {
    const p = (timestamp: number, longitude: number): GpsPoint => ({
      timestamp,
      latitude: 0,
      longitude,
      altitude: 100,
      accuracy: 5,
    });
    const track = [p(0, 0), p(1000, 0.00003), p(2000, 0.00006), p(3000, 0.0009)];
    const cases: [GpsPoint[], HRSample[], CadenceSample[]][] = [
      [[], [], []],
      [[p(0, 0)], [{ timestamp: 0, bpm: 140 }], []],
      [track, [], []],
      [track, [{ timestamp: 1000, bpm: 140 }], [{ timestamp: 1000, spm: 170 }]],
      [track, [{ timestamp: 500, bpm: 140 }, { timestamp: 500, bpm: 150 }], []],
      [track, [{ timestamp: 1500, bpm: 140 }, { timestamp: 500, bpm: 150 }], []],
    ];
    for (const [points, hr, cadence] of cases) {
      expect(computeRunTerrainMetrics(points, hr, cadence, [130, 150])).toStrictEqual(
        legacyComputeRunTerrainMetrics(points, hr, cadence, [130, 150])
      );
      expect(summarizeTerrainForDisplay(points, hr)).toStrictEqual(
        legacySummarizeTerrainForDisplay(points, hr)
      );
    }
  });
});

const fixture = loadFixture();

describe.skipIf(!fixture)('terrain outputs are unchanged on the real data fixture', () => {
  it('matches the legacy pipeline on every run', () => {
    const { db, profile } = fixture!;
    const runs = db.getAllRuns();
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      const gps = db.getGpsPoints(run.id);
      const hr = db.getHRSamples(run.id);
      const cadence = db.getCadenceSamples(run.id);
      const maf = mafWindowFromCeiling(run.maf_ceiling ?? profile.mafCeiling);
      expect(computeRunTerrainMetrics(gps, hr, cadence, maf), run.id).toStrictEqual(
        legacyComputeRunTerrainMetrics(gps, hr, cadence, maf)
      );
      expect(summarizeTerrainForDisplay(gps, hr), run.id).toStrictEqual(
        legacySummarizeTerrainForDisplay(gps, hr)
      );
      // Out-of-order input exercises the unsorted fallbacks on real data.
      const reversedHr = hr.slice().reverse();
      const reversedCadence = cadence.slice().reverse();
      expect(
        computeRunTerrainMetrics(gps, reversedHr, reversedCadence, maf),
        `${run.id} reversed`
      ).toStrictEqual(legacyComputeRunTerrainMetrics(gps, reversedHr, reversedCadence, maf));
    }
  });
});
