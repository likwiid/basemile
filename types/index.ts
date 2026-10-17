// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Shared type contract for BaseMile.
 * All cross-module types live here so parallel changes do not conflict.
 * Pure types only: no runtime code.
 */

// ============================================================================
// Heart Rate & Zones
// ============================================================================

export type ZoneNumber = 1 | 2 | 3 | 4 | 5;

export type ZoneRange = readonly [min: number, max: number];

export interface ZoneConfig {
  z1: ZoneRange;
  z2: ZoneRange;
  z3: ZoneRange;
  z4: ZoneRange;
  z5: ZoneRange;
}

/** A single HR sample emitted by the BLE manager (or mock). */
export interface HRSample {
  /** Beats per minute */
  bpm: number;
  /** Unix epoch ms */
  timestamp: number;
  /** RR-intervals in milliseconds, if the strap reports them */
  rr?: number[];
  /** Energy expended in kJ if strap reports it */
  energy?: number;
}

// ============================================================================
// BLE
// ============================================================================

export type BleConnectionState =
  | 'idle'
  | 'unsupported'
  | 'unauthorized'
  | 'poweredOff'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export interface BleDevice {
  id: string;
  name: string | null;
  rssi?: number | null;
  /** True if this is the persisted device we auto-reconnect to */
  isPaired: boolean;
}

export interface BleError {
  code: string;
  message: string;
  timestamp: number;
}

// ============================================================================
// User profile
// ============================================================================

export type DayOfWeek =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export interface EatingWindow {
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

export interface UserProfile {
  name: string;
  age: number;
  sex: 'male' | 'female';
  weight_kg: number;
  height_cm: number;
  hrMax: number;
  hrRest: number;
  /** MAF formula ceiling: 180 - age - adjustment */
  mafCeiling: number;
  zones: ZoneConfig;
  eatingWindow: EatingWindow;
  liftingDays: DayOfWeek[];
  runningDays: DayOfWeek[];
}

// ============================================================================
// Run types / sessions
// ============================================================================

/** The three run types. 'long' is the default. */
export type RunTypeId = 'long' | 'medium' | 'brief';

export type SessionType = RunTypeId;

export type IntervalIntensity = 'z3' | 'z4' | 'z5';

export interface IntervalBlock {
  work_sec: number;
  rest_sec: number;
  reps: number;
  intensity: IntervalIntensity;
  /** Optional: target HR for the work portion. Falls back to zone range. */
  target_hr?: number;
  /** Recovery zone between reps. Defaults to z1 if absent. */
  recovery_intensity?: 'z1' | 'z2';
}

export interface Session {
  /** Stable id for the armed session (e.g. 'long', 'brief-hiit30-8'). */
  id: string;
  run_type: RunTypeId;
  /** Legacy plan coordinates; no longer produced. */
  week?: number;
  day?: DayOfWeek;
  duration_min: number;
  /** Primary target zone for the session */
  target_zone: ZoneNumber;
  /** Explicit band floor (medium/brief). Absent for long, which uses the zone-2 band. */
  hr_floor?: number;
  /** Hard ceiling — coach barks if HR crosses this (band top for medium/brief). */
  hr_ceiling: number;
  /** Easy warm-up before band/interval coaching starts (300 medium, 420 brief). */
  warmup_sec?: number;
  intervals?: IntervalBlock;
  /** Short guidance line shown pre-run. */
  notes: string;
}

// ============================================================================
// Run / History
// ============================================================================

export interface GpsPoint {
  /** Unix epoch ms */
  timestamp: number;
  latitude: number;
  longitude: number;
  /** Raw GPS/barometric altitude in meters (noisy). */
  altitude?: number | null;
  /** Vertical accuracy estimate in meters from the OS, if reported. */
  altitudeAccuracy?: number | null;
  /**
   * True ground elevation in meters, backfilled from a DEM API (cloud
   * correction). Null until the run has been corrected.
   */
  groundElevation?: number | null;
  speed?: number | null;
  /** Horizontal accuracy in meters. */
  accuracy?: number | null;
}

// ============================================================================
// Elevation
// ============================================================================

/** Data-quality classification for a stretch of the GPS track's elevation. */
export type ElevationQuality = 'good' | 'fair' | 'poor' | 'missing' | 'corrected';

/** Where a run's elevation numbers were derived from. */
export type ElevationSource = 'gps' | 'dem' | 'hybrid' | 'route';

/**
 * A contiguous run of GPS points sharing one elevation data-quality class.
 * Drives the "which part of the track captured elevation and which didn't" view.
 */
export interface ElevationSegment {
  /** Index into the run's ordered GPS point array (inclusive). */
  startIndex: number;
  /** End index (inclusive). */
  endIndex: number;
  quality: ElevationQuality;
  /** Net signed elevation change across the segment, meters. */
  delta_m: number;
  /** Horizontal distance covered by the segment, meters. */
  distance_m: number;
}

/** Aggregate elevation summary for a run (start → end + totals + quality). */
export interface ElevationStats {
  total_gain_m: number;
  total_loss_m: number;
  /** end_elevation_m - start_elevation_m. */
  net_m: number;
  max_elevation_m: number;
  min_elevation_m: number;
  /** Elevation at the first reliable point, meters. */
  start_elevation_m: number;
  /** Elevation at the last reliable point, meters. */
  end_elevation_m: number;
  source: ElevationSource;
  /** True once DEM cloud-correction has been applied. */
  corrected: boolean;
  /** Fraction 0..1 of the track that had usable elevation data. */
  coverage_pct: number;
  /** Per-segment data-quality breakdown. */
  segments: ElevationSegment[];
}

export interface ZoneDistribution {
  z1_sec: number;
  z2_sec: number;
  z3_sec: number;
  z4_sec: number;
  z5_sec: number;
}

export interface SplitMetric {
  km: number;
  duration_sec: number;
  avg_hr: number;
  /** Grade-adjusted pace for this km, seconds per km. */
  gap_sec_per_km?: number | null;
  /** Elevation gained during this km, meters. */
  ascent_m?: number;
  /** Elevation lost during this km, meters. */
  descent_m?: number;
  avg_cadence_spm?: number | null;
}

export interface CompletedRun {
  id: string;
  /** Unix epoch ms */
  started_at: number;
  ended_at: number;
  /** Legacy plan reference; always null for runs saved since 0.2. */
  session_id: string | null;
  type: SessionType;
  duration_sec: number;
  distance_m: number;
  avg_hr: number;
  max_hr: number;
  /** Avg pace in seconds per kilometer */
  avg_pace_sec_per_km: number;
  /** Avg pace clipped to samples where HR was inside the MAF window (145-149) */
  maf_pace_sec_per_km: number | null;
  /**
   * MAF ceiling (bpm) in effect when the run was saved. Recomputes/backfills
   * use it so a later ceiling change can't rewrite historical MAF-GAP.
   * Null on runs saved before this field existed (they fall back to the
   * current profile ceiling, matching the old behavior).
   */
  maf_ceiling?: number | null;
  /** Avg grade-adjusted pace in seconds per kilometer. */
  avg_gap_sec_per_km?: number | null;
  /** MAF-window pace corrected for grade, seconds per kilometer. */
  maf_gap_pace_sec_per_km?: number | null;
  ascent_m?: number;
  descent_m?: number;
  avg_cadence_spm?: number | null;
  route_id?: string | null;
  /**
   * Number of route traversals detected in this run (e.g. 2 for a double
   * loop). Null/absent means "not evaluated"; treat as 1.
   */
  lap_count?: number | null;
  /**
   * Median |canonical profile alt − raw GPS alt| in metres over the run's
   * good fixes, stored when route-profile elevation was applied. > 8 m
   * surfaces a data-quality warning on the elevation card.
   */
  elevation_fit_m?: number | null;
  weather?: RunWeather | null;
  pre_run_state?: PreRunState | null;
  zone_distribution: ZoneDistribution;
  splits: SplitMetric[];
  /** 1-min recovery HR after final hard interval (if applicable) */
  recovery_hr_drop?: number;
  /** Elevation summary + data-quality. Null until computed/corrected. */
  elevation?: ElevationStats | null;
  /** Persisted aerobic decoupling. Null until computed/backfilled. */
  decoupling?: StoredDecoupling | null;
  /**
   * Pause intervals (epoch ms) recorded during the run. Lets recomputes
   * exclude paused wall-time from zone aggregation — a ≤30s pause is otherwise
   * indistinguishable from a BLE gap and was counted as zone time.
   */
  pause_intervals?: { start: number; end: number }[] | null;
  notes?: string;
  context?: RunContext;
}

/** Per-row record stored in the hr_samples table. Joins to runs by run_id. */
export interface HRSampleRecord {
  run_id: string;
  timestamp: number;
  bpm: number;
}

/** Per-row record stored in the gps_points table. */
export interface GpsPointRecord extends GpsPoint {
  run_id: string;
}

export interface CadenceSample {
  /** Unix epoch ms */
  timestamp: number;
  /** True step cadence, both feet, steps per minute. */
  spm: number;
}

export interface CadenceSampleRecord extends CadenceSample {
  run_id: string;
}

export interface RunWeather {
  temp_c: number | null;
  humidity_pct: number | null;
  wind_kmh: number | null;
  weather_code: number | null;
  captured_at: number;
  source: 'open-meteo' | 'unavailable';
}

export type HydrationLevel = 'none' | 'one_glass' | 'two_glasses' | 'three_plus';
export type AlcoholLevel = 'none' | 'one_two' | 'three_plus';
export type NiggleArea =
  | 'none'
  | 'calf'
  | 'knee'
  | 'hip'
  | 'back'
  | 'shin'
  | 'other';

export interface PreRunState {
  logged_at: number;
  sleep_hours: number;
  sleep_quality: number;
  last_meal_at: number | null;
  last_meal_what: string;
  hydration: HydrationLevel;
  alcohol_24h: AlcoholLevel;
  readiness: number;
  niggles: NiggleArea[];
}

export type TerrainSegmentType = 'descent' | 'flat' | 'climb' | 'steep_climb';

export interface TerrainSegmentSummary {
  type: TerrainSegmentType;
  distance_m: number;
  duration_sec: number;
  avg_hr: number | null;
  avg_pace_sec_per_km: number | null;
  avg_gap_sec_per_km: number | null;
}

export interface RouteSummary {
  id: string;
  name: string;
  fingerprint: string;
  total_distance_m: number;
  /** Average gain over runs WITH elevation data; null when none have any. */
  avg_elevation_gain_m: number | null;
  color: string;
  first_run_date: number;
  run_count: number;
  track_json?: string;
  /**
   * Set on auto-created sub-route variants (e.g. "Route 3 · short"): the id
   * of the full route this one is a partial traversal of. Variant runs are
   * never pooled into the parent's aggregates.
   */
  parent_route_id?: string | null;
  /**
   * Canonical elevation profile built from the route's cleanest barometric
   * donor run (serialized CanonicalProfile). Null until first built.
   */
  canonical_profile_json?: string | null;
}

// ============================================================================
// Coach engine
// ============================================================================

export type CoachCueKind =
  | 'zone_exceeded'
  | 'zone_recovered'
  | 'maf_buffer'
  | 'early_too_fast'
  | 'hr_drift'
  | 'interval_warmup'
  | 'interval_start'
  | 'interval_push'
  | 'interval_recover'
  | 'interval_recovered'
  | 'final_interval'
  | 'periodic_checkin'
  | 'nasal_breathing'
  | 'session_complete';

export type CoachVerbosity = 'silent' | 'voice';

export interface CoachCue {
  kind: CoachCueKind;
  /** Spoken text if verbosity = voice */
  text?: string;
  /** Intent of the cue; `urgent` cues interrupt whatever the coach is saying. */
  tone?: 'rising' | 'falling' | 'steady' | 'urgent';
  /** Unix epoch ms */
  timestamp: number;
}

export interface CoachState {
  /** Are we currently inside the planned target zone? */
  inZone: boolean;
  /** Active interval index (0-based), -1 if none */
  activeInterval: number;
  /** Phase of the current interval */
  intervalPhase: 'idle' | 'warmup' | 'work' | 'recover' | 'done';
  lastCueAt: number;
  /** Cue throttle: avoid repeating the same kind within N ms */
  cueCooldownMs: number;
}

// ============================================================================
// Active run state
// ============================================================================

export type RunStatus = 'idle' | 'arming' | 'active' | 'paused' | 'finished';

export interface ActiveRunState {
  status: RunStatus;
  session: Session | null;
  started_at: number | null;
  paused_at: number | null;
  total_paused_ms: number;
  current_bpm: number | null;
  current_zone: ZoneNumber | null;
  distance_m: number;
  current_pace_sec_per_km: number | null;
  /** Live cumulative elevation gain (m) so far this run, GPS-based. */
  live_elevation_gain_m: number;
  /** Live cumulative elevation loss (m) so far this run. */
  live_elevation_loss_m: number;
  /** Most recent smoothed altitude reading (m), or null if no fix yet. */
  current_altitude_m: number | null;
  hr_samples: HRSample[];
  gps_points: GpsPoint[];
}

// ============================================================================
// Trends / Analytics
// ============================================================================

export interface MafDriftPoint {
  /** ISO week start date YYYY-MM-DD */
  weekStart: string;
  weekNumber: number; // 1..N
  /** Avg pace in seconds per km at HR 145-149 */
  pace_sec_per_km: number;
  /** Number of samples that contributed */
  sample_count: number;
}

/** Zone-2 minutes per week, bucketed from the earliest run's local day. */
export interface WeeklyZ2Point {
  weekStart: string;
  weekNumber: number;
  z2_minutes: number;
  total_minutes: number;
}

export interface BaselineRecord {
  /** Unix epoch ms */
  measured_at: number;
  /** Type of baseline */
  kind: 'resting_hr' | 'max_hr';
  bpm: number;
}

// ============================================================================
// Notifications
// ============================================================================

// ============================================================================
// HRV & Readiness
// ============================================================================

/** A single HRV measurement, computed from RR-intervals captured at rest. */
export interface HrvRecord {
  /** Unix epoch ms */
  measured_at: number;
  /** Root mean square of successive RR-interval differences, in milliseconds. */
  rmssd_ms: number;
  /** Mean HR during the measurement window, in bpm. */
  mean_hr: number;
  /** Number of valid RR samples used. */
  rr_count: number;
}

export type ReadinessLabel = 'low' | 'moderate' | 'good' | 'unknown';

/** Computed readiness for today, derived from HRV vs the user's baseline. */
export interface ReadinessScore {
  label: ReadinessLabel;
  /** Score 0-100, or null if no baseline exists yet. */
  score: number | null;
  /** Latest measurement that drove this score, if any. */
  latest: HrvRecord | null;
  /** Baseline rMSSD (geometric mean over a 7-day ln-space window; SD from 60 days). */
  baseline_rmssd_ms: number | null;
  /** Short coach copy: "ready to push" / "easy day" / etc. */
  coachText: string;
}

// ============================================================================
// Training load (TRIMP / CTL / ATL / TSB)
// ============================================================================

export interface TrainingLoadPoint {
  /** ISO date YYYY-MM-DD (UTC) — one entry per day. */
  date: string;
  /** Total TRIMP earned that day. */
  daily_trimp: number;
  /** Chronic training load (42-day EWMA of daily TRIMP). */
  ctl: number;
  /** Acute training load (7-day EWMA of daily TRIMP). */
  atl: number;
  /** Training stress balance / form: ctl - atl. Negative = fatigued. */
  tsb: number;
}

// ============================================================================
// Aerobic decoupling
// ============================================================================

export interface DecouplingResult {
  /** Pace/HR ratio of the first half of the run. */
  first_half_efficiency: number;
  /** Pace/HR ratio of the second half. */
  second_half_efficiency: number;
  /** Decoupling percentage. Positive = HR drifted up at constant pace. */
  decoupling_pct: number;
  /** True if the run was long/steady enough for the metric to be meaningful. */
  reliable: boolean;
}

/**
 * Decoupling persisted onto a run so the displayed value is stable across app
 * versions instead of being recomputed on every open. Carries the method
 * version + the trim/window parameters it was computed with, so a future method
 * change can trigger a one-time re-backfill.
 */
/**
 * Which max-HR value drives Karvonen zones + TRIMP/load. `estimate` is the
 * Tanaka age-prediction (the historical default), `measured` the latest max-HR
 * baseline, `manual` a user-entered value. The chosen value is applied to
 * profile.hrMax only on explicit selection — never silently.
 */
export type MaxHrSource = 'estimate' | 'measured' | 'manual';

export interface StoredDecoupling extends DecouplingResult {
  method_version: number;
  params: {
    warmup_trim_sec: number;
    min_duration_sec: number;
    min_distance_m: number;
    max_half_hr_delta: number;
  };
}

export interface DecouplingPoint {
  run_id: string;
  /** Unix epoch ms — when the run started. */
  started_at: number;
  decoupling_pct: number;
}

// ============================================================================
// VO2max / VDOT / race projections
// ============================================================================

export interface VdotResult {
  /** Daniels VDOT score (≈ VO2max). */
  vdot: number;
  /** The MAF pace (sec/km) used as input. */
  source_pace_sec_per_km: number;
  /** Date the underlying MAF pace came from. */
  source_date: string;
}

export interface RaceProjection {
  distance_m: number;
  /** Predicted finish time in seconds. */
  predicted_sec: number;
  /** Predicted pace in sec/km. */
  predicted_pace_sec_per_km: number;
}

// ============================================================================
// Mock HR generator
// ============================================================================

export interface MockHRConfig {
  /** Pattern of fake HR data */
  pattern: 'steady_z2' | 'drift_up' | 'intervals_4x4' | 'random_walk';
  baselineBpm: number;
  /** ms between samples */
  intervalMs: number;
}

// ============================================================================
// CO2 tolerance test
// ============================================================================

// CO2 tolerance test (single breath-hold after a deep nasal exhale)
export interface Co2Record {
  /** Unix epoch ms */
  measured_at: number;
  /** Hold duration in seconds */
  hold_sec: number;
}

// ============================================================================
// Run context / injury risk
// ============================================================================

export type RunSurface =
  | 'road'
  | 'trail'
  | 'track'
  | 'treadmill'
  | 'grass'
  | 'mixed';

export interface RunFuelingChecklist {
  hydrated_before: boolean;
  carried_fluids: boolean;
  took_fuel: boolean;
  post_run_refuel: boolean;
}

export interface RunContext {
  surface?: RunSurface;
  fueling?: RunFuelingChecklist;
  /** Short free-text niggle note, e.g. "left achilles". */
  niggle?: string;
}

/**
 * Structured post-run notes (Bug 5). Stored as JSON in the runs.notes column.
 * An untouched form serializes to null — never the old placeholder string.
 */
export type RunEnergy = 'low' | 'normal' | 'high';

export interface RunNotes {
  /** Subjective effort 1–10. */
  felt?: number | null;
  energy?: RunEnergy | null;
  /** Selected niggle chips (body areas), e.g. ['calf', 'left_achilles']. */
  niggles?: string[];
  conditions?: string;
}
