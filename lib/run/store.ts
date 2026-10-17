// SPDX-License-Identifier: GPL-3.0-or-later

import { create } from 'zustand';

import { vlog } from '@/lib/coach/voiceLog';
import {
  liveElevationStep,
  type LiveElevationState,
} from '@/lib/metrics/elevation';
import { mafPaceFromSamples, recoveryHRDrop } from '@/lib/metrics/maf';
import { aggregateZoneDistribution } from '@/lib/metrics/zones';
import { useProfileStore } from '@/lib/storage/profile';
import { classifyHR, mafWindowFromCeiling } from '@/lib/zones';
import type {
  ActiveRunState,
  CompletedRun,
  GpsPoint,
  HRSample,
  Session,
  SplitMetric,
} from '@/types';

import {
  accumulateDistance,
  haversineMeters,
  paceFromPoints,
  splitsFromPoints,
} from './distance';

const PACE_WINDOW_MS = 30_000;

interface ActiveRunActions {
  armRun: (session: Session | null) => void;
  startRun: () => void;
  pauseRun: () => void;
  resumeRun: () => void;
  pushSample: (sample: HRSample) => void;
  pushGps: (point: GpsPoint) => void;
  finishRun: () => CompletedRun;
  reset: () => void;
}

/**
 * Sample-buffer counters. `hr_samples` and `gps_points` are append-only
 * buffers that are mutated IN PLACE while a run is active (copying a 3-4k
 * element array on every 1 Hz push was O(n^2) over a run and churned the GC).
 * Their references therefore do not change per push: components that must
 * react to a new sample subscribe to these counters instead of the arrays.
 * Every arm/reset/finish swaps in fresh arrays, so a snapshot taken from
 * `getState()` before `finishRun()` is never mutated afterwards.
 */
interface ActiveRunCounters {
  hr_count: number;
  gps_count: number;
}

export type ActiveRunStore = ActiveRunState & ActiveRunCounters & ActiveRunActions;

type ActiveRunData = ActiveRunState & ActiveRunCounters;

const INITIAL_STATE: Omit<ActiveRunData, 'hr_samples' | 'gps_points'> = {
  status: 'idle',
  session: null,
  started_at: null,
  paused_at: null,
  total_paused_ms: 0,
  current_bpm: null,
  current_zone: null,
  distance_m: 0,
  current_pace_sec_per_km: null,
  live_elevation_gain_m: 0,
  live_elevation_loss_m: 0,
  current_altitude_m: null,
  hr_count: 0,
  gps_count: 0,
};

/** Fresh initial state with brand-new (never shared) sample buffers. */
const initialState = (): ActiveRunData => ({
  ...INITIAL_STATE,
  hr_samples: [],
  gps_points: [],
});

const seedElevationState = (): LiveElevationState => ({
  gain: 0,
  loss: 0,
  lastAlt: null,
});

/**
 * Module-scope accumulator for the live elevation reducer. Kept outside the
 * zustand state (it is internal bookkeeping, not rendered) and reset whenever a
 * run is armed, reset, or finished so each run starts at 0. The store's public
 * `live_elevation_*` fields are derived from it on every `pushGps`.
 */
let liveElevationState: LiveElevationState = seedElevationState();

/**
 * Timestamp of the most recent resume, module-scoped like the elevation
 * accumulator. `pushGps` uses it to avoid chaining the first post-resume fix to
 * the last pre-pause one — movement while paused must not count as distance
 * (every downstream engine already drops that segment via 30s gap guards).
 */
let lastResumeAt = 0;

/** Completed pause intervals for the active run (epoch ms), module-scoped. */
let pauseIntervals: { start: number; end: number }[] = [];

export const useActiveRunStore = create<ActiveRunStore>((set, get) => ({
  ...initialState(),

  armRun: (session) => {
    liveElevationState = seedElevationState();
    lastResumeAt = 0;
    pauseIntervals = [];
    set({ ...initialState(), status: 'arming', session });
  },

  startRun: () => {
    const { status } = get();
    if (status !== 'arming' && status !== 'idle') return;
    lastResumeAt = 0;
    pauseIntervals = [];
    set({
      status: 'active',
      started_at: Date.now(),
      paused_at: null,
      total_paused_ms: 0,
    });
  },

  pauseRun: () => {
    const { status } = get();
    if (status !== 'active') return;
    set({ status: 'paused', paused_at: Date.now() });
  },

  resumeRun: () => {
    const { status, paused_at, total_paused_ms } = get();
    if (status !== 'paused' || paused_at === null) return;
    lastResumeAt = Date.now();
    pauseIntervals.push({ start: paused_at, end: lastResumeAt });
    set({
      status: 'active',
      paused_at: null,
      total_paused_ms: total_paused_ms + (Date.now() - paused_at),
    });
  },

  pushSample: (sample) => {
    const { status, hr_samples } = get();
    if (status !== 'active') return;
    const profile = useProfileStore.getState().profile;
    const zone = classifyHR(sample.bpm, profile.zones);
    hr_samples.push(sample);
    set({
      hr_count: hr_samples.length,
      current_bpm: sample.bpm,
      current_zone: zone,
    });
  },

  pushGps: (point) => {
    const { status, gps_points, distance_m } = get();
    if (status !== 'active') return;
    const prev = gps_points[gps_points.length - 1];
    // Re-baseline across a pause: only chain the segment when the previous fix
    // belongs to the current active stretch, so pause displacement adds 0 m.
    const chained = prev !== undefined && prev.timestamp >= lastResumeAt;
    const nextDistance = chained
      ? distance_m + haversineMeters(prev, point)
      : distance_m;
    gps_points.push(point);
    const pace = paceFromPoints(gps_points, PACE_WINDOW_MS);

    // Stream the incoming altitude through the pure 1Hz reducer. A null/non-
    // finite reading is a no-op inside liveElevationStep, so the counters and
    // last altitude simply hold. `current_altitude_m` mirrors the reference
    // altitude the reducer is tracking (null until the first usable fix).
    liveElevationState = liveElevationStep(
      liveElevationState,
      point.altitude ?? null
    );

    set({
      gps_count: gps_points.length,
      distance_m: nextDistance,
      current_pace_sec_per_km: pace,
      live_elevation_gain_m: liveElevationState.gain,
      live_elevation_loss_m: liveElevationState.loss,
      current_altitude_m: liveElevationState.lastAlt,
    });
  },

  finishRun: () => {
    const state = get();
    const startedAt = state.started_at ?? Date.now();
    const endedAt = Date.now();
    // Stop is available while paused, so fold the still-open pause segment in —
    // otherwise time spent on the paused summary screen inflates duration and
    // every per-duration metric (avg pace, TRIMP, weekly minutes).
    const openPauseMs =
      state.status === 'paused' && state.paused_at !== null
        ? Math.max(0, endedAt - state.paused_at)
        : 0;
    if (openPauseMs > 0 && state.paused_at !== null) {
      pauseIntervals.push({ start: state.paused_at, end: endedAt });
    }
    const runPauses = pauseIntervals;
    const durationSec = Math.max(
      0,
      Math.round((endedAt - startedAt - state.total_paused_ms - openPauseMs) / 1000)
    );

    const { hr_samples, gps_points, session } = state;

    // Every derived metric is fenced: Stop must always end the run, so odd
    // sample data costs at most that one metric, never the finish itself.
    const { avgHr, maxHr } = safeMetric('hr', () => computeHrStats(hr_samples), {
      avgHr: 0,
      maxHr: 0,
    });
    const distance_m = safeMetric(
      'distance',
      () => (state.distance_m > 0 ? state.distance_m : accumulateDistance(gps_points)),
      Math.max(0, state.distance_m)
    );
    const avgPace =
      distance_m > 0 ? durationSec / (distance_m / 1000) : 0;

    const profile = useProfileStore.getState().profile;
    // Same aggregator the launch-time recompute uses (lib/metrics/zones) so the
    // value shown at save can't silently change on the next app start — the
    // store previously had its own copy with a different >30s-gap policy.
    const zoneDistribution = safeMetric(
      'zones',
      () => aggregateZoneDistribution(hr_samples, profile.zones, runPauses),
      { z1_sec: 0, z2_sec: 0, z3_sec: 0, z4_sec: 0, z5_sec: 0 }
    );
    const splits: SplitMetric[] = safeMetric(
      'splits',
      () => splitsFromPoints(gps_points, hr_samples),
      []
    );
    const mafPace = safeMetric(
      'maf',
      () => mafPaceFromSamples(hr_samples, gps_points, mafWindowFromCeiling(profile.mafCeiling)),
      null
    );
    const recoveryDrop = safeMetric('recovery', () => computeRecoveryDrop(state, endedAt), null);

    const id = `run-${startedAt}`;
    const completed: CompletedRun = {
      id,
      started_at: startedAt,
      ended_at: endedAt,
      session_id: null,
      type: session?.run_type ?? 'long',
      duration_sec: durationSec,
      distance_m,
      avg_hr: avgHr,
      max_hr: maxHr,
      avg_pace_sec_per_km: Math.round(avgPace),
      maf_pace_sec_per_km: mafPace,
      zone_distribution: zoneDistribution,
      splits,
      // Ceiling in effect at save time, so later recomputes (GAP migrations,
      // backfills) evaluate this run against ITS window, not today's — a
      // birthday or adjustment change must not rewrite historical MAF-GAP.
      maf_ceiling: profile.mafCeiling,
      ...(runPauses.length > 0 ? { pause_intervals: runPauses } : {}),
      ...(recoveryDrop !== null ? { recovery_hr_drop: recoveryDrop } : {}),
    };

    liveElevationState = seedElevationState();
    pauseIntervals = [];
    set({ ...initialState(), status: 'finished' });
    return completed;
  },

  reset: () => {
    liveElevationState = seedElevationState();
    lastResumeAt = 0;
    pauseIntervals = [];
    set({ ...initialState() });
  },
}));

function computeHrStats(samples: HRSample[]): { avgHr: number; maxHr: number } {
  if (samples.length === 0) return { avgHr: 0, maxHr: 0 };
  let sum = 0;
  let max = 0;
  for (const s of samples) {
    sum += s.bpm;
    if (s.bpm > max) max = s.bpm;
  }
  return { avgHr: Math.round(sum / samples.length), maxHr: max };
}

/**
 * For interval sessions only: peak HR during the final work block minus HR
 * ~60s after the work block ended. The work-end timestamp is approximated as
 * the timestamp of the global max HR in the second half of the run.
 */
/** Runs one finish-time metric; a throw is logged and replaced by `fallback`. */
function safeMetric<T>(label: string, compute: () => T, fallback: T): T {
  try {
    return compute();
  } catch (error) {
    vlog('finish.metric-error', {
      metric: label,
      msg: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}

function computeRecoveryDrop(state: ActiveRunState, endedAt: number): number | null {
  const session = state.session;
  if (!session?.intervals) return null;
  const samples = state.hr_samples;
  if (samples.length < 5) return null;

  const startedAt = state.started_at ?? endedAt;
  const halfMs = startedAt + (endedAt - startedAt) / 2;

  let peakBpm = 0;
  let peakTs = 0;
  for (const s of samples) {
    if (s.timestamp < halfMs) continue;
    // >= so a plateau anchors at its END (closest to when work stopped) —
    // anchoring at the first plateau sample measured "recovery" while still
    // working, yielding drop ≈ 0 which the UI then hides entirely.
    if (s.bpm >= peakBpm) {
      peakBpm = s.bpm;
      peakTs = s.timestamp;
    }
  }
  if (peakBpm === 0) return null;

  const after = samples.filter((s) => s.timestamp >= peakTs);
  const drop = recoveryHRDrop(after, peakBpm, peakTs);
  return drop === null ? null : Math.round(drop);
}
