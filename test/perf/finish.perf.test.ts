// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Micro-benchmark of the Finish / Save path on the longest real run.
 * Skipped unless PERF=1 and the data fixture exists:
 *
 *   PERF=1 npx vitest run test/perf/finish.perf.test.ts
 *
 * Node on a laptop is ~5-10x faster than Hermes on a phone; read as relative.
 */
import { describe, expect, it } from 'vitest';

import {
  applyPerSplitElevation,
  computeElevationStats,
  elevationPerSplit,
} from '@/lib/metrics/elevation';
import { injuryRiskWarnings } from '@/lib/metrics/injuryRisk';
import { mafPaceFromSamples } from '@/lib/metrics/maf';
import { splitsFromPoints } from '@/lib/run/distance';
import { computeRunTerrainMetrics } from '@/lib/metrics/terrain';
import { aggregateZoneDistribution } from '@/lib/metrics/zones';
import { matchOrCreateRoute } from '@/lib/route/matching';
import { mafWindowFromCeiling } from '@/lib/zones';

import { loadFixture } from './fixture';

const fixture = process.env.PERF === '1' ? loadFixture() : null;

function time(label: string, fn: () => unknown, reps = 5): number {
  fn();
  const t0 = performance.now();
  for (let i = 0; i < reps; i += 1) fn();
  const ms = (performance.now() - t0) / reps;
  console.log(`${label.padEnd(34)} ${ms.toFixed(2)} ms`);
  return ms;
}

describe.skipIf(!fixture)('finish path perf', () => {
  it('times each finish/save step on the longest run', () => {
    const { db, profile } = fixture!;
    const runs = db.getAllRuns();
    const longest = [...runs].sort(
      (a, b) => db.getGpsPoints(b.id).length - db.getGpsPoints(a.id).length
    )[0]!;
    const gps = db.getGpsPoints(longest.id);
    const hr = db.getHRSamples(longest.id);
    const cad = db.getCadenceSamples(longest.id);
    console.log(`run ${longest.id}: gps ${gps.length}, hr ${hr.length}`);
    const maf = mafWindowFromCeiling(profile.mafCeiling);

    time('splitsFromPoints', () => splitsFromPoints(gps, hr));
    time('mafPaceFromSamples', () => mafPaceFromSamples(hr, gps, maf));
    time('aggregateZoneDistribution', () => aggregateZoneDistribution(hr, profile.zones, []));
    time('computeRunTerrainMetrics', () => computeRunTerrainMetrics(gps, hr, cad, maf));
    time('computeElevationStats', () => computeElevationStats(gps));
    time('elevationPerSplit+apply', () =>
      applyPerSplitElevation(longest.splits, elevationPerSplit(gps))
    );
    time('getAllRuns x2 (summary memos)', () => {
      db.getAllRuns();
      db.getAllRuns();
    });
    time('injuryRiskWarnings', () => injuryRiskWarnings({ runs }));
    time('matchOrCreateRoute', () =>
      matchOrCreateRoute({
        runId: 'bench',
        runStartedAt: Date.now(),
        distanceM: longest.distance_m,
        ascentM: longest.ascent_m ?? 0,
        points: gps,
        existingRoutes: db.getAllRoutes(),
      })
    );
    expect(gps.length).toBeGreaterThan(0);
  });
});
