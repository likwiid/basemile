// SPDX-License-Identifier: GPL-3.0-or-later

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { STORAGE_KEYS } from '@/config/constants';
import { setOnlineLookupsEnabled } from '@/lib/config/lookups';
import {
  DEFAULT_BRIEF_VARIANT,
  DEFAULT_HIIT_REPS,
  DEFAULT_RUN_TYPE,
  type BriefVariantId,
} from '@/lib/run/runTypes';
import type {
  CoachVerbosity,
  MaxHrSource,
  RunTypeId,
  ZoneNumber,
} from '@/types';

interface SettingsState {
  coachVerbosity: CoachVerbosity;
  // Which max-HR value drives zones + TRIMP. Applied to profile.hrMax only on
  // explicit selection; never auto-overwritten.
  maxHrSource: MaxHrSource;
  maxHrManual: number | null;
  nasalReminder: boolean;
  cadenceCoachingEnabled: boolean;
  useMockHR: boolean;
  screamModeEnabled: boolean;
  screamThresholdBpm: number;
  cadenceTarget: number;
  fuelingReminders: boolean;
  lastMealAt: number | null;
  fastedRunWarning: boolean;
  // Pre-run picker memory: the last chosen run type and brief variant.
  lastRunType: RunTypeId;
  lastBriefVariant: BriefVariantId;
  lastBriefReps: number;
  // Voice Mode (hands-free in-run coaching)
  voiceModeBandZone: ZoneNumber;
  voiceModeBandWidthBpm: number;
  voiceModeHrCueIntervalSec: number;
  voiceModePsychCues: boolean;
  // Weather and terrain elevation lookups (Open-Meteo). Off = no run
  // coordinates leave the device for these.
  onlineLookups: boolean;
  setCoachVerbosity: (v: CoachVerbosity) => void;
  setMaxHrSource: (s: MaxHrSource) => void;
  setMaxHrManual: (n: number | null) => void;
  setNasalReminder: (on: boolean) => void;
  setCadenceCoachingEnabled: (on: boolean) => void;
  setUseMockHR: (on: boolean) => void;
  setScreamModeEnabled: (on: boolean) => void;
  setScreamThresholdBpm: (n: number) => void;
  setCadenceTarget: (n: number) => void;
  setFuelingReminders: (on: boolean) => void;
  setLastMealAt: (ms: number | null) => void;
  setFastedRunWarning: (on: boolean) => void;
  setLastRunType: (id: RunTypeId) => void;
  setLastBriefVariant: (id: BriefVariantId) => void;
  setLastBriefReps: (n: number) => void;
  setVoiceModeBandZone: (z: ZoneNumber) => void;
  setVoiceModeBandWidthBpm: (n: number) => void;
  setVoiceModeHrCueIntervalSec: (n: number) => void;
  setVoiceModePsychCues: (on: boolean) => void;
  setOnlineLookups: (on: boolean) => void;
}

export const SETTINGS_DEFAULTS = {
  coachVerbosity: 'voice' as CoachVerbosity,
  // Default to the historical Tanaka estimate so zones are unchanged until the
  // athlete explicitly picks a different max-HR source.
  maxHrSource: 'estimate' as MaxHrSource,
  maxHrManual: null as number | null,
  nasalReminder: false,
  cadenceCoachingEnabled: false,
  useMockHR: false,
  screamModeEnabled: true,
  screamThresholdBpm: 5,
  cadenceTarget: 170,
  fuelingReminders: true,
  lastMealAt: null as number | null,
  fastedRunWarning: true,
  lastRunType: DEFAULT_RUN_TYPE,
  lastBriefVariant: DEFAULT_BRIEF_VARIANT,
  lastBriefReps: DEFAULT_HIIT_REPS,
  voiceModeBandZone: 2 as ZoneNumber,
  voiceModeBandWidthBpm: 6,
  voiceModeHrCueIntervalSec: 30,
  voiceModePsychCues: true,
  onlineLookups: true,
};

// v9: dropped voiceModeVoiceId/voiceModeSpeechRate (retired voice picker).
// v10: added maxHrSource/maxHrManual (which max-HR value drives zones + TRIMP).
// v11: keys of retired features (in-run check-ins, narration, strides) are
// stripped from the blob; added lastRunType/lastBriefVariant/lastBriefReps for
// the pre-run picker.
// v12: listen mode, wake word and the spoken breathing metronome were retired
// and are stripped, along with v9 leftovers that were never actually deleted
// from old blobs; the old 'tones' verbosity becomes 'voice'.
// onlineLookups (added later) needs no migration: a missing key takes its
// default through the persist merge.
export const SETTINGS_STORAGE_VERSION = 12;

const DROPPED_KEYS = [
  'aiCoachAutoRead',
  'aiRunCheckInsEnabled',
  'aiRunCheckInIntervalMinutes',
  'manualAITalkEnabled',
  'voiceModeAINarration',
  'voiceModeAINarrationIntervalMin',
  'includeStridesByDefault',
  'voiceModeListenMode',
  'voiceModeWakeWord',
  'voiceModeWakeWordEnabled',
  'voiceModeVoiceId',
  'voiceModeSpeechRate',
  'nasalMetronome',
] as const;

export function migrateSettingsState(persisted: unknown): Partial<SettingsState> {
  const prior: Partial<SettingsState> & Record<string, unknown> =
    persisted !== null && typeof persisted === 'object'
      ? { ...(persisted as Partial<SettingsState>) }
      : {};
  for (const key of DROPPED_KEYS) delete prior[key];

  return {
    ...SETTINGS_DEFAULTS,
    ...prior,
    // Only 'silent' survives as-is; 'voice', the retired 'tones' and a
    // missing value all mean the coach speaks.
    coachVerbosity: (prior.coachVerbosity as string | undefined) === 'silent' ? 'silent' : 'voice',
    cadenceCoachingEnabled:
      prior.cadenceCoachingEnabled ??
      SETTINGS_DEFAULTS.cadenceCoachingEnabled,
    cadenceTarget:
      prior.cadenceTarget ?? SETTINGS_DEFAULTS.cadenceTarget,
    fuelingReminders:
      prior.fuelingReminders ?? SETTINGS_DEFAULTS.fuelingReminders,
    lastMealAt: prior.lastMealAt ?? SETTINGS_DEFAULTS.lastMealAt,
    fastedRunWarning:
      prior.fastedRunWarning ?? SETTINGS_DEFAULTS.fastedRunWarning,
    voiceModeBandZone:
      prior.voiceModeBandZone ?? SETTINGS_DEFAULTS.voiceModeBandZone,
    voiceModeBandWidthBpm:
      prior.voiceModeBandWidthBpm ?? SETTINGS_DEFAULTS.voiceModeBandWidthBpm,
    voiceModeHrCueIntervalSec:
      prior.voiceModeHrCueIntervalSec ??
      SETTINGS_DEFAULTS.voiceModeHrCueIntervalSec,
    voiceModePsychCues:
      prior.voiceModePsychCues ?? SETTINGS_DEFAULTS.voiceModePsychCues,
  };
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...SETTINGS_DEFAULTS,
      setCoachVerbosity: (coachVerbosity) => set({ coachVerbosity }),
      setMaxHrSource: (maxHrSource) => set({ maxHrSource }),
      setMaxHrManual: (maxHrManual) => set({ maxHrManual }),
      setNasalReminder: (nasalReminder) => set({ nasalReminder }),
      setCadenceCoachingEnabled: (cadenceCoachingEnabled) =>
        set({ cadenceCoachingEnabled }),
      setUseMockHR: (useMockHR) => set({ useMockHR }),
      setScreamModeEnabled: (screamModeEnabled) => set({ screamModeEnabled }),
      setScreamThresholdBpm: (screamThresholdBpm) => set({ screamThresholdBpm }),
      setCadenceTarget: (cadenceTarget) => set({ cadenceTarget }),
      setFuelingReminders: (fuelingReminders) => set({ fuelingReminders }),
      setLastMealAt: (lastMealAt) => set({ lastMealAt }),
      setFastedRunWarning: (fastedRunWarning) => set({ fastedRunWarning }),
      setLastRunType: (lastRunType) => set({ lastRunType }),
      setLastBriefVariant: (lastBriefVariant) => set({ lastBriefVariant }),
      setLastBriefReps: (lastBriefReps) => set({ lastBriefReps }),
      setVoiceModeBandZone: (voiceModeBandZone) => set({ voiceModeBandZone }),
      setVoiceModeBandWidthBpm: (voiceModeBandWidthBpm) =>
        set({ voiceModeBandWidthBpm }),
      setVoiceModeHrCueIntervalSec: (voiceModeHrCueIntervalSec) =>
        set({ voiceModeHrCueIntervalSec }),
      setVoiceModePsychCues: (voiceModePsychCues) => set({ voiceModePsychCues }),
      setOnlineLookups: (onlineLookups) => set({ onlineLookups }),
    }),
    {
      name: STORAGE_KEYS.SETTINGS,
      storage: createJSONStorage(() => AsyncStorage),
      version: SETTINGS_STORAGE_VERSION,
      migrate: (persisted) =>
        migrateSettingsState(persisted) as unknown as SettingsState,
    }
  )
);

// Keep the fetch-side flag in step with the stored preference (including after
// hydration and a reset).
setOnlineLookupsEnabled(useSettingsStore.getState().onlineLookups);
useSettingsStore.subscribe((state) => setOnlineLookupsEnabled(state.onlineLookups));
