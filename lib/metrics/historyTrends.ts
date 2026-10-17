// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Load-avoiding wrappers around the audited trend metrics. They never change
 * the math: each returns exactly what the wrapped function returns for the
 * same inputs (see test/historyPerf.equality.test.ts).
 */
import { DECOUPLING_METHOD_VERSION, decouplingTrend } from '@/lib/metrics/decoupling';
import type { CompletedRun, DecouplingPoint, GpsPointRecord, HRSampleRecord } from '@/types';

/** Mirrors decouplingTrend's own "use the persisted value" test. */
export function hasCurrentDecoupling(run: CompletedRun): boolean {
  return run.decoupling != null && run.decoupling.method_version === DECOUPLING_METHOD_VERSION;
}

/**
 * decouplingTrend, but samples are only loaded for runs whose persisted
 * decoupling is missing or stale. decouplingTrend never reads the sample maps
 * for the others, so the result is identical while the History tab no longer
 * pulls every HR sample and GPS point in the database on each refresh.
 */
export function decouplingTrendLoadingMissing(
  runs: CompletedRun[],
  loadHr: (runId: string) => HRSampleRecord[],
  loadGps: (runId: string) => GpsPointRecord[]
): DecouplingPoint[] {
  const samples = new Map<string, HRSampleRecord[]>();
  const gps = new Map<string, GpsPointRecord[]>();
  for (const run of runs) {
    if (hasCurrentDecoupling(run)) continue;
    samples.set(run.id, loadHr(run.id));
    gps.set(run.id, loadGps(run.id));
  }
  return decouplingTrend(runs, samples, gps);
}
