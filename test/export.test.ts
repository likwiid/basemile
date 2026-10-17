// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { runToGpx } from '@/lib/export/gpx';
import { buildRunExport, runExportFilename } from '@/lib/export/runExport';
import type {
  CadenceSampleRecord,
  CompletedRun,
  GpsPointRecord,
  HRSampleRecord,
  RouteSummary,
} from '@/types';

const run: CompletedRun = {
  id: 'run-1',
  started_at: Date.UTC(2026, 4, 15, 10),
  ended_at: Date.UTC(2026, 4, 15, 11),
  session_id: null,
  type: 'long',
  duration_sec: 3600,
  distance_m: 10_000,
  avg_hr: 130,
  max_hr: 145,
  avg_pace_sec_per_km: 360,
  maf_pace_sec_per_km: null,
  zone_distribution: {
    z1_sec: 0,
    z2_sec: 3600,
    z3_sec: 0,
    z4_sec: 0,
    z5_sec: 0,
  },
  splits: [],
};

describe('export helpers', () => {
  it('exports GPS points as GPX trackpoints', () => {
    const gpx = runToGpx(run, [
      {
        run_id: run.id,
        timestamp: run.started_at,
        latitude: 33.9,
        longitude: 35.5,
        altitude: 20,
      },
    ]);

    expect(gpx).toContain('<gpx version="1.1"');
    expect(gpx).toContain('<trkpt lat="33.9" lon="35.5">');
    expect(gpx).toContain('<ele>20</ele>');
  });
});

describe('buildRunExport', () => {
  const gpsPoint: GpsPointRecord = {
    run_id: 'run-1',
    timestamp: run.started_at,
    latitude: 33.9,
    longitude: 35.5,
    altitude: 18,
    altitudeAccuracy: 3,
    groundElevation: 20,
    speed: 2.7,
    accuracy: 5,
  };
  const hrSample: HRSampleRecord = {
    run_id: 'run-1',
    timestamp: run.started_at,
    bpm: 132,
  };
  const cadenceSample: CadenceSampleRecord = {
    run_id: 'run-1',
    timestamp: run.started_at,
    spm: 174,
  };
  const route: RouteSummary = {
    id: 'route-1',
    name: 'River Loop',
    fingerprint: 'abc',
    total_distance_m: 10_000,
    avg_elevation_gain_m: 42,
    color: '#fff',
    first_run_date: run.started_at,
    run_count: 3,
  };

  function deps(routeId: string | null) {
    return {
      run_id: 'run-1',
      getRun: () => ({ ...run, route_id: routeId }),
      getGpsPoints: () => [gpsPoint],
      getHRSamples: () => [hrSample],
      getCadenceSamples: () => [cadenceSample],
      getRoute: () => route,
      exportedAt: new Date(Date.UTC(2026, 4, 15)),
    };
  }

  it('assembles the full single-run payload with all sample series', () => {
    const payload = buildRunExport(deps('route-1'));

    expect(payload).not.toBeNull();
    expect(payload?.schema).toBe('basemile.run-export.v1');
    expect(payload?.exported_at).toBe('2026-05-15T00:00:00.000Z');
    expect(payload?.run.id).toBe('run-1');
    // GPS keeps both raw altitude and DEM ground elevation.
    expect(payload?.gps_points[0]?.altitude).toBe(18);
    expect(payload?.gps_points[0]?.groundElevation).toBe(20);
    expect(payload?.hr_samples).toHaveLength(1);
    expect(payload?.cadence_samples).toHaveLength(1);
    expect(payload?.route?.name).toBe('River Loop');
  });

  it('omits the route when the run has no matched route', () => {
    const payload = buildRunExport(deps(null));
    expect(payload?.route).toBeNull();
  });

  it('returns null when the run does not exist', () => {
    const payload = buildRunExport({
      ...deps('route-1'),
      getRun: () => null,
    });
    expect(payload).toBeNull();
  });

  it('builds a dated short-id filename', () => {
    expect(runExportFilename(run)).toBe('basemile-run-2026-05-15-run-1.json');
  });
});
