// SPDX-License-Identifier: GPL-3.0-or-later

import type {
  CadenceSampleRecord,
  CompletedRun,
  GpsPointRecord,
  HRSampleRecord,
  RouteSummary,
} from '@/types';
export const RUN_EXPORT_SCHEMA = 'basemile.run-export.v1';

/**
 * A complete, self-contained dump of ONE run: the full run row (every
 * CompletedRun field — splits, elevation, zone distribution, GAP/MAF, ascent
 * /descent, weather, pre-run state, context, notes) plus every related sample
 * series (GPS incl. altitude AND ground_elevation, HR, cadence)
 * and the matched route summary if one exists.
 *
 * Designed for per-run analysis in other tools without any of the
 * surrounding history. Pure and dependency-injected so
 * it stays unit-testable without pulling native modules into the test runner.
 */
export interface RunExport {
  schema: typeof RUN_EXPORT_SCHEMA;
  exported_at: string;
  run: CompletedRun;
  gps_points: GpsPointRecord[];
  hr_samples: HRSampleRecord[];
  cadence_samples: CadenceSampleRecord[];
  route: RouteSummary | null;
}

export interface BuildRunExportInput {
  run_id: string;
  getRun: (run_id: string) => CompletedRun | null;
  getGpsPoints: (run_id: string) => GpsPointRecord[];
  getHRSamples: (run_id: string) => HRSampleRecord[];
  getCadenceSamples: (run_id: string) => CadenceSampleRecord[];
  getRoute: (route_id: string) => RouteSummary | null;
  exportedAt?: Date;
}

/**
 * Assemble the single-run payload. Returns null when the run does not exist.
 * All data access is injected so this builder is a pure function over its deps.
 */
export function buildRunExport(input: BuildRunExportInput): RunExport | null {
  const run = input.getRun(input.run_id);
  if (!run) return null;

  const exportedAt = input.exportedAt ?? new Date();
  const route = run.route_id != null ? input.getRoute(run.route_id) : null;

  return {
    schema: RUN_EXPORT_SCHEMA,
    exported_at: exportedAt.toISOString(),
    run,
    gps_points: input.getGpsPoints(input.run_id),
    hr_samples: input.getHRSamples(input.run_id),
    cadence_samples: input.getCadenceSamples(input.run_id),
    route,
  };
}

/** `basemile-run-<YYYY-MM-DD>-<shortid>.json` for a given run. */
export function runExportFilename(run: CompletedRun): string {
  const date = new Date(run.started_at).toISOString().slice(0, 10);
  const shortId = run.id.slice(0, 8);
  return `basemile-run-${date}-${shortId}.json`;
}
