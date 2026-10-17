// SPDX-License-Identifier: GPL-3.0-or-later

import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

import { DB_NAME } from '@/config/constants';
import { aggregateZoneDistribution } from '@/lib/metrics/zones';
import { sanitizePreRunState } from '@/lib/run/preRun';
import { rowToRun, type RunRow } from '@/lib/storage/runRow';
import { HEAT_BUCKET_MS, type ThinTrackRow } from '@/lib/route/heatTracks';
import type {
  BaselineRecord,
  CadenceSample,
  CadenceSampleRecord,
  Co2Record,
  CompletedRun,
  ElevationStats,
  GpsPoint,
  GpsPointRecord,
  HRSample,
  HRSampleRecord,
  HrvRecord,
  RouteSummary,
  RunContext,
  SplitMetric,
  StoredDecoupling,
  ZoneConfig,
} from '@/types';

let dbSingleton: SQLiteDatabase | null = null;

export function getDb(): SQLiteDatabase {
  if (!dbSingleton) {
    dbSingleton = openDatabaseSync(DB_NAME);
  }
  return dbSingleton;
}

export function initDb(): void {
  const db = getDb();
  db.execSync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      session_id TEXT,
      type TEXT NOT NULL,
      duration_sec INTEGER NOT NULL,
      distance_m REAL NOT NULL,
      avg_hr INTEGER NOT NULL,
      max_hr INTEGER NOT NULL,
      avg_pace_sec_per_km REAL NOT NULL,
      maf_pace_sec_per_km REAL,
      maf_ceiling REAL,
      avg_gap_sec_per_km REAL,
      maf_gap_pace_sec_per_km REAL,
      ascent_m REAL,
      descent_m REAL,
      avg_cadence_spm REAL,
      route_id TEXT,
      zone_distribution TEXT NOT NULL,
      splits TEXT NOT NULL,
      recovery_hr_drop INTEGER,
      notes TEXT,
      context_json TEXT,
      weather_json TEXT,
      pre_run_json TEXT,
      elevation_json TEXT,
      decoupling_json TEXT,
      pause_intervals_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at DESC);

    -- 0.2: the 12-week plan is gone; fold its session types onto the three
    -- run types. Idempotent — already-migrated rows never match.
    UPDATE runs SET type = 'long' WHERE type IN ('z2_long', 'z2_short', 'rest', 'lift');
    UPDATE runs SET type = 'brief' WHERE type IN ('intervals', 'time_trial');

    CREATE TABLE IF NOT EXISTS hr_samples (
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      timestamp INTEGER NOT NULL,
      bpm INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hr_samples_run_ts ON hr_samples(run_id, timestamp);

    CREATE TABLE IF NOT EXISTS gps_points (
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      timestamp INTEGER NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      altitude REAL,
      altitude_accuracy REAL,
      ground_elevation REAL,
      speed REAL,
      accuracy REAL
    );
    CREATE INDEX IF NOT EXISTS idx_gps_points_run_ts ON gps_points(run_id, timestamp);

    CREATE TABLE IF NOT EXISTS cadence_samples (
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      timestamp INTEGER NOT NULL,
      spm REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cadence_samples_run_ts ON cadence_samples(run_id, timestamp);

    CREATE TABLE IF NOT EXISTS routes (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      total_distance_m REAL NOT NULL,
      avg_elevation_gain_m REAL,
      color TEXT NOT NULL,
      first_run_date INTEGER NOT NULL,
      run_count INTEGER NOT NULL,
      track_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_routes_first_run ON routes(first_run_date DESC);

    CREATE TABLE IF NOT EXISTS baselines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      measured_at INTEGER NOT NULL,
      kind TEXT NOT NULL,
      bpm INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_baselines_kind_ts ON baselines(kind, measured_at DESC);

    CREATE TABLE IF NOT EXISTS hrv_samples (
      measured_at INTEGER PRIMARY KEY NOT NULL,
      rmssd_ms REAL NOT NULL,
      mean_hr INTEGER NOT NULL,
      rr_count INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS co2_samples (
      measured_at INTEGER PRIMARY KEY NOT NULL,
      hold_sec INTEGER NOT NULL
    );
  `);
  ensureRunColumns(db);
  ensureGpsElevationColumns(db);
  ensureRoutesElevationNullable(db);
  ensureRouteColumns(db);
  ensureReadIndexes(db);
}

/** Indexes for read paths only; additive and idempotent. */
function ensureReadIndexes(db: SQLiteDatabase): void {
  // getRunsForRoute: WHERE route_id = ? ORDER BY started_at DESC.
  db.execSync(
    `CREATE INDEX IF NOT EXISTS idx_runs_route_started ON runs(route_id, started_at DESC)`
  );
}

function ensureRouteColumns(db: SQLiteDatabase): void {
  const cols = db.getAllSync<{ name: string }>(`PRAGMA table_info(routes)`);
  const names = new Set(cols.map((c) => c.name));
  const addColumn = (name: string, definition: string) => {
    if (!names.has(name)) {
      db.execSync(`ALTER TABLE routes ADD COLUMN ${name} ${definition}`);
    }
  };
  addColumn('parent_route_id', 'TEXT');
  addColumn('canonical_profile_json', 'TEXT');
}

/**
 * Make routes.avg_elevation_gain_m nullable on existing DBs (it was created
 * NOT NULL). Null means "no elevation data" — distinct from a flat 0 m. SQLite
 * can't drop a column constraint in place, so recreate the small routes table.
 */
function ensureRoutesElevationNullable(db: SQLiteDatabase): void {
  const cols = db.getAllSync<{ name: string; notnull: number }>(
    `PRAGMA table_info(routes)`
  );
  const col = cols.find((c) => c.name === 'avg_elevation_gain_m');
  if (!col || col.notnull !== 1) return; // already nullable (or table absent)
  db.execSync(`
    CREATE TABLE routes_new (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      total_distance_m REAL NOT NULL,
      avg_elevation_gain_m REAL,
      color TEXT NOT NULL,
      first_run_date INTEGER NOT NULL,
      run_count INTEGER NOT NULL,
      track_json TEXT
    );
    INSERT INTO routes_new
      SELECT id, name, fingerprint, total_distance_m, avg_elevation_gain_m,
             color, first_run_date, run_count, track_json FROM routes;
    DROP TABLE routes;
    ALTER TABLE routes_new RENAME TO routes;
    CREATE INDEX IF NOT EXISTS idx_routes_first_run ON routes(first_run_date DESC);
  `);
}

function ensureRunColumns(db: SQLiteDatabase): void {
  const cols = db.getAllSync<{ name: string }>(`PRAGMA table_info(runs)`);
  const names = new Set(cols.map((c) => c.name));
  const addColumn = (name: string, definition: string) => {
    if (!names.has(name)) {
      db.execSync(`ALTER TABLE runs ADD COLUMN ${name} ${definition}`);
    }
  };
  addColumn('context_json', 'TEXT');
  addColumn('avg_gap_sec_per_km', 'REAL');
  addColumn('maf_gap_pace_sec_per_km', 'REAL');
  addColumn('ascent_m', 'REAL');
  addColumn('descent_m', 'REAL');
  addColumn('avg_cadence_spm', 'REAL');
  addColumn('route_id', 'TEXT');
  addColumn('weather_json', 'TEXT');
  addColumn('pre_run_json', 'TEXT');
  addColumn('elevation_json', 'TEXT');
  addColumn('decoupling_json', 'TEXT');
  addColumn('maf_ceiling', 'REAL');
  addColumn('pause_intervals_json', 'TEXT');
  addColumn('lap_count', 'INTEGER');
  addColumn('elevation_fit_m', 'REAL');
}

function ensureGpsElevationColumns(db: SQLiteDatabase): void {
  const cols = db.getAllSync<{ name: string }>(`PRAGMA table_info(gps_points)`);
  if (!cols.some((c) => c.name === 'altitude_accuracy')) {
    db.execSync(`ALTER TABLE gps_points ADD COLUMN altitude_accuracy REAL`);
  }
  if (!cols.some((c) => c.name === 'ground_elevation')) {
    db.execSync(`ALTER TABLE gps_points ADD COLUMN ground_elevation REAL`);
  }
}

export function insertRun(run: CompletedRun): void {
  const db = getDb();
  // Belt for the onPress-event leak: whatever the caller hands us, only a
  // whitelist-valid PreRunState may reach the pre_run_json column.
  const preRunState = sanitizePreRunState(run.pre_run_state);
  db.runSync(
    `INSERT OR REPLACE INTO runs (
      id, started_at, ended_at, session_id, type, duration_sec, distance_m,
      avg_hr, max_hr, avg_pace_sec_per_km, maf_pace_sec_per_km, maf_ceiling,
      avg_gap_sec_per_km, maf_gap_pace_sec_per_km, ascent_m, descent_m,
      avg_cadence_spm, route_id, lap_count, elevation_fit_m,
      zone_distribution, splits, recovery_hr_drop,
      notes, context_json, weather_json, pre_run_json, elevation_json, decoupling_json,
      pause_intervals_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      run.id,
      run.started_at,
      run.ended_at,
      run.session_id,
      run.type,
      run.duration_sec,
      run.distance_m,
      run.avg_hr,
      run.max_hr,
      run.avg_pace_sec_per_km,
      run.maf_pace_sec_per_km,
      run.maf_ceiling ?? null,
      run.avg_gap_sec_per_km ?? null,
      run.maf_gap_pace_sec_per_km ?? null,
      run.ascent_m ?? null,
      run.descent_m ?? null,
      run.avg_cadence_spm ?? null,
      run.route_id ?? null,
      run.lap_count ?? null,
      run.elevation_fit_m ?? null,
      JSON.stringify(run.zone_distribution),
      JSON.stringify(run.splits),
      run.recovery_hr_drop ?? null,
      run.notes ?? null,
      run.context ? JSON.stringify(run.context) : null,
      run.weather ? JSON.stringify(run.weather) : null,
      preRunState ? JSON.stringify(preRunState) : null,
      run.elevation ? JSON.stringify(run.elevation) : null,
      run.decoupling ? JSON.stringify(run.decoupling) : null,
      run.pause_intervals && run.pause_intervals.length > 0
        ? JSON.stringify(run.pause_intervals)
        : null,
    ]
  );
}

export function insertRunWithSamples(
  run: CompletedRun,
  hrSamples: HRSample[],
  gpsPoints: GpsPoint[],
  cadenceSamples: CadenceSample[]
): void {
  const db = getDb();
  db.withTransactionSync(() => {
    insertRun(run);
    db.runSync(`DELETE FROM hr_samples WHERE run_id = ?`, [run.id]);
    db.runSync(`DELETE FROM gps_points WHERE run_id = ?`, [run.id]);
    db.runSync(`DELETE FROM cadence_samples WHERE run_id = ?`, [run.id]);

    if (hrSamples.length > 0) {
      const stmt = db.prepareSync(
        `INSERT INTO hr_samples (run_id, timestamp, bpm) VALUES (?, ?, ?)`
      );
      try {
        for (const sample of hrSamples) {
          stmt.executeSync([run.id, sample.timestamp, sample.bpm]);
        }
      } finally {
        stmt.finalizeSync();
      }
    }

    if (gpsPoints.length > 0) {
      const stmt = db.prepareSync(
        `INSERT INTO gps_points
           (run_id, timestamp, latitude, longitude, altitude, altitude_accuracy, ground_elevation, speed, accuracy)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      try {
        for (const point of gpsPoints) {
          stmt.executeSync([
            run.id,
            point.timestamp,
            point.latitude,
            point.longitude,
            point.altitude ?? null,
            point.altitudeAccuracy ?? null,
            point.groundElevation ?? null,
            point.speed ?? null,
            point.accuracy ?? null,
          ]);
        }
      } finally {
        stmt.finalizeSync();
      }
    }

    if (cadenceSamples.length > 0) {
      const stmt = db.prepareSync(
        `INSERT INTO cadence_samples (run_id, timestamp, spm) VALUES (?, ?, ?)`
      );
      try {
        for (const sample of cadenceSamples) {
          stmt.executeSync([run.id, sample.timestamp, sample.spm]);
        }
      } finally {
        stmt.finalizeSync();
      }
    }
  });
}

/** Persist (or clear) the elevation summary for a run after compute/correction. */
export function updateRunElevation(
  run_id: string,
  elevation: ElevationStats | null
): void {
  const db = getDb();
  db.runSync(`UPDATE runs SET elevation_json = ? WHERE id = ?`, [
    elevation ? JSON.stringify(elevation) : null,
    run_id,
  ]);
}

/** Persist (or clear) the aerobic-decoupling result for a run so it stays stable. */
export function updateRunDecoupling(
  run_id: string,
  decoupling: StoredDecoupling | null
): void {
  const db = getDb();
  db.runSync(`UPDATE runs SET decoupling_json = ? WHERE id = ?`, [
    decoupling ? JSON.stringify(decoupling) : null,
    run_id,
  ]);
}

/**
 * Persist the DEM-reconciled elevation in one shot: the summary plus the
 * run-level ascent/descent and per-split ascent/descent all derived from the
 * same series, so every reading agrees.
 */
export function updateRunElevationMetrics(
  run_id: string,
  elevation: ElevationStats | null,
  ascent_m: number,
  descent_m: number,
  splits: SplitMetric[]
): void {
  const db = getDb();
  db.runSync(
    `UPDATE runs SET elevation_json = ?, ascent_m = ?, descent_m = ?, splits = ? WHERE id = ?`,
    [
      elevation ? JSON.stringify(elevation) : null,
      ascent_m,
      descent_m,
      JSON.stringify(splits),
      run_id,
    ]
  );
}

/**
 * Backfill terrain + elevation onto a run that predates those features (Bug 3):
 * GAP, ascent/descent, per-split metrics, and the elevation summary — all
 * recomputed from the stored GPS so the trend charts are continuous.
 */
export function updateRunBackfill(
  run_id: string,
  fields: {
    avg_gap_sec_per_km: number | null;
    maf_gap_pace_sec_per_km: number | null;
    ascent_m: number;
    descent_m: number;
    splits: SplitMetric[];
    elevation: ElevationStats | null;
  }
): void {
  const db = getDb();
  db.runSync(
    `UPDATE runs SET avg_gap_sec_per_km = ?, maf_gap_pace_sec_per_km = ?, ascent_m = ?, descent_m = ?, splits = ?, elevation_json = ? WHERE id = ?`,
    [
      fields.avg_gap_sec_per_km,
      fields.maf_gap_pace_sec_per_km,
      fields.ascent_m,
      fields.descent_m,
      JSON.stringify(fields.splits),
      fields.elevation ? JSON.stringify(fields.elevation) : null,
      run_id,
    ]
  );
}

/**
 * Update only the grade-adjusted-pace fields (GAP, MAF-GAP, per-split GAP),
 * leaving DEM-corrected ascent/descent/elevation untouched. Used by the GAP
 * recompute migration after the steep-climb inflation fix.
 */
export function updateRunGapMetrics(
  run_id: string,
  avgGapSecPerKm: number | null,
  mafGapPaceSecPerKm: number | null,
  splits: SplitMetric[]
): void {
  const db = getDb();
  db.runSync(
    `UPDATE runs SET avg_gap_sec_per_km = ?, maf_gap_pace_sec_per_km = ?, splits = ? WHERE id = ?`,
    [avgGapSecPerKm, mafGapPaceSecPerKm, JSON.stringify(splits), run_id]
  );
}

/**
 * Null out every pre_run_json value the predicate marks as invalid (the
 * event-blob purge migration). Returns the number of runs cleaned.
 */
export function purgeInvalidPreRunStates(
  isPurgeable: (raw: string) => boolean
): number {
  const db = getDb();
  const rows = db.getAllSync<{ id: string; pre_run_json: string }>(
    `SELECT id, pre_run_json FROM runs WHERE pre_run_json IS NOT NULL`
  );
  const bad = rows.filter((row) => isPurgeable(row.pre_run_json));
  if (bad.length === 0) return 0;
  db.withTransactionSync(() => {
    for (const row of bad) {
      db.runSync(`UPDATE runs SET pre_run_json = NULL WHERE id = ?`, [row.id]);
    }
  });
  return bad.length;
}

export function updateRunContext(run_id: string, context: RunContext | null): void {
  const db = getDb();
  db.runSync(`UPDATE runs SET context_json = ? WHERE id = ?`, [
    context ? JSON.stringify(context) : null,
    run_id,
  ]);
}

export function insertHRSamples(run_id: string, samples: HRSample[]): void {
  if (samples.length === 0) return;
  const db = getDb();
  db.withTransactionSync(() => {
    const stmt = db.prepareSync(
      `INSERT INTO hr_samples (run_id, timestamp, bpm) VALUES (?, ?, ?)`
    );
    try {
      for (const s of samples) {
        stmt.executeSync([run_id, s.timestamp, s.bpm]);
      }
    } finally {
      stmt.finalizeSync();
    }
  });
}

export function insertGpsPoints(run_id: string, points: GpsPoint[]): void {
  if (points.length === 0) return;
  const db = getDb();
  db.withTransactionSync(() => {
    const stmt = db.prepareSync(
      `INSERT INTO gps_points
         (run_id, timestamp, latitude, longitude, altitude, altitude_accuracy, ground_elevation, speed, accuracy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    try {
      for (const p of points) {
        stmt.executeSync([
          run_id,
          p.timestamp,
          p.latitude,
          p.longitude,
          p.altitude ?? null,
          p.altitudeAccuracy ?? null,
          p.groundElevation ?? null,
          p.speed ?? null,
          p.accuracy ?? null,
        ]);
      }
    } finally {
      stmt.finalizeSync();
    }
  });
}

export function insertCadenceSamples(run_id: string, samples: CadenceSample[]): void {
  if (samples.length === 0) return;
  const db = getDb();
  db.withTransactionSync(() => {
    const stmt = db.prepareSync(
      `INSERT INTO cadence_samples (run_id, timestamp, spm) VALUES (?, ?, ?)`
    );
    try {
      for (const s of samples) {
        stmt.executeSync([run_id, s.timestamp, s.spm]);
      }
    } finally {
      stmt.finalizeSync();
    }
  });
}

/**
 * Backfill DEM ground elevation onto stored GPS points after a cloud
 * correction pass. Matches rows by (run_id, timestamp).
 */
export function updateGpsGroundElevations(
  run_id: string,
  updates: { timestamp: number; ground_elevation: number | null }[]
): void {
  if (updates.length === 0) return;
  const db = getDb();
  db.withTransactionSync(() => {
    const stmt = db.prepareSync(
      `UPDATE gps_points SET ground_elevation = ? WHERE run_id = ? AND timestamp = ?`
    );
    try {
      for (const u of updates) {
        stmt.executeSync([u.ground_elevation, run_id, u.timestamp]);
      }
    } finally {
      stmt.finalizeSync();
    }
  });
}

export function insertBaseline(b: BaselineRecord): void {
  const db = getDb();
  db.runSync(
    `INSERT INTO baselines (measured_at, kind, bpm) VALUES (?, ?, ?)`,
    [b.measured_at, b.kind, b.bpm]
  );
}

// Existing DBs created before the FK cascade clauses won't auto-migrate;
// we delete from each child table explicitly to stay correct on legacy installs.
export function deleteRun(id: string): void {
  const db = getDb();
  db.withTransactionSync(() => {
    db.runSync(`DELETE FROM hr_samples WHERE run_id = ?`, [id]);
    db.runSync(`DELETE FROM gps_points WHERE run_id = ?`, [id]);
    db.runSync(`DELETE FROM cadence_samples WHERE run_id = ?`, [id]);
    db.runSync(`DELETE FROM runs WHERE id = ?`, [id]);
  });
}

export function resetDb(): void {
  const db = getDb();
  db.withTransactionSync(() => {
    db.runSync(`DELETE FROM co2_samples`);
    db.runSync(`DELETE FROM hrv_samples`);
    db.runSync(`DELETE FROM baselines`);
    db.runSync(`DELETE FROM routes`);
    db.runSync(`DELETE FROM cadence_samples`);
    db.runSync(`DELETE FROM gps_points`);
    db.runSync(`DELETE FROM hr_samples`);
    db.runSync(`DELETE FROM runs`);
  });
}

/**
 * Cheap token that changes whenever any table is written: `total_changes()`
 * counts rows modified through this (singleton) connection and
 * `PRAGMA data_version` moves when another connection commits. History
 * compares it on focus to skip re-reading and re-deriving unchanged data. It
 * stays this broad on purpose: History shows per-run fields (decoupling,
 * elevation-corrected GAP, notes) that are written by plain UPDATEs on runs,
 * and only a write counter sees those cheaply.
 */
export function getDataVersion(): string {
  const db = getDb();
  const changes = db.getFirstSync<{ n: number }>(`SELECT total_changes() AS n`);
  const external = db.getFirstSync<{ data_version: number }>(`PRAGMA data_version`);
  return `${changes?.n ?? 0}:${external?.data_version ?? 0}`;
}

/**
 * Narrow change token for the Routes tab. It moves only when something that
 * tab draws changes: the set of runs (count, newest rowid, sum of start times
 * via the started_at index), new GPS rows (max rowid; deleting a run already
 * moves the run part), any displayed route column, or a commit from another
 * connection. Viewing a run (decoupling / elevation stamps), notes and context
 * edits, and ground-elevation backfills leave it unchanged.
 */
export function getRoutesDataVersion(): string {
  const db = getDb();
  const row = db.getFirstSync<{
    runs: number;
    run_max: number | null;
    run_starts: number;
    gps_max: number | null;
    routes: string | null;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM runs) AS runs,
       (SELECT MAX(rowid) FROM runs) AS run_max,
       (SELECT total(started_at) FROM runs) AS run_starts,
       (SELECT MAX(rowid) FROM gps_points) AS gps_max,
       (SELECT group_concat(sig, '|') FROM (
          SELECT id || ':' || name || ':' || color || ':' || run_count || ':' ||
                 total_distance_m || ':' || ifnull(avg_elevation_gain_m, '') || ':' ||
                 first_run_date AS sig
          FROM routes ORDER BY first_run_date DESC, id
       )) AS routes`
  );
  const external = db.getFirstSync<{ data_version: number }>(`PRAGMA data_version`);
  return [
    row?.runs ?? 0,
    row?.run_max ?? 0,
    row?.run_starts ?? 0,
    row?.gps_max ?? 0,
    external?.data_version ?? 0,
    row?.routes ?? '',
  ].join(':');
}

/** Run ids, newest first: the order the Routes heat map stacks tracks in. */
export function getRunIds(): string[] {
  const db = getDb();
  return db
    .getAllSync<{ id: string }>(`SELECT id FROM runs ORDER BY started_at DESC`)
    .map((r) => r.id);
}

/**
 * The given runs' tracks thinned in SQL to one row per run per `bucketMs`
 * (the bucket's first sample plus its size), ordered by run then time. Only
 * the thinned rows cross JSI. SQLite takes the bare latitude / longitude from
 * the row that supplies MIN(timestamp).
 */
export function getThinTrackRows(
  runIds: readonly string[],
  bucketMs: number = HEAT_BUCKET_MS
): ThinTrackRow[] {
  if (runIds.length === 0) return [];
  const db = getDb();
  const placeholders = runIds.map(() => '?').join(', ');
  return db.getAllSync<ThinTrackRow>(
    `SELECT run_id, MIN(timestamp) AS timestamp, latitude, longitude, COUNT(*) AS n
     FROM gps_points
     WHERE run_id IN (${placeholders})
     GROUP BY run_id, CAST(timestamp / ? AS INTEGER)
     ORDER BY run_id, timestamp`,
    [...runIds, bucketMs]
  );
}

export function getAllRuns(): CompletedRun[] {
  const db = getDb();
  const rows = db.getAllSync<RunRow>(`SELECT * FROM runs ORDER BY started_at DESC`);
  return rows.map(rowToRun);
}

export function getRun(id: string): CompletedRun | null {
  const db = getDb();
  const row = db.getFirstSync<RunRow>(`SELECT * FROM runs WHERE id = ?`, [id]);
  return row ? rowToRun(row) : null;
}

/** The `limit` runs that started strictly before `startedAt`, newest first. */
export function getRunsBefore(startedAt: number, limit: number): CompletedRun[] {
  const db = getDb();
  const rows = db.getAllSync<RunRow>(
    `SELECT * FROM runs WHERE started_at < ? ORDER BY started_at DESC LIMIT ?`,
    [startedAt, limit]
  );
  return rows.map(rowToRun);
}

/** Runs that started at or after `startedAt`, newest first. */
export function getRunsSince(startedAt: number): CompletedRun[] {
  const db = getDb();
  const rows = db.getAllSync<RunRow>(
    `SELECT * FROM runs WHERE started_at >= ? ORDER BY started_at DESC`,
    [startedAt]
  );
  return rows.map(rowToRun);
}

export function recomputeAllRunZoneDistributions(zones: ZoneConfig): void {
  const db = getDb();
  const rows = db.getAllSync<{ id: string; pause_intervals_json: string | null }>(
    `SELECT id, pause_intervals_json FROM runs`
  );
  db.withTransactionSync(() => {
    for (const { id, pause_intervals_json } of rows) {
      const samples = db.getAllSync<HRSampleRecord>(
        `SELECT run_id, timestamp, bpm FROM hr_samples WHERE run_id = ? ORDER BY timestamp ASC`,
        [id]
      );
      let pauses: { start: number; end: number }[] = [];
      if (pause_intervals_json) {
        try {
          const parsed = JSON.parse(pause_intervals_json) as unknown;
          if (Array.isArray(parsed)) pauses = parsed as { start: number; end: number }[];
        } catch {
          // Unparseable pause data → aggregate without exclusions.
        }
      }
      const distribution = aggregateZoneDistribution(samples, zones, pauses);
      db.runSync(`UPDATE runs SET zone_distribution = ? WHERE id = ?`, [
        JSON.stringify(distribution),
        id,
      ]);
    }
  });
}

export function getHRSamples(run_id: string): HRSampleRecord[] {
  const db = getDb();
  return db.getAllSync<HRSampleRecord>(
    `SELECT run_id, timestamp, bpm FROM hr_samples WHERE run_id = ? ORDER BY timestamp ASC`,
    [run_id]
  );
}

interface GpsRow {
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

export function getGpsPoints(run_id: string): GpsPointRecord[] {
  const db = getDb();
  const rows = db.getAllSync<GpsRow>(
    `SELECT run_id, timestamp, latitude, longitude, altitude, altitude_accuracy, ground_elevation, speed, accuracy
     FROM gps_points WHERE run_id = ? ORDER BY timestamp ASC`,
    [run_id]
  );
  return rows.map((r) => ({
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
}

export function getCadenceSamples(run_id: string): CadenceSampleRecord[] {
  const db = getDb();
  return db.getAllSync<CadenceSampleRecord>(
    `SELECT run_id, timestamp, spm FROM cadence_samples WHERE run_id = ? ORDER BY timestamp ASC`,
    [run_id]
  );
}

interface RouteRow {
  id: string;
  name: string;
  fingerprint: string;
  total_distance_m: number;
  avg_elevation_gain_m: number | null;
  color: string;
  first_run_date: number;
  run_count: number;
  track_json: string | null;
  parent_route_id: string | null;
  canonical_profile_json: string | null;
}

function rowToRoute(row: RouteRow): RouteSummary {
  return {
    id: row.id,
    name: row.name,
    fingerprint: row.fingerprint,
    total_distance_m: row.total_distance_m,
    avg_elevation_gain_m: row.avg_elevation_gain_m,
    color: row.color,
    first_run_date: row.first_run_date,
    run_count: row.run_count,
    ...(row.track_json ? { track_json: row.track_json } : {}),
    parent_route_id: row.parent_route_id,
    canonical_profile_json: row.canonical_profile_json,
  };
}

const ROUTE_COLUMNS = `id, name, fingerprint, total_distance_m, avg_elevation_gain_m, color,
            first_run_date, run_count, track_json, parent_route_id, canonical_profile_json`;

export function getAllRoutes(): RouteSummary[] {
  const db = getDb();
  const rows = db.getAllSync<RouteRow>(
    `SELECT ${ROUTE_COLUMNS} FROM routes ORDER BY first_run_date DESC`
  );
  return rows.map(rowToRoute);
}

export function getRoute(id: string): RouteSummary | null {
  const db = getDb();
  const row = db.getFirstSync<RouteRow>(
    `SELECT ${ROUTE_COLUMNS} FROM routes WHERE id = ?`,
    [id]
  );
  return row ? rowToRoute(row) : null;
}

export function getRunsForRoute(route_id: string): CompletedRun[] {
  const db = getDb();
  const rows = db.getAllSync<RunRow>(
    `SELECT * FROM runs WHERE route_id = ? ORDER BY started_at DESC`,
    [route_id]
  );
  return rows.map(rowToRun);
}

export function insertRoute(route: RouteSummary): void {
  const db = getDb();
  db.runSync(
    `INSERT OR REPLACE INTO routes (
      id, name, fingerprint, total_distance_m, avg_elevation_gain_m, color,
      first_run_date, run_count, track_json, parent_route_id, canonical_profile_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      route.id,
      route.name,
      route.fingerprint,
      route.total_distance_m,
      route.avg_elevation_gain_m,
      route.color,
      route.first_run_date,
      route.run_count,
      route.track_json ?? null,
      route.parent_route_id ?? null,
      route.canonical_profile_json ?? null,
    ]
  );
}

export function renameRoute(id: string, name: string): void {
  const db = getDb();
  db.runSync(`UPDATE routes SET name = ? WHERE id = ?`, [name, id]);
}

export function deleteRoute(id: string): void {
  const db = getDb();
  db.runSync(`DELETE FROM routes WHERE id = ?`, [id]);
}

/** Persist (or clear) a route's canonical elevation profile. */
export function updateRouteCanonicalProfile(
  route_id: string,
  canonical_profile_json: string | null
): void {
  const db = getDb();
  db.runSync(`UPDATE routes SET canonical_profile_json = ? WHERE id = ?`, [
    canonical_profile_json,
    route_id,
  ]);
}

/**
 * Re-point a run at a route. When `lap_count` is passed (including null) the
 * stored lap count is updated too; omitting it leaves the column untouched.
 */
export function updateRunRoute(
  run_id: string,
  route_id: string | null,
  lap_count?: number | null
): void {
  const db = getDb();
  if (lap_count === undefined) {
    db.runSync(`UPDATE runs SET route_id = ? WHERE id = ?`, [route_id, run_id]);
  } else {
    db.runSync(`UPDATE runs SET route_id = ?, lap_count = ? WHERE id = ?`, [
      route_id,
      lap_count,
      run_id,
    ]);
  }
}

/** Persist (or clear) the canonical-profile fit metric for a run. */
export function updateRunElevationFit(
  run_id: string,
  elevation_fit_m: number | null
): void {
  const db = getDb();
  db.runSync(`UPDATE runs SET elevation_fit_m = ? WHERE id = ?`, [
    elevation_fit_m,
    run_id,
  ]);
}

interface BaselineRow {
  measured_at: number;
  kind: string;
  bpm: number;
}

export function getBaselines(kind: BaselineRecord['kind']): BaselineRecord[] {
  const db = getDb();
  const rows = db.getAllSync<BaselineRow>(
    `SELECT measured_at, kind, bpm FROM baselines WHERE kind = ? ORDER BY measured_at DESC`,
    [kind]
  );
  return rows.map((r) => ({
    measured_at: r.measured_at,
    kind: r.kind as BaselineRecord['kind'],
    bpm: r.bpm,
  }));
}

interface HrvRow {
  measured_at: number;
  rmssd_ms: number;
  mean_hr: number;
  rr_count: number;
}

function rowToHrv(row: HrvRow): HrvRecord {
  return {
    measured_at: row.measured_at,
    rmssd_ms: row.rmssd_ms,
    mean_hr: row.mean_hr,
    rr_count: row.rr_count,
  };
}

export function insertHrv(record: HrvRecord): void {
  const db = getDb();
  db.runSync(
    `INSERT OR REPLACE INTO hrv_samples (measured_at, rmssd_ms, mean_hr, rr_count)
     VALUES (?, ?, ?, ?)`,
    [record.measured_at, record.rmssd_ms, record.mean_hr, record.rr_count]
  );
}

export function getAllHrv(): HrvRecord[] {
  const db = getDb();
  const rows = db.getAllSync<HrvRow>(
    `SELECT measured_at, rmssd_ms, mean_hr, rr_count FROM hrv_samples
     ORDER BY measured_at DESC`
  );
  return rows.map(rowToHrv);
}

export function getHrvSince(sinceMs: number): HrvRecord[] {
  const db = getDb();
  const rows = db.getAllSync<HrvRow>(
    `SELECT measured_at, rmssd_ms, mean_hr, rr_count FROM hrv_samples
     WHERE measured_at >= ? ORDER BY measured_at DESC`,
    [sinceMs]
  );
  return rows.map(rowToHrv);
}

interface Co2Row {
  measured_at: number;
  hold_sec: number;
}

export function insertCo2(record: Co2Record): void {
  const db = getDb();
  db.runSync(
    `INSERT OR REPLACE INTO co2_samples (measured_at, hold_sec) VALUES (?, ?)`,
    [record.measured_at, record.hold_sec]
  );
}

export function getAllCo2(): Co2Record[] {
  const db = getDb();
  const rows = db.getAllSync<Co2Row>(
    `SELECT measured_at, hold_sec FROM co2_samples ORDER BY measured_at DESC`
  );
  return rows.map((r) => ({
    measured_at: r.measured_at,
    hold_sec: r.hold_sec,
  }));
}

