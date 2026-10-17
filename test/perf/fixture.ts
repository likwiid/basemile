// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Real-data fixture for the history perf harness and equality tests: a JSON
 * dump of your own database tables, shaped as
 * {data:{sqlite:{runs,gps_points,hr_samples,...},asyncStorage?}}. Point
 * BASEMILE_PERF_FIXTURE at such a file to run them. Everything here degrades
 * to `null` when no file is set so CI never depends on it.
 */
import { existsSync, readFileSync } from 'node:fs';

import { USER_PROFILE } from '@/config/user';
import { thinTrackRows, type ThinTrackRow } from '@/lib/route/heatTracks';
import { rowToRun, type RunRow } from '@/lib/storage/runRow';
import type { TrackRow } from '@/lib/storage/tracks';
import type {
  CadenceSampleRecord,
  CompletedRun,
  GpsPointRecord,
  HRSampleRecord,
  RouteSummary,
  UserProfile,
} from '@/types';

export const FIXTURE_PATH = process.env.BASEMILE_PERF_FIXTURE ?? '';

export interface GpsRow {
  run_id: string;
  timestamp: number;
  latitude: number;
  longitude: number;
  altitude: number | null;
  altitude_accuracy: number | null;
  ground_elevation: number | null;
  speed: number | null;
  accuracy: number | null;
}

/**
 * In-memory stand-in for the SQLite tables. Each read copies its rows, which
 * models the per-row object materialisation expo-sqlite's getAllSync does
 * across JSI (the part of a query the JS thread pays for). Rows are
 * pre-grouped by run the way the (run_id, timestamp) indexes serve them.
 */
export class FixtureDb {
  rowsRead = 0;

  constructor(
    readonly runRows: RunRow[],
    readonly hrByRun: Map<string, HRSampleRecord[]>,
    readonly gpsByRun: Map<string, GpsRow[]>,
    readonly cadenceByRun: Map<string, CadenceSampleRecord[]>,
    readonly routes: RouteSummary[]
  ) {}

  private read<T extends object>(rows: readonly T[]): T[] {
    this.rowsRead += rows.length;
    return rows.map((r) => ({ ...r }));
  }

  getAllRuns = (): CompletedRun[] => {
    const sorted = [...this.runRows].sort((a, b) => b.started_at - a.started_at);
    return this.read(sorted).map(rowToRun);
  };

  getRun = (id: string): CompletedRun | null => {
    const row = this.runRows.find((r) => r.id === id);
    return row ? rowToRun(this.read([row])[0]!) : null;
  };

  getHRSamples = (runId: string): HRSampleRecord[] =>
    this.read(this.hrByRun.get(runId) ?? []);

  getGpsPoints = (runId: string): GpsPointRecord[] =>
    this.read(this.gpsByRun.get(runId) ?? []).map((r) => ({
      run_id: r.run_id,
      timestamp: r.timestamp,
      latitude: r.latitude,
      longitude: r.longitude,
      altitude: r.altitude,
      altitudeAccuracy: r.altitude_accuracy,
      groundElevation: r.ground_elevation,
      speed: r.speed,
      accuracy: r.accuracy,
    }));

  getCadenceSamples = (runId: string): CadenceSampleRecord[] =>
    this.read(this.cadenceByRun.get(runId) ?? []);

  getAllRoutes = (): RouteSummary[] => this.read(this.routes);

  /** `SELECT id FROM runs ORDER BY started_at DESC`. */
  getRunIds = (): string[] =>
    this.read([...this.runRows].sort((a, b) => b.started_at - a.started_at)).map((r) => r.id);

  /** `SELECT * FROM runs WHERE started_at < ? ORDER BY started_at DESC LIMIT ?`. */
  getRunsBefore = (startedAt: number, limit: number): CompletedRun[] => {
    const rows = [...this.runRows]
      .filter((r) => r.started_at < startedAt)
      .sort((a, b) => b.started_at - a.started_at)
      .slice(0, limit);
    return this.read(rows).map(rowToRun);
  };

  /** `SELECT * FROM runs WHERE started_at >= ? ORDER BY started_at DESC`. */
  getRunsSince = (startedAt: number): CompletedRun[] => {
    const rows = [...this.runRows]
      .filter((r) => r.started_at >= startedAt)
      .sort((a, b) => b.started_at - a.started_at);
    return this.read(rows).map(rowToRun);
  };

  /**
   * getThinTrackRows: SQLite scans the raw rows natively, only the thinned
   * rows cross JSI, so only those count as read.
   */
  getThinTrackRows = (runIds: readonly string[]): ThinTrackRow[] => {
    const raw: Omit<ThinTrackRow, 'n'>[] = [];
    for (const id of [...runIds].sort()) {
      for (const r of this.gpsByRun.get(id) ?? []) {
        raw.push({ run_id: r.run_id, timestamp: r.timestamp, latitude: r.latitude, longitude: r.longitude });
      }
    }
    const thin = thinTrackRows(raw);
    this.rowsRead += thin.length;
    return thin;
  };

  /** `SELECT run_id, timestamp, latitude, longitude FROM gps_points ORDER BY run_id, timestamp`. */
  getTrackRows = (): TrackRow[] => {
    const ids = [...this.gpsByRun.keys()].sort();
    const out: TrackRow[] = [];
    for (const id of ids) {
      for (const r of this.gpsByRun.get(id) ?? []) {
        out.push({ run_id: r.run_id, timestamp: r.timestamp, latitude: r.latitude, longitude: r.longitude });
      }
    }
    this.rowsRead += out.length;
    return out;
  };
}

export interface Fixture {
  db: FixtureDb;
  profile: UserProfile;
  counts: { runs: number; hr: number; gps: number; cadence: number; routes: number };
}

function groupByRun<T extends { run_id: string; timestamp: number }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const list = out.get(row.run_id) ?? [];
    list.push(row);
    out.set(row.run_id, list);
  }
  // Stable sort keeps insertion (rowid) order for equal timestamps, like the index.
  for (const list of out.values()) list.sort((a, b) => a.timestamp - b.timestamp);
  return out;
}

interface RouteRowJson extends Omit<RouteSummary, 'track_json'> {
  track_json: string | null;
}

export function loadFixture(): Fixture | null {
  if (!FIXTURE_PATH || !existsSync(FIXTURE_PATH)) return null;
  const raw = readFileSync(FIXTURE_PATH, 'utf8').replace(new RegExp('[\\u0000-\\u001f]', 'g'), ' ');
  const json = JSON.parse(raw) as {
    data: {
      sqlite: {
        runs: Partial<RunRow>[];
        routes: RouteRowJson[];
        hr_samples: HRSampleRecord[];
        gps_points: GpsRow[];
        cadence_samples: CadenceSampleRecord[];
      };
      asyncStorage?: Record<string, string>;
    };
  };
  const sqlite = json.data.sqlite;
  // Older dumps predate some columns; SELECT * would return them as NULL.
  const runRows: RunRow[] = sqlite.runs.map((r) => ({
    maf_ceiling: null,
    lap_count: null,
    elevation_fit_m: null,
    context_json: null,
    weather_json: null,
    pre_run_json: null,
    elevation_json: null,
    decoupling_json: null,
    pause_intervals_json: null,
    ...r,
  })) as RunRow[];
  const routes: RouteSummary[] = sqlite.routes.map((r) => {
    const { track_json, ...rest } = r;
    return {
      parent_route_id: null,
      canonical_profile_json: null,
      ...rest,
      ...(track_json ? { track_json } : {}),
    };
  });

  let profile: UserProfile = USER_PROFILE;
  const storedProfile = json.data.asyncStorage?.['basemile:profile:v1'];
  if (storedProfile) {
    try {
      const parsed = JSON.parse(storedProfile) as { state?: { profile?: UserProfile } };
      if (parsed.state?.profile) profile = { ...USER_PROFILE, ...parsed.state.profile };
    } catch {
      // Fall back to the seed profile.
    }
  }

  return {
    db: new FixtureDb(
      runRows,
      groupByRun(sqlite.hr_samples),
      groupByRun(sqlite.gps_points),
      groupByRun(sqlite.cadence_samples ?? []),
      routes
    ),
    profile,
    counts: {
      runs: runRows.length,
      hr: sqlite.hr_samples.length,
      gps: sqlite.gps_points.length,
      cadence: (sqlite.cadence_samples ?? []).length,
      routes: routes.length,
    },
  };
}
