// SPDX-License-Identifier: GPL-3.0-or-later

import * as Location from 'expo-location';
import { router } from 'expo-router';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ElevationWidget } from '@/components/run/ElevationWidget';
import { LiveRunMap } from '@/components/run/LiveRunMap';
import {
  LiveCoachSection,
  LiveHeartRate,
  LiveIntervalSection,
  LiveStatsSection,
  LiveVoiceModeOverlay,
} from '@/components/run/LiveRunSections';
import { computeElapsedSec } from '@/components/run/liveRunHooks';
import { NotesEditor, serializeRunNotes } from '@/components/run/NotesEditor';
import { RunContextEditor } from '@/components/run/RunContextEditor';
import { RunControls } from '@/components/run/RunControls';
import { RunSummary } from '@/components/run/RunSummary';
import { RunTypePicker } from '@/components/run/RunTypePicker';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Pill';
import { Screen } from '@/components/ui/Screen';
import { useBleState, useBleStore } from '@/lib/ble/store';
import { mafWindowFromCeiling } from '@/lib/zones';
import {
  dispatchCue,
  resetVoicePipeline,
  speakCoachText,
  stopAllSpeech,
} from '@/lib/coach/audio';
import {
  computeTargetBand,
  evaluateSessionDirective,
  sessionPhaseAt,
  sessionTargetBand,
  voiceModeIntroText,
  VOICE_RESET_TEXT,
  type TargetBand,
} from '@/lib/coach/voiceMode';
import {
  runPhase,
  selectPsychCue,
  SIGNATURE_LINE_ID,
  type PsychSignal,
} from '@/lib/coach/psychCues';
import { createCoachEngine, type CoachEngine } from '@/lib/coach/engine';
import { vlog, vlogEndSession, vlogFlush, vlogStartSession } from '@/lib/coach/voiceLog';
import {
  type LiveGuardrailSample,
  DRIFT_BASELINE_END_MS,
} from '@/lib/coach/guardrails';
import { useZones } from '@/lib/hooks/useZones';
import { personalizedCadenceTarget } from '@/lib/metrics/cadence';
import { computeReadiness } from '@/lib/metrics/hrv';
import { injuryRiskWarnings } from '@/lib/metrics/injuryRisk';
import { averageCadence, computeRunTerrainMetrics } from '@/lib/metrics/terrain';
import {
  applyPerSplitElevation,
  computeElevationStats,
  elevationPerSplit,
} from '@/lib/metrics/elevation';
import { firePostRunSummary } from '@/lib/notifications/scheduler';
import { matchOrCreateRoute, routeWithRunStats } from '@/lib/route/matching';
import {
  runTypeLabel,
  sessionForRunType,
  type BriefVariantId,
  type RunTypeProfile,
} from '@/lib/run/runTypes';
import { useActiveRunStore } from '@/lib/run/store';
import { fetchRunWeather } from '@/lib/run/weather';
import {
  cadenceSource,
  isPlausibleRunningCadence,
  useLiveCadenceStore,
} from '@/lib/sensors/cadence';
import {
  getAllRoutes,
  getAllRuns,
  getAllHrv,
  getRunsForRoute,
  insertRoute,
  insertRunWithSamples,
} from '@/lib/storage/db';
import { updateRunNotes } from '@/lib/storage/notes';
import { useProfileStore } from '@/lib/storage/profile';
import { useSettingsStore } from '@/lib/storage/settings';
import { startRunKeepAlive, stopRunKeepAlive } from '@/modules/run-keepalive';
import type {
  BleConnectionState,
  CadenceSample,
  CoachCue,
  CompletedRun,
  GpsPoint,
  HRSample,
  RunContext,
  RunNotes,
  RunTypeId,
  RunWeather,
  Session,
} from '@/types';

const FASTED_THRESHOLD_MS = 4 * 60 * 60 * 1000;
// Fixes with a worse horizontal accuracy never enter the run track: a single
// 150 m multipath outlier both receives and emits a segment (~300 m phantom
// out-and-back), and the coarse Balanced seed fix added up to ~100 m before
// the first step. Matches route intelligence's reliable-accuracy bar.
const MAX_GPS_ACCURACY_M = 50;
/** Engine cues that still speak while Voice Mode owns the audio. */
const VOICE_MODE_STRUCTURAL_CUES: ReadonlySet<CoachCue['kind']> = new Set([
  'interval_warmup',
  'interval_start',
  'final_interval',
  'interval_recover',
  'session_complete',
]);
/** Bridge strap dropouts shorter than this with engine-only heartbeat ticks. */
const HR_DROPOUT_BRIDGE_MS = 60_000;
const LONG_RUN_MIN = 90;
const ASYNC_CUE_PROTECTION_MS = 20_000;
/** A finish still "in flight" after this long died; Stop works again. */
const FINISH_LOCK_MS = 5_000;

/** Idle-screen palette: OLED black, off-white text, muted small caps. */
const IDLE_BG = '#000000';
const IDLE_TEXT = '#f5f5f4';
const IDLE_MUTED = '#737373';
const IDLE_ACCENT = '#10b981';
const IDLE_ROW_BG = '#0a0a0a';

function strapStatus(state: BleConnectionState): { label: string; connected: boolean } {
  if (state === 'connected') return { label: 'HRM connected', connected: true };
  if (state === 'scanning' || state === 'connecting' || state === 'reconnecting') {
    return { label: 'Connecting strap', connected: false };
  }
  return { label: 'Connect strap', connected: false };
}

export default function RunScreen() {
  const status = useActiveRunStore((s) => s.status);
  const session = useActiveRunStore((s) => s.session);
  const startedAt = useActiveRunStore((s) => s.started_at);
  const totalPausedMs = useActiveRunStore((s) => s.total_paused_ms);
  // Fast-changing slices (current_bpm, distance, pace, gps/hr buffers, the
  // 1 Hz clock) are deliberately NOT subscribed here: this screen owns the
  // run's effects and timers, and re-rendering all of it several times a
  // second was the main source of live-run lag. Leaf sections in
  // components/run/LiveRunSections subscribe to what they paint.
  const armRun = useActiveRunStore((s) => s.armRun);
  const startRun = useActiveRunStore((s) => s.startRun);
  const pauseRun = useActiveRunStore((s) => s.pauseRun);
  const resumeRun = useActiveRunStore((s) => s.resumeRun);
  const pushSample = useActiveRunStore((s) => s.pushSample);
  const pushGps = useActiveRunStore((s) => s.pushGps);
  const finishRun = useActiveRunStore((s) => s.finishRun);
  const resetRun = useActiveRunStore((s) => s.reset);

  const profile = useProfileStore((s) => s.profile);
  const zonesView = useZones();
  const verbosity = useSettingsStore((s) => s.coachVerbosity);
  const setCoachVerbosity = useSettingsStore((s) => s.setCoachVerbosity);
  const nasalReminder = useSettingsStore((s) => s.nasalReminder);
  const cadenceTarget = useSettingsStore((s) => s.cadenceTarget);
  const fuelingReminders = useSettingsStore((s) => s.fuelingReminders);
  const fastedRunWarning = useSettingsStore((s) => s.fastedRunWarning);
  const screamModeEnabled = useSettingsStore((s) => s.screamModeEnabled);
  const screamThresholdBpm = useSettingsStore((s) => s.screamThresholdBpm);
  const lastMealAt = useSettingsStore((s) => s.lastMealAt);
  const setLastMealAt = useSettingsStore((s) => s.setLastMealAt);
  const lastRunType = useSettingsStore((s) => s.lastRunType);
  const setLastRunType = useSettingsStore((s) => s.setLastRunType);
  const lastBriefVariant = useSettingsStore((s) => s.lastBriefVariant);
  const setLastBriefVariant = useSettingsStore((s) => s.setLastBriefVariant);
  const lastBriefReps = useSettingsStore((s) => s.lastBriefReps);
  const setLastBriefReps = useSettingsStore((s) => s.setLastBriefReps);
  const cadenceCuesEnabled = useSettingsStore((s) => s.cadenceCoachingEnabled);
  const voiceModeBandZone = useSettingsStore((s) => s.voiceModeBandZone);
  const voiceModeBandWidthBpm = useSettingsStore((s) => s.voiceModeBandWidthBpm);
  const voiceModeHrCueIntervalSec = useSettingsStore((s) => s.voiceModeHrCueIntervalSec);
  const voiceModePsychCues = useSettingsStore((s) => s.voiceModePsychCues);

  const bleState = useBleState();
  // Cadence lives in refs + a tiny store: as component state it re-rendered
  // this entire screen about once a second.
  const cadenceRef = useRef<number | null>(null);

  // The armed session is built from the picker choice; long is the default.
  const todaysSession = useMemo<Session>(
    () =>
      sessionForRunType(lastRunType, profile, {
        variant: lastBriefVariant,
        reps: lastBriefReps,
      }),
    [lastRunType, lastBriefVariant, lastBriefReps, profile]
  );

  const [completedRun, setCompletedRun] = useState<CompletedRun | null>(null);
  const [pendingHrSamples, setPendingHrSamples] = useState<HRSample[]>([]);
  const [pendingGps, setPendingGps] = useState<GpsPoint[]>([]);
  const [pendingCadenceSamples, setPendingCadenceSamples] = useState<CadenceSample[]>([]);
  const [pendingNotes, setPendingNotes] = useState<RunNotes>({});
  const [pendingRunContext, setPendingRunContext] = useState<RunContext>({});
  const [isSavingRun, setIsSavingRun] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  // When the current finish started (null when none is in flight).
  const finishingRef = useRef<number | null>(null);
  // Read by LiveCoachSection on its own repaint; a ref so a new HR sample
  // doesn't re-render this whole screen.
  const guardrailSamplesRef = useRef<LiveGuardrailSample[]>([]);
  const [lastCoachCue, setLastCoachCue] = useState<CoachCue | null>(null);
  const lastCoachCueRef = useRef<CoachCue | null>(null);

  // Voice Mode (hands-free in-run coaching).
  const [voiceModeActive, setVoiceModeActive] = useState(false);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [lastSpoken, setLastSpoken] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const voiceModeActiveRef = useRef(false);
  const voiceMutedRef = useRef(false);
  const speakingRef = useRef(false);
  const voiceBandRef = useRef<TargetBand | null>(null);
  const psychCuesEnabledRef = useRef(true);
  // Per-run psych-cue memory (spec §3 anti-repetition) — reset on run start.
  const psychUsedLineIdsRef = useRef<Set<string>>(new Set());
  const psychLastCategoryRef = useRef<string | null>(null);
  const psychCategoryLastUsedAtRef = useRef<Map<string, number>>(new Map());
  const psychRecentTextsRef = useRef<string[]>([]);
  const psychSignatureUsedRef = useRef(false);
  // Psych-cue scheduler (spec §4 blending): slot ~30s after each HR cue,
  // hard 15s no-stack, 20s hold after resume, over-band reinforcement.
  const psychLastSpokenAtRef = useRef(0);
  const psychSlotAtRef = useRef<number | null>(null);
  const lastHrCueAtRef = useRef(0);
  // Voice Mode's serialized speak(), bound after it is defined below, so engine
  // cues that matter in Voice Mode go through the same single audio pipeline.
  const voiceSpeakRef = useRef<(text: string) => void>(() => {});
  // Last REAL strap sample, for bridging short dropouts with engine-only ticks.
  const lastRealHrRef = useRef<{ sample: HRSample; at: number } | null>(null);
  const voiceModeHrCueIntervalSecRef = useRef(30);
  const overBandReinforceAtRef = useRef<number | null>(null);
  const lastResumeAtRef = useRef(0);
  const postPauseCuePendingRef = useRef(false);

  const coachEngineRef = useRef<CoachEngine | null>(null);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  const lastSampleTsRef = useRef<number>(0);
  const cadenceSamplesRef = useRef<CadenceSample[]>([]);
  const lastCadenceSampleAtRef = useRef(0);
  const activeWeatherRef = useRef<RunWeather | null>(null);
  const beginRunInFlightRef = useRef(false);
  const savingRunRef = useRef(false);

  const cadenceTargetInfo = useMemo(
    () => personalizedCadenceTarget(getAllRuns(), cadenceTarget),
    [cadenceTarget]
  );
  const effectiveCadenceTarget = cadenceTargetInfo.target;

  const dispatchCoachCues = useCallback(
    (cues: CoachCue[]) => {
      const displayCue = pickPrimaryCue(cues);
      if (displayCue) {
        setLastCoachCue((current) => {
          const next = shouldReplaceDisplayedCue(current, displayCue);
          lastCoachCueRef.current = next;
          return next;
        });
      }
      // While Voice Mode is active it owns audio (band cues + psych cues), so
      // suppress the engine's spoken cues to avoid two voices talking over each
      // other. The visual cue above still updates behind the overlay.
      if (voiceModeActiveRef.current) {
        // Structural session cues (warm-up start/end, rep go/rest, last rep,
        // reps done, session complete) still speak in Voice Mode: the 30 s
        // band cue can't line up with 30 s reps. HR nags stay suppressed.
        for (const cue of cues) {
          if (!cue.text || !VOICE_MODE_STRUCTURAL_CUES.has(cue.kind)) continue;
          lastHrCueAtRef.current = Date.now(); // psych cues keep their distance
          voiceSpeakRef.current(cue.text);
        }
        return;
      }
      for (const cue of cues) {
        void dispatchCue(cue, verbosity);
      }
    },
    [verbosity]
  );

  // Wake lock during active run.
  useEffect(() => {
    if (status === 'active' || status === 'paused') {
      activateKeepAwakeAsync('basemile-run').catch(() => {});
      return () => {
        deactivateKeepAwake('basemile-run');
      };
    }
    return undefined;
  }, [status]);

  // Foreground service for the whole run: GPS, heart rate and voice cues keep
  // going with the screen off or another app in front.
  const runLive = status === 'active' || status === 'paused';
  useEffect(() => {
    if (!runLive) return undefined;
    const held = startRunKeepAlive('Run in progress', 'BaseMile is tracking your run.');
    vlog('keepalive.start', { held });
    return () => {
      stopRunKeepAlive();
      vlog('keepalive.stop');
    };
  }, [runLive]);

  // HR sample → store + coach engine. Latest-closure ref so the BLE
  // subscription below never has to be torn down for a settings change.
  const handleHrSampleRef = useRef<(sample: HRSample) => void>(() => {});
  handleHrSampleRef.current = (sample: HRSample) => {
    if (sample.timestamp === lastSampleTsRef.current) return;
    lastSampleTsRef.current = sample.timestamp;
    lastRealHrRef.current = { sample, at: Date.now() };

    const run = useActiveRunStore.getState();
    const elapsedMs =
      run.started_at === null ? 0 : Date.now() - run.started_at - run.total_paused_ms;
    if (run.started_at !== null) {
      // Updated before pushSample so the coach section's hr_count-driven
      // repaint already sees this sample.
      // Pin the [5,10]-min drift baseline; prune only the rolling recents.
      guardrailSamplesRef.current = [
        ...guardrailSamplesRef.current,
        { bpm: sample.bpm, elapsedMs },
      ].filter(
        (s) =>
          s.elapsedMs <= DRIFT_BASELINE_END_MS ||
          elapsedMs - s.elapsedMs <= 30 * 60_000
      );
    }

    pushSample(sample);

    if (run.started_at === null) return;
    const engine = coachEngineRef.current;
    if (!engine) return;
    const cues = engine.tick(
      sample,
      elapsedMs,
      cadenceCuesEnabled ? cadenceRef.current : null
    );
    dispatchCoachCues(cues);
  };

  // Subscribe to the strap imperatively instead of via useHeartRate(): a
  // hook subscription re-rendered this entire screen on every 1 Hz sample.
  // On (re)activation the latest sample is processed immediately, matching
  // the old effect which re-ran when status flipped to active.
  useEffect(() => {
    if (status !== 'active') return undefined;
    const initial = useBleStore.getState().lastSample;
    if (initial) handleHrSampleRef.current(initial);
    return useBleStore.subscribe((state, prev) => {
      if (state.lastSample !== prev.lastSample && state.lastSample) {
        handleHrSampleRef.current(state.lastSample);
      }
    });
  }, [status]);

  // Engine heartbeat: the coach engine only advances when a strap sample
  // arrives, so a strap dropout used to swallow rep boundaries and warm-up
  // end cues. While the last REAL sample is under a minute old, tick the
  // engine once a second with it (engine only, never recorded to the run).
  useEffect(() => {
    if (status !== 'active') return undefined;
    const id = setInterval(() => {
      const last = lastRealHrRef.current;
      const engine = coachEngineRef.current;
      const run = useActiveRunStore.getState();
      if (!last || !engine || run.started_at === null) return;
      const now = Date.now();
      const staleMs = now - last.at;
      if (staleMs < 2_000 || staleMs > HR_DROPOUT_BRIDGE_MS) return;
      const elapsedMs = now - run.started_at - run.total_paused_ms;
      const cues = engine.tick(
        { ...last.sample, timestamp: now },
        elapsedMs,
        cadenceCuesEnabled ? cadenceRef.current : null
      );
      dispatchCoachCues(cues);
    }, 1_000);
    return () => clearInterval(id);
  }, [status, cadenceCuesEnabled, dispatchCoachCues]);

  const stopLocation = useCallback(() => {
    if (locationSubRef.current) {
      locationSubRef.current.remove();
      locationSubRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (status !== 'active') return undefined;
    let cancelled = false;
    const onCadence = (value: number | null) => {
      if (cancelled) return;
      const valid = isPlausibleRunningCadence(value) ? value : null;
      cadenceRef.current = valid;
      useLiveCadenceStore.setState({ spm: valid });
      if (valid === null) return;
      const now = Date.now();
      if (now - lastCadenceSampleAtRef.current < 5000) return;
      lastCadenceSampleAtRef.current = now;
      cadenceSamplesRef.current = [
        ...cadenceSamplesRef.current,
        { timestamp: now, spm: valid },
      ];
    };
    cadenceSource.start(onCadence).catch(() => onCadence(null));
    return () => {
      cancelled = true;
      cadenceRef.current = null;
      useLiveCadenceStore.setState({ spm: null });
      void cadenceSource.stop();
    };
  }, [status]);

  // Location tracking for the run that started at `runStartedAt`. Runs after
  // the run is already live: the clock, HR and coach never wait on GPS.
  const attachLocation = useCallback(
    async (runStartedAt: number | null) => {
      const stillThisRun = () => {
        const run = useActiveRunStore.getState();
        return (
          run.started_at === runStartedAt &&
          (run.status === 'active' || run.status === 'paused')
        );
      };
      try {
        const { status: locStatus } = await Location.requestForegroundPermissionsAsync();
        if (!stillThisRun()) return;
        if (locStatus !== 'granted') {
          activeWeatherRef.current = unavailableWeather();
          Alert.alert(
            'Location permission needed',
            'GPS distance and pace require location access. Continuing without GPS.'
          );
          return;
        }
        let weatherRequested = false;
        const watchOptions: Location.LocationOptions = {
          accuracy: Location.Accuracy.BestForNavigation,
          distanceInterval: 5,
          timeInterval: 1000,
        };
        const onLocation = (loc: Location.LocationObject) => {
          if (!weatherRequested) {
            // Weather rides the first real fix, in the background.
            weatherRequested = true;
            void fetchRunWeather(loc.coords.latitude, loc.coords.longitude)
              .catch(() => unavailableWeather())
              .then((weather) => {
                if (stillThisRun()) activeWeatherRef.current = weather;
              });
          }
          if (
            loc.coords.accuracy != null &&
            loc.coords.accuracy > MAX_GPS_ACCURACY_M
          ) {
            return; // outlier fix: keep it out of distance, map and elevation
          }
          pushGps({
            timestamp: loc.timestamp,
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            altitude: loc.coords.altitude,
            altitudeAccuracy: loc.coords.altitudeAccuracy,
            speed: loc.coords.speed,
            accuracy: loc.coords.accuracy,
          });
        };
        let subscription: Location.LocationSubscription;
        try {
          subscription = await Location.watchPositionAsync(watchOptions, onLocation);
        } catch {
          // Declining Android's Location Accuracy prompt rejects the watch even
          // though GPS still works, so retry once without the prompt.
          if (!stillThisRun()) return;
          subscription = await Location.watchPositionAsync(
            { ...watchOptions, mayShowUserSettingsDialog: false },
            onLocation
          );
        }
        if (!stillThisRun()) {
          // Finished or discarded while the watch was starting.
          subscription.remove();
          return;
        }
        locationSubRef.current?.remove();
        locationSubRef.current = subscription;
      } catch {
        if (!stillThisRun()) return;
        Alert.alert(
          'Location unavailable',
          'Could not start GPS tracking. Continuing without distance and pace.'
        );
      }
    },
    [pushGps]
  );

  const beginRun = useCallback(() => {
    if (beginRunInFlightRef.current || useActiveRunStore.getState().status !== 'idle') {
      return;
    }
    beginRunInFlightRef.current = true;
    // The run is the black-box session: voice mode entries, Stop taps and JS
    // errors all land in one history that survives until the next run.
    vlogStartSession('run');
    guardrailSamplesRef.current = [];
    setLastCoachCue(null);
    lastCoachCueRef.current = null;
    cadenceSamplesRef.current = [];
    lastCadenceSampleAtRef.current = 0;
    activeWeatherRef.current = null;
    psychUsedLineIdsRef.current = new Set();
    psychLastCategoryRef.current = null;
    psychCategoryLastUsedAtRef.current = new Map();
    psychRecentTextsRef.current = [];
    psychSignatureUsedRef.current = false;
    // Treat run start as the last psych cue so the first one waits a full
    // spacing window instead of talking over the settle-in minutes.
    psychLastSpokenAtRef.current = Date.now();
    psychSlotAtRef.current = null;
    lastHrCueAtRef.current = 0;
    overBandReinforceAtRef.current = null;
    lastResumeAtRef.current = 0;
    postPauseCuePendingRef.current = false;
    armRun(todaysSession);

    {
      const hrvHistory = getAllHrv();
      const latest = hrvHistory[0] ?? null;
      const readiness = computeReadiness(latest, hrvHistory);
      coachEngineRef.current = createCoachEngine({
        session: todaysSession,
        verbosity,
        nasalReminder,
        profile,
        readiness,
        cadenceTarget: effectiveCadenceTarget,
        fuelingRemindersEnabled: fuelingReminders,
        screamModeEnabled,
        screamThresholdBpm,
      });
    }

    // The run is live on the tap. GPS (permission, first fix, weather) used to
    // be awaited first, which held Start for seconds with a weak signal.
    startRun();
    beginRunInFlightRef.current = false;
    void attachLocation(useActiveRunStore.getState().started_at);
  }, [
    armRun,
    attachLocation,
    todaysSession,
    startRun,
    verbosity,
    nasalReminder,
    profile,
    effectiveCadenceTarget,
    fuelingReminders,
    screamModeEnabled,
    screamThresholdBpm,
  ]);

  const handleStart = useCallback(() => {
    if (beginRunInFlightRef.current || useActiveRunStore.getState().status !== 'idle') {
      return;
    }
    const isLong = todaysSession.duration_min > LONG_RUN_MIN;
    const isFasted =
      lastMealAt === null || Date.now() - lastMealAt > FASTED_THRESHOLD_MS;
    if (fastedRunWarning && isLong && isFasted) {
      Alert.alert(
        'Fasted long run?',
        "You haven't logged a meal in the last 4 hours. Runs over 90 min fasted roughly double protein breakdown. Eat 40-60g carbs + 25-30g protein first.",
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'I just ate',
            onPress: () => {
              setLastMealAt(Date.now());
              beginRun();
            },
          },
          {
            text: 'Run anyway',
            style: 'destructive',
            onPress: () => {
              beginRun();
            },
          },
        ]
      );
      return;
    }
    beginRun();
  }, [todaysSession, lastMealAt, fastedRunWarning, setLastMealAt, beginRun]);

  const handlePause = useCallback(() => {
    pauseRun();
  }, [pauseRun]);

  const handleResume = useCallback(() => {
    resumeRun();
    // Spec §4.7: hold psych cues ~20s after any pause, then §2 allows one
    // no-guilt post-pause cue while the restart is fresh (<30s).
    lastResumeAtRef.current = Date.now();
    postPauseCuePendingRef.current = true;
  }, [resumeRun]);

  const completeStop = useCallback(() => {
    // A finish in flight owns the screen, but only briefly. The lock used to
    // be a plain flag: one throw before the summary opened left it set for
    // good, and every later Stop tap was silently ignored.
    const lockedAt = finishingRef.current;
    if (lockedAt !== null && Date.now() - lockedAt < FINISH_LOCK_MS) {
      vlog('stop.ignored', { lockAgeMs: Date.now() - lockedAt });
      return;
    }
    finishingRef.current = Date.now();
    vlog('stop.begin', {
      status: useActiveRunStore.getState().status,
      staleLock: lockedAt !== null,
    });
    beginRunInFlightRef.current = false;
    // Everything that makes noise or burns battery stops on the tap. None of
    // it may keep the run from ending, so each step is fenced.
    runStopStep('location', stopLocation);
    runStopStep('speech', stopAllSpeech);
    // Snapshot the volatile arrays before finishRun resets state.
    const samplesSnapshot = useActiveRunStore.getState().hr_samples;
    const gpsSnapshot = useActiveRunStore.getState().gps_points;
    const cadenceSnapshot = cadenceSamplesRef.current;
    const engine = coachEngineRef.current;
    coachEngineRef.current = null;
    if (engine && startedAt !== null) {
      const elapsedMs = Date.now() - startedAt - totalPausedMs;
      runStopStep('coach', () => dispatchCoachCues(engine.finish(elapsedMs)));
    }
    // finishRun stamps the end time now; it returns the run and resets the
    // live store, so the summary screen takes over immediately.
    let run: CompletedRun;
    try {
      run = finishRun();
    } catch (error) {
      vlog('stop.error', { step: 'finishRun', msg: errorMessage(error) });
      void vlogFlush('stop-error');
      finishingRef.current = null;
      Alert.alert('Could not finish the run', `${errorMessage(error)}\n\nTap Stop again.`);
      return;
    }
    setIsFinishing(true);

    // The terrain/elevation pass (~0.5 s on a phone) runs after the
    // "Finishing" frame paints, and can never strand the run: on any failure
    // the summary still opens with the base metrics.
    setTimeout(() => {
      let enhancedRun: CompletedRun = {
        ...run,
        weather: activeWeatherRef.current,
        pre_run_state: null,
      };
      try {
        const terrain = computeRunTerrainMetrics(
          gpsSnapshot,
          samplesSnapshot,
          cadenceSnapshot,
          mafWindowFromCeiling(profile.mafCeiling)
        );
        // Elevation is the single source of truth: ascent/descent + per-split
        // ascent/descent come from the same elevation engine (GPS-based here; a
        // later DEM correction recomputes all three together), so they reconcile.
        const gpsRecords = gpsSnapshot.map((p) => ({ ...p, run_id: run.id }));
        const elevStats = computeElevationStats(gpsRecords);
        const baseSplits = terrain.splits.length > 0 ? terrain.splits : run.splits;
        const splits = applyPerSplitElevation(baseSplits, elevationPerSplit(gpsRecords));
        enhancedRun = {
          ...enhancedRun,
          splits,
          avg_gap_sec_per_km: terrain.avg_gap_sec_per_km,
          maf_gap_pace_sec_per_km: terrain.maf_gap_pace_sec_per_km,
          ascent_m: Math.round(elevStats.total_gain_m),
          descent_m: Math.round(elevStats.total_loss_m),
          elevation: elevStats,
          avg_cadence_spm: averageCadence(cadenceSnapshot),
        };
      } catch {
        // Base metrics only; the launch backfill fills terrain in later.
      }
      setPendingHrSamples(samplesSnapshot);
      setPendingGps(gpsSnapshot);
      setPendingCadenceSamples(cadenceSnapshot);
      setPendingNotes({});
      setPendingRunContext({});
      savingRunRef.current = false;
      setIsSavingRun(false);
      setCompletedRun(enhancedRun);
      setIsFinishing(false);
      finishingRef.current = null;
      vlog('stop.done', { durationSec: enhancedRun.duration_sec });
      vlogEndSession('run-finished');
    }, 32);
  }, [
    stopLocation,
    finishRun,
    startedAt,
    totalPausedMs,
    dispatchCoachCues,
    profile.mafCeiling,
  ]);

  // RunControls asks for the second tap itself (no native Alert).
  const handleStop = completeStop;

  const handleSave = useCallback(() => {
    if (!completedRun || savingRunRef.current) return;
    savingRunRef.current = true;
    setIsSavingRun(true);
    // Let "Saving..." paint before the synchronous route match + inserts.
    // Through the ref so notes typed after the run opened are not lost.
    setTimeout(() => saveCompletedRunRef.current(), 32);
  }, [completedRun]);

  const saveCompletedRun = useCallback(() => {
    if (!completedRun) return;
    try {
      const runToSave: CompletedRun = {
        ...completedRun,
        context: normalizeRunContext(pendingRunContext),
      };
      const routeMatch = matchOrCreateRoute({
        runId: completedRun.id,
        runStartedAt: completedRun.started_at,
        distanceM: completedRun.distance_m,
        ascentM: completedRun.ascent_m ?? 0,
        points: pendingGps,
        existingRoutes: getAllRoutes(),
      });
      const routeRun = routeMatch
        ? { ...runToSave, route_id: routeMatch.route.id, lap_count: routeMatch.lapCount }
        : runToSave;
      insertRunWithSamples(routeRun, pendingHrSamples, pendingGps, pendingCadenceSamples);
      if (routeMatch) {
        const routeRuns = [
          routeRun,
          ...getRunsForRoute(routeMatch.route.id).filter((run) => run.id !== routeRun.id),
        ];
        insertRoute(routeWithRunStats(routeMatch.route, routeRuns));
      }
      const serializedNotes = serializeRunNotes(pendingNotes);
      if (serializedNotes !== null) {
        updateRunNotes(completedRun.id, serializedNotes);
      }
      void firePostRunSummary(routeRun);
      setCompletedRun(null);
      setPendingHrSamples([]);
      setPendingGps([]);
      setPendingCadenceSamples([]);
      setPendingNotes({});
      setPendingRunContext({});
      setLastCoachCue(null);
      lastCoachCueRef.current = null;
      resetRun();
      router.replace('/(tabs)/history');
    } catch (error) {
      savingRunRef.current = false;
      setIsSavingRun(false);
      const message = error instanceof Error ? error.message : 'Could not save this run.';
      Alert.alert('Save failed', message);
    }
  }, [
    completedRun,
    pendingHrSamples,
    pendingGps,
    pendingCadenceSamples,
    pendingNotes,
    pendingRunContext,
    resetRun,
  ]);

  const saveCompletedRunRef = useRef(saveCompletedRun);
  saveCompletedRunRef.current = saveCompletedRun;

  const handleDiscard = useCallback(() => {
    const discard = () => {
      setCompletedRun(null);
      setPendingHrSamples([]);
      setPendingGps([]);
      setPendingCadenceSamples([]);
      setPendingNotes({});
      setPendingRunContext({});
      setLastCoachCue(null);
      lastCoachCueRef.current = null;
      savingRunRef.current = false;
      setIsSavingRun(false);
      resetRun();
    };
    Alert.alert('Discard run?', 'This run will not be saved.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: discard,
      },
    ]);
  }, [resetRun]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      stopLocation();
      stopAllSpeech();
    };
  }, [stopLocation]);

  // ----- render branches ---------------------------------------------------
  const previousRunsForSummary = useMemo(() => {
    if (!completedRun) return [];
    return getAllRuns()
      .filter((r) => r.id !== completedRun.id && r.started_at < completedRun.started_at)
      .slice(0, 3);
  }, [completedRun]);

  const pendingRiskWarnings = useMemo(() => {
    if (!completedRun) return [];
    const runs = [completedRun, ...getAllRuns()];
    return injuryRiskWarnings({ runs });
  }, [completedRun]);

  // ---- Voice Mode: strict band cues + psych cues (the coach speaks, the runner listens) ----
  // Medium/brief carry their own %-of-max band; long keeps the settings band
  // (high end of the chosen zone — Z2/MAF by default).
  const voiceBand = useMemo(
    () =>
      sessionTargetBand(session) ??
      computeTargetBand(zonesView.zones, voiceModeBandZone, voiceModeBandWidthBpm),
    [session, zonesView.zones, voiceModeBandZone, voiceModeBandWidthBpm]
  );
  voiceModeActiveRef.current = voiceModeActive;
  voiceMutedRef.current = voiceMuted;
  voiceBandRef.current = voiceBand;
  psychCuesEnabledRef.current = voiceModePsychCues;
  voiceModeHrCueIntervalSecRef.current = voiceModeHrCueIntervalSec;

  const speak = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    setLastSpoken(trimmed);
    speakingRef.current = true;
    setIsSpeaking(true);
    try {
      // Watchdog: no cue may hold the pipeline longer than 30s. A wedged
      // network/audio await would otherwise leave speakingRef=true and mute
      // every later cue (the mid-run voice-death bug).
      await Promise.race([
        speakCoachText(trimmed, { interrupt: true }),
        new Promise<void>((resolve) => setTimeout(resolve, 30_000)),
      ]);
    } finally {
      speakingRef.current = false;
      setIsSpeaking(false);
    }
  }, []);
  voiceSpeakRef.current = (text: string) => {
    if (!voiceMutedRef.current) void speak(text);
  };

  const speakBandDirective = useCallback(() => {
    if (voiceMutedRef.current || speakingRef.current) return;
    const band = voiceBandRef.current;
    if (!band) return;
    const runState = useActiveRunStore.getState();
    const phase = sessionPhaseAt(
      runState.session,
      computeElapsedSec(runState.started_at, runState.paused_at, runState.total_paused_ms) * 1000
    );
    const directive = evaluateSessionDirective(runState.current_bpm, band, phase);

    // The HR band cue is authoritative and speaks unchanged. Psych cues ride
    // a separate scheduler: aim one at ~30s past this cue (±5s jitter, §4.2),
    // and when HR is over the ceiling let one arousal cue reinforce the
    // correction ~25s later (§4.6).
    const now = Date.now();
    lastHrCueAtRef.current = now;
    // Arm the psych slot at the MIDDLE of the HR-cue interval (±small jitter):
    // a fixed +30s slot landed exactly ON the next cue at the 30s interval the
    // user actually runs, so every slot was inside a no-stack window and not a
    // single psych cue could ever fire.
    const hrIntervalMs = Math.max(10, voiceModeHrCueIntervalSecRef.current) * 1000;
    const slotOffset = Math.min(30_000, Math.max(12_000, hrIntervalMs / 2));
    const jitter = Math.round((Math.random() - 0.5) * Math.min(10_000, hrIntervalMs / 6));
    psychSlotAtRef.current = now + slotOffset + jitter;
    overBandReinforceAtRef.current =
      directive.state === 'above' && psychCuesEnabledRef.current ? now + 25_000 : null;

    vlog('cue.band', { state: directive.state });
    void speak(directive.text);
  }, [speak]);

  // Spec §4 psych-cue scheduler. The 1s ticker only ever *skips* when a rule
  // blocks — the HR cue loop above is never delayed by it.
  const maybeSpeakPsychCue = useCallback(() => {
    if (!psychCuesEnabledRef.current || voiceMutedRef.current || speakingRef.current) return;
    const runState = useActiveRunStore.getState();
    if (runState.status !== 'active' || runState.started_at === null) return;
    const now = Date.now();

    // §4.7: hold psych cues ~20s after any pause/resume.
    if (lastResumeAtRef.current !== 0 && now - lastResumeAtRef.current < 20_000) return;

    // §4.3 no-stack, scaled to the interval: at 60s cues the guard is the
    // spec's 15s; at 30s cues it shrinks to 8s each side so a mid-window slot
    // exists (15s+15s consumed the entire 30s interval — zero psych cues).
    const hrIntervalMs = Math.max(10, voiceModeHrCueIntervalSecRef.current) * 1000;
    const noStackMs = Math.min(15_000, Math.max(6_000, hrIntervalMs / 2 - 7_000));
    const sinceHrCue = lastHrCueAtRef.current === 0 ? Infinity : now - lastHrCueAtRef.current;
    if (sinceHrCue < noStackMs) return;
    if (sinceHrCue !== Infinity) {
      if (hrIntervalMs - (sinceHrCue % hrIntervalMs) < noStackMs) return;
    }

    const elapsedMs = now - runState.started_at - runState.total_paused_ms;
    const plannedDurationMs = runState.session ? runState.session.duration_min * 60_000 : null;
    const phase = runPhase(elapsedMs, plannedDurationMs);

    // Signals kept deliberately cheap (§2 subset): post-pause restart and the
    // over-band arousal reinforcement. hr_drift maps to the over-ceiling case
    // — same arousal → narrow → reappraisal ordering.
    if (postPauseCuePendingRef.current && now - lastResumeAtRef.current >= 30_000) {
      postPauseCuePendingRef.current = false;
    }
    let signal: PsychSignal | null = postPauseCuePendingRef.current ? 'post_pause' : null;
    if (overBandReinforceAtRef.current !== null && now >= overBandReinforceAtRef.current) {
      signal = 'hr_drift';
    }

    if (signal === null) {
      // §4.4 cadence: one psych cue every ~3–4 min, ~2–2.5 min in the
      // doldrums/final push, spoken in the slot armed by the last HR cue.
      const minSpacingMs = phase === 'doldrums' || phase === 'final' ? 135_000 : 210_000;
      if (now - psychLastSpokenAtRef.current < minSpacingMs) return;
      const slotAt = psychSlotAtRef.current;
      if (slotAt === null || now < slotAt) return;
      if (now > slotAt + 90_000) {
        psychSlotAtRef.current = null; // stale slot — skip rather than pile up
        return;
      }
    }

    const line = selectPsychCue({
      elapsedMs,
      plannedDurationMs,
      signal,
      usedLineIds: psychUsedLineIdsRef.current,
      lastCategory: psychLastCategoryRef.current,
      categoryLastUsedAt: psychCategoryLastUsedAtRef.current,
      recentLineTexts: psychRecentTextsRef.current,
      signatureUsed: psychSignatureUsedRef.current,
    });

    // Consume the trigger/slot even when nothing eligible remains — a spent
    // bank must go quiet, not retry every second.
    if (signal === 'hr_drift') overBandReinforceAtRef.current = null;
    else if (signal === 'post_pause') postPauseCuePendingRef.current = false;
    else psychSlotAtRef.current = null;
    if (!line) return;

    psychUsedLineIdsRef.current.add(line.id);
    psychLastCategoryRef.current = line.category;
    psychCategoryLastUsedAtRef.current.set(line.category, elapsedMs);
    psychRecentTextsRef.current = [...psychRecentTextsRef.current.slice(-1), line.text];
    if (line.id === SIGNATURE_LINE_ID) psychSignatureUsedRef.current = true;
    psychLastSpokenAtRef.current = now;
    vlog('cue.psych', { id: line.id, cat: line.category });
    void speak(line.text);
  }, [speak]);

  // Deterministic strict-band HR cue on a fixed cadence.
  useEffect(() => {
    if (!voiceModeActive || status !== 'active') return undefined;
    speakBandDirective();
    const intervalMs = Math.max(10, voiceModeHrCueIntervalSec) * 1000;
    const id = setInterval(speakBandDirective, intervalMs);
    return () => clearInterval(id);
  }, [voiceModeActive, status, voiceModeHrCueIntervalSec, speakBandDirective]);

  // Psych-cue scheduler tick — cheap guard checks until a slot/signal is due.
  useEffect(() => {
    if (!voiceModeActive || status !== 'active') return undefined;
    const id = setInterval(maybeSpeakPsychCue, 1000);
    return () => clearInterval(id);
  }, [voiceModeActive, status, maybeSpeakPsychCue]);

  const enterVoiceMode = useCallback(() => {
    setVoiceMuted(false);
    // Scheduler timing restarts with the overlay; per-run anti-repetition
    // memory (used lines, category clocks) deliberately survives re-entry.
    lastHrCueAtRef.current = 0;
    psychSlotAtRef.current = null;
    overBandReinforceAtRef.current = null;
    setVoiceModeActive(true);
    vlog('voice.enter');
    void speak(voiceModeIntroText(voiceBand));
  }, [speak, voiceBand]);

  const handleResetVoice = useCallback(() => {
    vlog('voice.manual-reset');
    void vlogFlush('manual-reset');
    // Hard recovery for a stuck voice: stop speech, drop the queue and
    // immediately speak a confirmation so the runner gets instant feedback.
    resetVoicePipeline();
    speakingRef.current = false;
    setIsSpeaking(false);
    void speak(VOICE_RESET_TEXT);
  }, [speak]);

  const toggleVoiceMuted = useCallback(() => setVoiceMuted((m) => !m), []);

  const exitVoiceMode = useCallback(() => {
    setVoiceModeActive(false);
    stopAllSpeech();
    setLastSpoken(null);
    vlog('voice.exit');
    void vlogFlush('voice-exit');
  }, []);

  // Close the overlay automatically when the run ends.
  useEffect(() => {
    if (status !== 'active' && voiceModeActive) {
      setVoiceModeActive(false);
      vlog('voice.auto-exit', { status });
    }
  }, [status, voiceModeActive]);

  if (completedRun) {
    return (
      <Screen scroll>
        <Text className="text-text-primary text-3xl font-bold mb-4">Run complete</Text>
        <RunSummary
          run={completedRun}
          zones={zonesView.zones}
          samples={pendingHrSamples}
          previousRuns={previousRunsForSummary}
        />
        {pendingRiskWarnings.length > 0 ? (
          <View className="mt-6">
            <Text className="text-text-muted text-xs uppercase tracking-wider mb-2">
              Injury risk
            </Text>
            <View className="gap-3">
              {pendingRiskWarnings.map((warning) => (
                <Card key={warning.id} className={riskBorderClass(warning.severity)}>
                  <Text className="text-text-primary text-base font-semibold">
                    {warning.title}
                  </Text>
                  <Text className="text-text-secondary text-sm mt-1">
                    {warning.detail}
                  </Text>
                </Card>
              ))}
            </View>
          </View>
        ) : null}
        <View className="mt-6">
          <Text className="text-text-muted text-xs uppercase tracking-wider mb-2">
            Surface and fuel
          </Text>
          <RunContextEditor
            value={pendingRunContext}
            onChange={setPendingRunContext}
          />
        </View>
        <View className="mt-6">
          <Text className="text-text-muted text-xs uppercase tracking-wider mb-2">
            Notes
          </Text>
          <NotesEditor
            value={pendingNotes}
            onChange={setPendingNotes}
            onSave={() => Keyboard.dismiss()}
          />
        </View>
        <View className="mt-6 gap-3">
          <Button
            title={isSavingRun ? 'Saving...' : 'Save & Done'}
            onPress={handleSave}
            variant="primary"
            size="xl"
            disabled={isSavingRun}
          />
          <Button title="Discard" onPress={handleDiscard} variant="secondary" size="lg" />
        </View>
      </Screen>
    );
  }

  if (isFinishing || status === 'finished') {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center gap-3">
          <ActivityIndicator size="large" color="#9CA3AF" />
          <Text className="text-text-secondary text-base">Finishing your run...</Text>
        </View>
      </Screen>
    );
  }

  if (status === 'idle' || status === 'arming') {
    return (
      <IdleView
        profile={profile}
        runType={lastRunType}
        onRunTypeChange={setLastRunType}
        briefVariant={lastBriefVariant}
        onBriefVariantChange={setLastBriefVariant}
        briefReps={lastBriefReps}
        onBriefRepsChange={setLastBriefReps}
        bleState={bleState}
        starting={status === 'arming' || beginRunInFlightRef.current}
        onStart={handleStart}
      />
    );
  }

  return (
    <Screen scroll>
      <View className="flex-1 gap-3">
        {session ? (
          <View className="flex-row flex-wrap items-center gap-1.5">
            <Pill label={runTypeLabel(session.run_type).toUpperCase()} />
            <Pill label={`Target Z${session.target_zone}`} />
            {session.hr_ceiling > 0 ? <Pill label={`Ceiling ${session.hr_ceiling}`} /> : null}
          </View>
        ) : null}

        {/* Primary vitals: heart rate + zone position. */}
        <LiveHeartRate />

        <LiveCoachSection
          lastCoachCue={lastCoachCue}
          guardrailSamplesRef={guardrailSamplesRef}
          strapConnected={bleState === 'connected'}
          verbosity={verbosity}
          onVerbosityChange={setCoachVerbosity}
        />

        <Button
          title="🎙  Voice Mode"
          onPress={enterVoiceMode}
          variant="secondary"
          size="md"
        />

        <LiveIntervalSection />

        {/* Live metrics: pace/distance/cadence/time + elevation. */}
        <View className="gap-2">
          <LiveStatsSection
            cadenceTarget={effectiveCadenceTarget}
            cadenceTargetLabel={
              cadenceTargetInfo.measuring
                ? 'measuring baseline'
                : `target ${effectiveCadenceTarget}`
            }
          />
          <ElevationWidget />
        </View>

        <LiveRunMap height={200} />

        {/* Run controls anchored at the bottom of the live screen. */}
        <RunControls
          status={status}
          onPause={handlePause}
          onResume={handleResume}
          onStop={handleStop}
        />
      </View>

      <LiveVoiceModeOverlay
        visible={voiceModeActive && status === 'active'}
        band={voiceBand}
        paused={status === 'paused'}
        lastSpoken={lastSpoken}
        muted={voiceMuted}
        isSpeaking={isSpeaking}
        onExit={exitVoiceMode}
        onToggleMute={toggleVoiceMuted}
        onResetVoice={handleResetVoice}
        onPause={handlePause}
        onResume={handleResume}
        onStop={handleStop}
      />
    </Screen>
  );
}

interface IdleViewProps {
  profile: RunTypeProfile;
  runType: RunTypeId;
  onRunTypeChange: (id: RunTypeId) => void;
  briefVariant: BriefVariantId;
  onBriefVariantChange: (id: BriefVariantId) => void;
  briefReps: number;
  onBriefRepsChange: (reps: number) => void;
  bleState: BleConnectionState;
  starting: boolean;
  onStart: () => void;
}

/**
 * Pre-run screen: heading, run type picker, strap status, and one big
 * Start button pinned above the tab bar in thumb reach.
 */
function IdleView({
  profile,
  runType,
  onRunTypeChange,
  briefVariant,
  onBriefVariantChange,
  briefReps,
  onBriefRepsChange,
  bleState,
  starting,
  onStart,
}: IdleViewProps) {
  const insets = useSafeAreaInsets();
  const strap = strapStatus(bleState);

  return (
    <View
      className="flex-1"
      style={{
        backgroundColor: IDLE_BG,
        paddingTop: insets.top + 12,
        paddingLeft: insets.left + 16,
        paddingRight: insets.right + 16,
      }}
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <Text
          className="text-3xl font-bold mb-4"
          style={{ color: IDLE_TEXT, letterSpacing: -0.5 }}
          accessibilityRole="header"
        >
          Choose your run
        </Text>

        <RunTypePicker
          value={runType}
          onChange={onRunTypeChange}
          briefVariant={briefVariant}
          onBriefVariantChange={onBriefVariantChange}
          briefReps={briefReps}
          onBriefRepsChange={onBriefRepsChange}
          profile={profile}
          disabled={starting}
        />

        <Pressable
          onPress={strap.connected ? undefined : openStrapSettings}
          disabled={strap.connected}
          accessibilityRole={strap.connected ? 'text' : 'button'}
          accessibilityLabel={strap.label}
          className="mt-5 flex-row items-center rounded-xl border border-bg-border px-4 active:opacity-80"
          style={{ height: 52, gap: 10, backgroundColor: IDLE_ROW_BG }}
        >
          <Ionicons
            name={strap.connected ? 'heart' : 'bluetooth'}
            size={18}
            color={strap.connected ? IDLE_ACCENT : IDLE_MUTED}
          />
          <Text className="flex-1 text-[15px] font-semibold" style={{ color: IDLE_TEXT }}>
            {strap.label}
          </Text>
          {strap.connected ? (
            <View
              style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: IDLE_ACCENT }}
            />
          ) : (
            <Ionicons name="chevron-forward" size={16} color={IDLE_MUTED} />
          )}
        </Pressable>

      </ScrollView>

      <View style={{ paddingTop: 8, paddingBottom: 12 }}>
        <Pressable
          onPress={onStart}
          disabled={starting}
          accessibilityRole="button"
          accessibilityLabel="Start run"
          accessibilityState={{ disabled: starting, busy: starting }}
          className="items-center justify-center rounded-2xl active:opacity-80"
          style={{ height: 64, backgroundColor: IDLE_ACCENT, opacity: starting ? 0.5 : 1 }}
        >
          <Text style={{ color: '#000', fontSize: 19, fontWeight: '800', letterSpacing: 0.3 }}>
            {starting ? 'Starting...' : 'Start run'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function openStrapSettings(): void {
  router.push('/(tabs)/settings');
}

function normalizeRunContext(context: RunContext): RunContext | undefined {
  const niggle = context.niggle?.trim();
  const next: RunContext = {
    ...(context.surface ? { surface: context.surface } : {}),
    ...(context.fueling ? { fueling: context.fueling } : {}),
    ...(niggle ? { niggle } : {}),
  };
  return Object.keys(next).length > 0 ? next : undefined;
}

function pickPrimaryCue(cues: readonly CoachCue[]): CoachCue | null {
  let selected: CoachCue | null = null;
  let selectedScore = -1;
  for (const cue of cues) {
    const score = cuePriority(cue);
    if (score > selectedScore) {
      selected = cue;
      selectedScore = score;
    }
  }
  return selected;
}

function shouldReplaceDisplayedCue(
  current: CoachCue | null,
  next: CoachCue,
  now = Date.now()
): CoachCue {
  if (!current) return next;
  if (now - current.timestamp > ASYNC_CUE_PROTECTION_MS) return next;
  return cuePriority(next) >= cuePriority(current) ? next : current;
}

function cuePriority(cue: CoachCue): number {
  switch (cue.kind) {
    case 'zone_exceeded':
      return 100;
    case 'final_interval':
    case 'interval_push':
    case 'interval_start':
      return 90;
    case 'interval_recover':
    case 'interval_recovered':
      return 85;
    case 'early_too_fast':
    case 'hr_drift':
    case 'maf_buffer':
      return 80;
    case 'zone_recovered':
      return 70;
    case 'nasal_breathing':
      return 40;
    case 'interval_warmup':
      return 35;
    case 'periodic_checkin':
      return 30;
    case 'session_complete':
      return 20;
  }
}

function riskBorderClass(severity: 'info' | 'warning' | 'danger'): string {
  if (severity === 'danger') return 'border border-zone-z5';
  if (severity === 'warning') return 'border border-zone-z4';
  return 'border border-zone-z3';
}

function unavailableWeather(): RunWeather {
  return {
    temp_c: null,
    humidity_pct: null,
    wind_kmh: null,
    weather_code: null,
    captured_at: Date.now(),
    source: 'unavailable',
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One shutdown step of Stop: a failure is logged, never allowed to block the finish. */
function runStopStep(step: string, fn: () => void): void {
  try {
    fn();
  } catch (error) {
    vlog('stop.step-error', { step, msg: errorMessage(error) });
  }
}
