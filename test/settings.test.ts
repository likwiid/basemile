// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import {
  migrateSettingsState,
  SETTINGS_DEFAULTS,
  SETTINGS_STORAGE_VERSION,
} from '@/lib/storage/settings';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

describe('settings defaults and migration', () => {
  it('defaults cadence coaching off and carries no AI keys', () => {
    expect(SETTINGS_STORAGE_VERSION).toBe(12);
    expect(SETTINGS_DEFAULTS.maxHrSource).toBe('estimate');
    expect(SETTINGS_DEFAULTS.maxHrManual).toBeNull();
    expect(SETTINGS_DEFAULTS.cadenceCoachingEnabled).toBe(false);
    expect(SETTINGS_DEFAULTS.cadenceTarget).toBe(170);
    expect(Object.keys(SETTINGS_DEFAULTS).some((k) => /ai/i.test(k))).toBe(false);
  });

  it('defaults voice mode to a strict Z2 high-end band', () => {
    expect(SETTINGS_DEFAULTS.voiceModeBandZone).toBe(2);
    expect(SETTINGS_DEFAULTS.voiceModeBandWidthBpm).toBe(6);
    expect(SETTINGS_DEFAULTS.voiceModeHrCueIntervalSec).toBe(30);
    expect(SETTINGS_DEFAULTS.voiceModePsychCues).toBe(true);
  });

  it('carries no speech-recognition or device-voice keys', () => {
    const keys = Object.keys(SETTINGS_DEFAULTS);
    expect(keys.some((k) => /listen|wake|voiceid|speechrate/i.test(k))).toBe(false);
  });

  it('strips the removed listening, metronome and device-voice keys from a persisted v11 blob', () => {
    const migrated = migrateSettingsState({
      voiceModePsychCues: false,
      voiceModeListenMode: 'wake',
      voiceModeWakeWord: 'coach',
      voiceModeWakeWordEnabled: true,
      voiceModeVoiceId: 'en-us-x-iol-network',
      voiceModeSpeechRate: 1.1,
      nasalMetronome: true,
    }) as Record<string, unknown>;

    expect(migrated.voiceModePsychCues).toBe(false);
    for (const key of [
      'voiceModeListenMode',
      'voiceModeWakeWord',
      'voiceModeWakeWordEnabled',
      'voiceModeVoiceId',
      'voiceModeSpeechRate',
      'nasalMetronome',
    ]) {
      expect(key in migrated).toBe(false);
    }
  });

  it("maps the retired 'tones' verbosity onto the spoken voice", () => {
    expect(migrateSettingsState({ coachVerbosity: 'tones' }).coachVerbosity).toBe('voice');
    expect(migrateSettingsState({ coachVerbosity: 'voice' }).coachVerbosity).toBe('voice');
    expect(migrateSettingsState({ coachVerbosity: 'silent' }).coachVerbosity).toBe('silent');
    expect(migrateSettingsState({}).coachVerbosity).toBe('voice');
  });

  it('backfills new settings without overwriting existing stored choices', () => {
    const migrated = migrateSettingsState({
      coachVerbosity: 'silent',
      nasalReminder: true,
      cadenceTarget: 174,
      fuelingReminders: false,
    });

    expect(migrated.coachVerbosity).toBe('silent');
    expect(migrated.nasalReminder).toBe(true);
    expect(migrated.cadenceTarget).toBe(174);
    expect(migrated.fuelingReminders).toBe(false);
    expect(migrated.cadenceCoachingEnabled).toBe(false);
  });

  it('strips the removed AI keys from a persisted v10 blob', () => {
    const migrated = migrateSettingsState({
      cadenceCoachingEnabled: true,
      aiRunCheckInsEnabled: false,
      aiRunCheckInIntervalMinutes: 8,
      manualAITalkEnabled: false,
      aiCoachAutoRead: true,
      voiceModeAINarration: true,
      voiceModeAINarrationIntervalMin: 2,
    }) as Record<string, unknown>;

    expect(migrated.cadenceCoachingEnabled).toBe(true);
    for (const key of [
      'aiRunCheckInsEnabled',
      'aiRunCheckInIntervalMinutes',
      'manualAITalkEnabled',
      'aiCoachAutoRead',
      'voiceModeAINarration',
      'voiceModeAINarrationIntervalMin',
    ]) {
      expect(key in migrated).toBe(false);
    }
  });
});
