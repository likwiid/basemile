// SPDX-License-Identifier: GPL-3.0-or-later

import { sanitizePreRunState } from '@/lib/run/preRun';
import { normalizeLegacyRunType } from '@/lib/run/runTypes';
import type {
  CompletedRun,
  ElevationStats,
  RunContext,
  RunWeather,
  SplitMetric,
  StoredDecoupling,
  ZoneDistribution,
} from '@/types';

function parseJsonObject<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as T;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export interface RunRow {
  id: string;
  started_at: number;
  ended_at: number;
  session_id: string | null;
  type: string;
  duration_sec: number;
  distance_m: number;
  avg_hr: number;
  max_hr: number;
  avg_pace_sec_per_km: number;
  maf_pace_sec_per_km: number | null;
  maf_ceiling: number | null;
  avg_gap_sec_per_km: number | null;
  maf_gap_pace_sec_per_km: number | null;
  ascent_m: number | null;
  descent_m: number | null;
  avg_cadence_spm: number | null;
  route_id: string | null;
  lap_count: number | null;
  elevation_fit_m: number | null;
  zone_distribution: string;
  splits: string;
  recovery_hr_drop: number | null;
  notes: string | null;
  context_json: string | null;
  weather_json: string | null;
  pre_run_json: string | null;
  elevation_json: string | null;
  decoupling_json: string | null;
  pause_intervals_json: string | null;
}

/**
 * Raw `runs` row -> CompletedRun. Pure (no expo-sqlite import) so the history
 * perf harness and equality tests can decode raw table rows in node.
 */
export function rowToRun(row: RunRow): CompletedRun {
  const zoneDistribution = JSON.parse(row.zone_distribution) as ZoneDistribution;
  const splits = JSON.parse(row.splits) as SplitMetric[];
  const context = parseJsonObject<RunContext>(row.context_json);
  const weather = parseJsonObject<RunWeather>(row.weather_json);
  // Belt-and-braces: an event-shaped blob that predates the purge migration
  // must never surface as a "pre-run state" (it also bloats every read).
  const preRunState = sanitizePreRunState(
    parseJsonObject<CompletedRun['pre_run_state']>(row.pre_run_json)
  );
  const elevation = parseJsonObject<ElevationStats>(row.elevation_json);
  const decoupling = parseJsonObject<StoredDecoupling>(row.decoupling_json);
  const pauseIntervals = row.pause_intervals_json
    ? (() => {
        try {
          const parsed = JSON.parse(row.pause_intervals_json!) as unknown;
          return Array.isArray(parsed) ? (parsed as { start: number; end: number }[]) : null;
        } catch {
          return null;
        }
      })()
    : null;
  return {
    id: row.id,
    started_at: row.started_at,
    ended_at: row.ended_at,
    session_id: row.session_id,
    type: normalizeLegacyRunType(row.type),
    duration_sec: row.duration_sec,
    distance_m: row.distance_m,
    avg_hr: row.avg_hr,
    max_hr: row.max_hr,
    avg_pace_sec_per_km: row.avg_pace_sec_per_km,
    maf_pace_sec_per_km: row.maf_pace_sec_per_km,
    ...(row.maf_ceiling !== null ? { maf_ceiling: row.maf_ceiling } : {}),
    avg_gap_sec_per_km: row.avg_gap_sec_per_km,
    maf_gap_pace_sec_per_km: row.maf_gap_pace_sec_per_km,
    ascent_m: row.ascent_m ?? undefined,
    descent_m: row.descent_m ?? undefined,
    avg_cadence_spm: row.avg_cadence_spm,
    route_id: row.route_id,
    lap_count: row.lap_count,
    elevation_fit_m: row.elevation_fit_m,
    zone_distribution: zoneDistribution,
    splits,
    ...(row.recovery_hr_drop !== null ? { recovery_hr_drop: row.recovery_hr_drop } : {}),
    ...(elevation ? { elevation } : {}),
    ...(decoupling ? { decoupling } : {}),
    ...(pauseIntervals && pauseIntervals.length > 0 ? { pause_intervals: pauseIntervals } : {}),
    ...(row.notes !== null ? { notes: row.notes } : {}),
    ...(context ? { context } : {}),
    ...(weather ? { weather } : {}),
    ...(preRunState ? { pre_run_state: preRunState } : {}),
  };
}
