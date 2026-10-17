// SPDX-License-Identifier: GPL-3.0-or-later

import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { type ComponentProps, type ReactNode, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  Switch,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useShallow } from 'zustand/shallow';

import { PairingModal } from '@/components/ble/PairingModal';
import { BaselineTestModal } from '@/components/settings/BaselineTestModal';
import { Co2TestModal } from '@/components/settings/Co2TestModal';
import { HrvTestModal } from '@/components/settings/HrvTestModal';
import { MaxHRTestModal } from '@/components/settings/MaxHRTestModal';
import { MaxHrSourcePicker } from '@/components/settings/MaxHrSourcePicker';
import { SettingRow } from '@/components/settings/SettingRow';
import { Card } from '@/components/ui/Card';
import { OpenMeteoCredit } from '@/components/ui/OpenMeteoCredit';
import { Screen } from '@/components/ui/Screen';
import { bleManager } from '@/lib/ble/manager';
import { useBleStore } from '@/lib/ble/store';
import { useNotificationStore } from '@/lib/notifications/store';
import { useActiveRunStore } from '@/lib/run/store';
import { recomputeAllRunZoneDistributions, resetDb } from '@/lib/storage/db';
import { useProfileStore } from '@/lib/storage/profile';
import { SETTINGS_DEFAULTS, useSettingsStore } from '@/lib/storage/settings';
import { speakCoachText } from '@/lib/coach/audio';
import { profilePatchForAge } from '@/lib/metrics/maxHr';
import { computeZonesFromKarvonen, zoneConfigsEqual, zoneLabel } from '@/lib/zones';
import type {
  CoachVerbosity,
  UserProfile,
  ZoneConfig,
  ZoneNumber,
  ZoneRange,
} from '@/types';

const VERBOSITIES: readonly CoachVerbosity[] = ['silent', 'voice'];
const VERBOSITY_LABELS: Record<CoachVerbosity, string> = {
  silent: 'Silent',
  voice: 'Voice',
};

type ActionTone = 'primary' | 'secondary' | 'danger';
type IoniconName = ComponentProps<typeof Ionicons>['name'];

function SettingSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <View className="mt-4">
      <View className="mb-2 px-1">
        <Text className="text-text-primary text-base font-semibold">{title}</Text>
        {subtitle ? (
          <Text className="text-text-muted text-xs leading-4 mt-0.5">{subtitle}</Text>
        ) : null}
      </View>
      <Card className="rounded-xl p-2.5 border border-bg-border">{children}</Card>
    </View>
  );
}

function CollapsibleSettingSection({
  title,
  subtitle,
  children,
  defaultExpanded = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <View className="mt-4">
      <Card className="rounded-xl p-0 overflow-hidden border border-bg-border">
        <Pressable
          onPress={() => setExpanded((value) => !value)}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          className="min-h-14 px-3 py-3 flex-row items-center justify-between gap-3 active:opacity-75"
        >
          <View className="flex-1">
            <Text className="text-text-primary text-base font-semibold">{title}</Text>
            {subtitle ? (
              <Text className="text-text-muted text-xs leading-4 mt-0.5">{subtitle}</Text>
            ) : null}
          </View>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color="#a8a8a8"
          />
        </Pressable>
        {expanded ? <View className="px-3 pb-3 pt-1">{children}</View> : null}
      </Card>
    </View>
  );
}

function SubsectionLabel({ children }: { children: ReactNode }) {
  return (
    <Text className="text-text-muted text-[10px] uppercase tracking-wider font-semibold mt-3 mb-1">
      {children}
    </Text>
  );
}

const SOURCE_URL = 'https://github.com/likwiid/basemile';

function InlineNote({ children }: { children: ReactNode }) {
  return <Text className="text-text-secondary text-xs leading-5">{children}</Text>;
}

function ActionGroup({ children }: { children: ReactNode }) {
  return (
    <View
      className="flex-row flex-wrap items-center gap-2"
      style={{ alignSelf: 'flex-start' }}
    >
      {children}
    </View>
  );
}

function SettingsAction({
  title,
  onPress,
  tone = 'secondary',
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  tone?: ActionTone;
  disabled?: boolean;
}) {
  const bgClass =
    tone === 'primary'
      ? 'bg-accent border-accent'
      : tone === 'danger'
        ? 'bg-zone-z5/15 border-zone-z5/60'
        : 'bg-bg-elevated border-bg-border';
  const textClass =
    tone === 'primary'
      ? 'text-black'
      : tone === 'danger'
        ? 'text-zone-z5'
        : 'text-text-primary';
  const widthClass = tone === 'primary' ? 'w-36' : '';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={{ alignSelf: 'flex-start' }}
      className={`h-11 min-w-20 px-3 rounded-lg border items-center justify-center ${widthClass} ${
        disabled ? 'opacity-40' : 'active:opacity-75'
      } ${bgClass}`}
    >
      <Text className={`${textClass} text-sm font-semibold`}>{title}</Text>
    </Pressable>
  );
}

function SetupRow({
  icon,
  title,
  description,
  children,
  showBorder = true,
}: {
  icon: IoniconName;
  title: string;
  description: string;
  children: ReactNode;
  showBorder?: boolean;
}) {
  return (
    <View className={`py-3 ${showBorder ? 'border-b border-bg-border' : ''}`}>
      <View className="flex-row items-start gap-3">
        <View className="w-9 h-9 rounded-full bg-accent/15 items-center justify-center">
          <Ionicons name={icon} size={18} color="#10b981" />
        </View>
        <View className="flex-1">
          <Text className="text-text-primary text-base font-semibold">{title}</Text>
          <Text className="text-text-secondary text-xs leading-5 mt-0.5">
            {description}
          </Text>
          <View className="mt-3">{children}</View>
        </View>
      </View>
    </View>
  );
}

function CollapsiblePanel({
  title,
  subtitle,
  children,
  defaultExpanded = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <View className="mt-3 border-t border-bg-border pt-1">
      <Pressable
        onPress={() => setExpanded((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        className="min-h-11 py-2 flex-row items-center justify-between gap-3 active:opacity-75"
      >
        <View className="flex-1">
          <Text className="text-text-primary text-sm font-semibold">{title}</Text>
          {subtitle ? (
            <Text className="text-text-muted text-xs leading-4 mt-0.5">{subtitle}</Text>
          ) : null}
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={17}
          color="#737373"
        />
      </Pressable>
      {expanded ? <View className="pb-1">{children}</View> : null}
    </View>
  );
}

interface NumberInputProps {
  value: number;
  onChange: (n: number) => void;
  suffix?: string;
  compact?: boolean;
  /**
   * Keystrokes only update the visible text; the value is committed once,
   * when editing ends (submit, end editing or blur), and only if it changed.
   * Use for fields whose onChange triggers store writes or heavy work.
   */
  commitOnEnd?: boolean;
}

function isValidNumberInput(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

function NumberField({
  value,
  onChange,
  suffix,
  compact = false,
  commitOnEnd = false,
}: NumberInputProps) {
  const [text, setText] = useState(String(value));
  // Latest typed text and last committed value, so submit + end editing + blur
  // (which can all fire for one edit) commit at most once.
  const textRef = useRef(text);
  const committedRef = useRef(value);
  useEffect(() => {
    textRef.current = String(value);
    committedRef.current = value;
    setText(String(value));
  }, [value]);

  const commit = () => {
    const n = Number(textRef.current);
    if (!isValidNumberInput(n)) {
      textRef.current = String(value);
      setText(String(value));
      return;
    }
    if (n === committedRef.current) return;
    committedRef.current = n;
    onChange(n);
  };

  return (
    <View className="flex-row items-center gap-2">
      <TextInput
        value={text}
        onChangeText={(next) => {
          textRef.current = next;
          setText(next);
          if (commitOnEnd) return;
          const n = Number(next);
          if (isValidNumberInput(n)) onChange(n);
        }}
        onSubmitEditing={commitOnEnd ? commit : undefined}
        onBlur={commitOnEnd ? commit : undefined}
        onEndEditing={() => {
          if (commitOnEnd) {
            commit();
            return;
          }
          const n = Number(text);
          if (isValidNumberInput(n)) onChange(n);
          else setText(String(value));
        }}
        keyboardType="number-pad"
        className={`bg-bg-elevated text-text-primary text-sm px-3 h-10 rounded-lg text-right ${
          compact ? 'w-20' : 'min-w-20'
        }`}
      />
      {suffix ? <Text className="text-text-secondary text-xs">{suffix}</Text> : null}
    </View>
  );
}

interface TimeFieldProps {
  value: string;
  onChange: (next: string) => void;
}

function TimeField({ value, onChange }: TimeFieldProps) {
  const [text, setText] = useState(value);
  useEffect(() => {
    setText(value);
  }, [value]);
  return (
    <TextInput
      value={text}
      onChangeText={(next) => {
        setText(next);
        if (/^\d{2}:\d{2}$/.test(next)) onChange(next);
      }}
      onEndEditing={() => {
        const ok = /^\d{2}:\d{2}$/.test(text);
        if (ok) onChange(text);
        else setText(value);
      }}
      placeholder="HH:MM"
      placeholderTextColor="#525252"
      className="bg-bg-elevated text-text-primary text-sm px-3 h-10 rounded-lg min-w-24 text-center"
    />
  );
}

interface VerbosityPickerProps {
  value: CoachVerbosity;
  onChange: (v: CoachVerbosity) => void;
}

function VerbosityPicker({ value, onChange }: VerbosityPickerProps) {
  return (
    <View className="flex-row gap-1 bg-bg-elevated rounded-lg p-1 self-start">
      {VERBOSITIES.map((v) => {
        const active = v === value;
        return (
          <Pressable
            key={v}
            onPress={() => onChange(v)}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            className={`px-3 h-10 rounded-md justify-center ${
              active ? 'bg-accent' : ''
            }`}
          >
            <Text
              className={`text-xs font-semibold ${
                active ? 'text-black' : 'text-text-secondary'
              }`}
            >
              {VERBOSITY_LABELS[v]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const VOICE_ZONES: ZoneNumber[] = [1, 2, 3, 4, 5];

function ZonePicker({ value, onChange }: { value: ZoneNumber; onChange: (z: ZoneNumber) => void }) {
  return (
    <View className="flex-row gap-1 bg-bg-elevated rounded-lg p-1 self-start">
      {VOICE_ZONES.map((z) => {
        const active = z === value;
        return (
          <Pressable
            key={z}
            onPress={() => onChange(z)}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            className={`px-3 h-10 rounded-md justify-center ${active ? 'bg-accent' : ''}`}
          >
            <Text
              className={`text-xs font-semibold ${active ? 'text-black' : 'text-text-secondary'}`}
            >
              Z{z}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

interface MafStepperProps {
  value: number;
  onChange: (n: number) => void;
}

function MafStepper({ value, onChange }: MafStepperProps) {
  const dec = () => onChange(Math.max(-10, value - 1));
  const inc = () => onChange(Math.min(5, value + 1));
  return (
    <View className="flex-row items-center gap-2">
      <Pressable
        onPress={dec}
        accessibilityRole="button"
        accessibilityLabel="Decrease MAF adjustment"
        className="w-11 h-11 rounded-lg bg-bg-elevated items-center justify-center active:opacity-75"
      >
        <Text className="text-text-primary text-2xl">−</Text>
      </Pressable>
      <Text className="text-text-primary text-base font-bold min-w-9 text-center">
        {value > 0 ? `+${value}` : String(value)}
      </Text>
      <Pressable
        onPress={inc}
        accessibilityRole="button"
        accessibilityLabel="Increase MAF adjustment"
        className="w-11 h-11 rounded-lg bg-bg-elevated items-center justify-center active:opacity-75"
      >
        <Text className="text-text-primary text-2xl">+</Text>
      </Pressable>
    </View>
  );
}

const ZONE_NUMBERS: readonly ZoneNumber[] = [1, 2, 3, 4, 5];

let pendingZoneRecompute: ReturnType<typeof setTimeout> | null = null;

/**
 * Re-aggregates every run's zone distribution (reads every stored HR sample,
 * synchronously) on the next tick, so the committed field and the new zones
 * paint before the JS thread blocks. Back-to-back edits coalesce into one pass
 * with the latest zones.
 */
function scheduleZoneRecompute(zones: ZoneConfig): void {
  if (pendingZoneRecompute !== null) clearTimeout(pendingZoneRecompute);
  pendingZoneRecompute = setTimeout(() => {
    pendingZoneRecompute = null;
    recomputeAllRunZoneDistributions(zones);
  }, 0);
}

function updateZoneRange(
  zones: ZoneConfig,
  zone: ZoneNumber,
  index: 0 | 1,
  value: number
): ZoneConfig {
  const key = `z${zone}` as const;
  const current = zones[key];
  const nextRange: ZoneRange =
    index === 0 ? [value, current[1]] : [current[0], value];
  return { ...zones, [key]: nextRange };
}

function ZoneSettingsCard({
  profile,
  onChange,
  onRecalculate,
}: {
  profile: UserProfile;
  onChange: (zones: ZoneConfig) => void;
  onRecalculate: (zones: ZoneConfig) => void;
}) {
  const { width } = useWindowDimensions();
  const stackRows = width < 430;
  const recalculate = () => {
    onRecalculate(
      computeZonesFromKarvonen(
        profile.hrMax,
        profile.hrRest,
        profile.mafCeiling
      )
    );
  };

  return (
    <View>
      <Text className="text-text-secondary text-xs leading-5 mb-2">
        Karvonen HR reserve zones. Z2 is hard-capped at your MAF ceiling of{' '}
        {profile.mafCeiling} bpm.
      </Text>
      {ZONE_NUMBERS.map((zone) => {
        const key = `z${zone}` as const;
        const range = profile.zones[key];
        return (
          <View
            key={zone}
            className={`py-2 min-h-11 border-b border-bg-border ${
              stackRows ? 'gap-2' : 'flex-row items-center justify-between gap-3'
            }`}
          >
            <Text
              className={`text-text-primary text-sm font-semibold ${
                stackRows ? '' : 'flex-1'
              }`}
            >
              {zoneLabel(zone)}
            </Text>
            <View className="flex-row items-center gap-2">
              <NumberField
                commitOnEnd
                value={range[0]}
                onChange={(n) => onChange(updateZoneRange(profile.zones, zone, 0, n))}
                compact
              />
              <Text className="text-text-muted">to</Text>
              <NumberField
                commitOnEnd
                value={range[1]}
                onChange={(n) => onChange(updateZoneRange(profile.zones, zone, 1, n))}
                suffix="bpm"
                compact
              />
            </View>
          </View>
        );
      })}
      <View className="mt-3 items-start">
        <SettingsAction
          title="Recalculate zones"
          onPress={recalculate}
        />
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const profile = useProfileStore((s) => s.profile);
  const updateProfile = useProfileStore((s) => s.update);
  const setMafAdjustment = useProfileStore((s) => s.setMafAdjustment);
  const mafAdjustment = useProfileStore((s) => s.mafAdjustment);
  const resetProfile = useProfileStore((s) => s.reset);

  // Only the fields this screen renders: run-tab writes (last meal, last run
  // type, brief picks) must not repaint Settings.
  const settings = useSettingsStore(
    useShallow((s) => ({
      coachVerbosity: s.coachVerbosity,
      setCoachVerbosity: s.setCoachVerbosity,
      nasalReminder: s.nasalReminder,
      setNasalReminder: s.setNasalReminder,
      cadenceCoachingEnabled: s.cadenceCoachingEnabled,
      setCadenceCoachingEnabled: s.setCadenceCoachingEnabled,
      cadenceTarget: s.cadenceTarget,
      setCadenceTarget: s.setCadenceTarget,
      fuelingReminders: s.fuelingReminders,
      setFuelingReminders: s.setFuelingReminders,
      fastedRunWarning: s.fastedRunWarning,
      setFastedRunWarning: s.setFastedRunWarning,
      screamModeEnabled: s.screamModeEnabled,
      setScreamModeEnabled: s.setScreamModeEnabled,
      voiceModeBandZone: s.voiceModeBandZone,
      setVoiceModeBandZone: s.setVoiceModeBandZone,
      voiceModeBandWidthBpm: s.voiceModeBandWidthBpm,
      setVoiceModeBandWidthBpm: s.setVoiceModeBandWidthBpm,
      voiceModeHrCueIntervalSec: s.voiceModeHrCueIntervalSec,
      setVoiceModeHrCueIntervalSec: s.setVoiceModeHrCueIntervalSec,
      voiceModePsychCues: s.voiceModePsychCues,
      setVoiceModePsychCues: s.setVoiceModePsychCues,
      useMockHR: s.useMockHR,
      setUseMockHR: s.setUseMockHR,
      onlineLookups: s.onlineLookups,
      setOnlineLookups: s.setOnlineLookups,
      maxHrSource: s.maxHrSource,
    }))
  );

  const [restingTestVisible, setRestingTestVisible] = useState(false);
  const [maxTestVisible, setMaxTestVisible] = useState(false);
  const [hrvTestVisible, setHrvTestVisible] = useState(false);
  const [co2TestVisible, setCo2TestVisible] = useState(false);
  const [pairingVisible, setPairingVisible] = useState(false);
  const [dataRefreshKey, setDataRefreshKey] = useState(0);

  const version = Constants.expoConfig?.version ?? '0.1.0';
  // Manual edits skip the store write and the run re-aggregation when the
  // committed bounds match what is already saved. Recalculate always
  // re-aggregates: run distributions can lag zones that were re-derived
  // elsewhere (age, MAF adjustment, max HR source).
  const applyZones = (zones: ZoneConfig, force = false) => {
    const changed = !zoneConfigsEqual(useProfileStore.getState().profile.zones, zones);
    if (changed) updateProfile({ zones });
    if (changed || force) scheduleZoneRecompute(zones);
  };
  const recalculateZones = (zones: ZoneConfig) => applyZones(zones, true);

  const executeResetAll = async () => {
    resetDb();
    resetProfile();
    useSettingsStore.setState(SETTINGS_DEFAULTS);
    useNotificationStore.setState({
      permissionStatus: 'unknown',
      scheduledIds: [],
    });
    useActiveRunStore.getState().reset();
    await bleManager.unpair();
    useBleStore.getState().reset();
    setDataRefreshKey((key) => key + 1);
  };

  const onResetAll = () => {
    Alert.alert(
      'Reset all data?',
      'This wipes runs, baselines, settings, notifications, and resets your profile. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            void executeResetAll();
          },
        },
      ]
    );
  };

  return (
    <Screen scroll>
      <View className="gap-1 mb-2">
        <Text className="text-text-primary text-3xl font-semibold">Settings</Text>
        <Text className="text-text-secondary text-sm leading-5">
          Start with heart targets, coach style, and your strap. Everything else stays
          close by when you need it.
        </Text>
      </View>

      <SettingSection
        title="Start here"
        subtitle="The few choices that make runs feel accurate right away."
      >
        <SetupRow
          icon="heart"
          title="Heart targets"
          description={`Resting ${profile.hrRest} bpm, max ${profile.hrMax} bpm, MAF ceiling ${profile.mafCeiling} bpm.`}
        >
          <ActionGroup>
            <SettingsAction title="Resting HR" onPress={() => setRestingTestVisible(true)} />
            <SettingsAction title="Max HR" onPress={() => setMaxTestVisible(true)} />
          </ActionGroup>
        </SetupRow>
        <SetupRow
          icon="volume-high"
          title="Coach voice"
          description="Pick whether the coach stays quiet or speaks during runs."
        >
          <VerbosityPicker
            value={settings.coachVerbosity}
            onChange={settings.setCoachVerbosity}
          />
        </SetupRow>
        <SetupRow
          icon="watch"
          title="Heart rate strap"
          description="Pair or update your Bluetooth heart rate strap before workouts."
          showBorder={false}
        >
          <ActionGroup>
            <SettingsAction
              title="Manage strap"
              tone="primary"
              onPress={() => setPairingVisible(true)}
            />
          </ActionGroup>
        </SetupRow>
      </SettingSection>

      <SettingSection
        title="Max HR source"
        subtitle="Your profile max is an age estimate. If it disagrees with a measured test or your observed peak, choose which value drives zones and training load."
      >
        <MaxHrSourcePicker key={dataRefreshKey} />
      </SettingSection>

      <SettingSection
        title="Profile"
        subtitle="Personal details used for training targets and daily defaults."
      >
        <SettingRow label="Name">
          <Text className="text-text-secondary text-base">{profile.name}</Text>
        </SettingRow>
        <SettingRow label="Age">
          <NumberField
            commitOnEnd
            value={profile.age}
            onChange={(age) => updateProfile(profilePatchForAge(age, settings.maxHrSource))}
            suffix="yrs"
          />
        </SettingRow>
        <SettingRow label="Weight">
          <NumberField
            commitOnEnd
            value={profile.weight_kg}
            onChange={(weight_kg) => updateProfile({ weight_kg })}
            suffix="kg"
          />
        </SettingRow>
        <SubsectionLabel>Eating window</SubsectionLabel>
        <SettingRow label="Eat from">
          <TimeField
            value={profile.eatingWindow.start}
            onChange={(start) =>
              updateProfile({
                eatingWindow: { ...profile.eatingWindow, start },
              })
            }
          />
        </SettingRow>
        <SettingRow label="Eat until" showBorder={false}>
          <TimeField
            value={profile.eatingWindow.end}
            onChange={(end) =>
              updateProfile({
                eatingWindow: { ...profile.eatingWindow, end },
              })
            }
          />
        </SettingRow>
      </SettingSection>

      <SettingSection
        title="Heart & zones"
        subtitle="Health checks and zone tuning for better guidance."
      >
        <SettingRow label="HRV" description="5-min RMSSD measurement at rest">
          <SettingsAction title="Run test" onPress={() => setHrvTestVisible(true)} />
        </SettingRow>
        <SettingRow label="CO2 tolerance" description="Breath-hold test">
          <SettingsAction title="Run test" onPress={() => setCo2TestVisible(true)} />
        </SettingRow>
        <SettingRow
          label="MAF adjustment"
          description={`Current ceiling ${profile.mafCeiling} bpm`}
          showBorder={false}
        >
          <MafStepper value={mafAdjustment} onChange={setMafAdjustment} />
        </SettingRow>
        <CollapsiblePanel
          title="Manual zones"
          subtitle="Advanced HR ranges; recalculate unless you need exact edits."
        >
          <ZoneSettingsCard
            profile={profile}
            onChange={applyZones}
            onRecalculate={recalculateZones}
          />
        </CollapsiblePanel>
      </SettingSection>

      <SettingSection
        title="Coach cues"
        subtitle="Keep common run cues visible; tuck noisier options away."
      >
        <SettingRow label="Nasal breathing reminder">
          <Switch
            value={settings.nasalReminder}
            onValueChange={settings.setNasalReminder}
          />
        </SettingRow>
        <SettingRow label="Cadence coaching" description="Cue cadence changes during runs">
          <Switch
            value={settings.cadenceCoachingEnabled}
            onValueChange={settings.setCadenceCoachingEnabled}
          />
        </SettingRow>
        <SettingRow
          label="Cadence target"
          description="Steps per minute (165-175 typical)"
          showBorder={false}
        >
          <NumberField
            commitOnEnd
            value={settings.cadenceTarget}
            onChange={settings.setCadenceTarget}
            suffix="spm"
          />
        </SettingRow>
        <CollapsiblePanel
          title="More coach cues"
          subtitle="Fueling and louder warnings."
        >
          <SettingRow label="Fueling reminders" description="Cue every 30 min on runs over 75 min">
            <Switch
              value={settings.fuelingReminders}
              onValueChange={settings.setFuelingReminders}
            />
          </SettingRow>
          <SettingRow
            label="Fasted-run warning"
            description="Prompt before long runs over 90 min if no recent meal"
          >
            <Switch
              value={settings.fastedRunWarning}
              onValueChange={settings.setFastedRunWarning}
            />
          </SettingRow>
          <SettingRow
            label="Scream mode"
            description="Repeated spoken warning when HR exceeds ceiling by 5 bpm"
            showBorder={false}
          >
            <Switch
              value={settings.screamModeEnabled}
              onValueChange={settings.setScreamModeEnabled}
            />
          </SettingRow>
        </CollapsiblePanel>
      </SettingSection>

      <SettingSection
        title="Voice Mode"
        subtitle="Hands-free in-run coaching that holds a strict heart-rate band."
      >
        <SettingRow label="Target zone" description="Hold the high end of this zone">
          <ZonePicker
            value={settings.voiceModeBandZone}
            onChange={settings.setVoiceModeBandZone}
          />
        </SettingRow>
        <SettingRow
          label="Band width"
          description="bpm below the ceiling that still counts as on-target"
        >
          <NumberField
            commitOnEnd
            value={settings.voiceModeBandWidthBpm}
            onChange={settings.setVoiceModeBandWidthBpm}
            suffix="bpm"
          />
        </SettingRow>
        <SettingRow label="HR cue interval" description="How often the band cue is spoken">
          <NumberField
            commitOnEnd
            value={settings.voiceModeHrCueIntervalSec}
            onChange={settings.setVoiceModeHrCueIntervalSec}
            suffix="sec"
          />
        </SettingRow>
        <SettingRow
          label="Mind cues"
          description="Sports-psychology lines between HR cues: relax your shoulders, run tall, it's supposed to feel like this"
        >
          <Switch
            value={settings.voiceModePsychCues}
            onValueChange={settings.setVoiceModePsychCues}
          />
        </SettingRow>
        <SettingRow
          label="Coach voice"
          description="Your phone's built-in text-to-speech voice. Works offline; change the voice in your system speech settings."
          showBorder={false}
        >
          <Pressable
            onPress={() =>
              void speakCoachText(
                "Heart rate one forty six, on target. Hold this effort. You've got this.",
                { interrupt: true }
              )
            }
            className="px-3 h-9 rounded-lg bg-bg-elevated border border-accent/40 justify-center"
          >
            <Text className="text-accent text-xs font-semibold">▶ Preview voice</Text>
          </Pressable>
        </SettingRow>
      </SettingSection>

      <CollapsibleSettingSection
        title="Data & developer"
        subtitle="Online lookups, app version, reset, and development-only controls."
      >
        <SettingRow
          label="Weather and elevation"
          description="Look up weather at run start and terrain elevation after a run from Open-Meteo. Sends run coordinates to open-meteo.com. Off keeps them on this phone and uses GPS altitude."
        >
          <Switch value={settings.onlineLookups} onValueChange={settings.setOnlineLookups} />
        </SettingRow>
        {__DEV__ ? (
          <SettingRow label="Mock HR source" description="Use generated HR in development">
            <Switch
              value={settings.useMockHR}
              onValueChange={settings.setUseMockHR}
            />
          </SettingRow>
        ) : null}
        <SettingRow label="Version">
          <Text className="text-text-secondary text-base">{version}</Text>
        </SettingRow>
        <View className="py-3 border-b border-bg-border/60 gap-1.5">
          <InlineNote>
            BaseMile is free software under the GPL-3.0-or-later licence. Built by Likwiid.
          </InlineNote>
          <Pressable
            accessibilityRole="link"
            onPress={() => {
              void Linking.openURL(SOURCE_URL).catch(() => undefined);
            }}
          >
            <Text className="text-accent text-xs">Source code and credits</Text>
          </Pressable>
          <OpenMeteoCredit subject="Weather and elevation" />
          <Text className="text-text-muted text-[10px]">Map tiles OpenFreeMap © OpenMapTiles, data © OpenStreetMap contributors</Text>
          <Text className="text-text-muted text-[10px]">
            Not medical advice. Check with a professional before starting a training plan.
          </Text>
        </View>
        <InlineNote>
          Reset is intentionally tucked away because it clears runs, baselines,
          settings, notifications, and profile data.
        </InlineNote>
        <SettingRow
          label="Reset"
          description="Clear the local app and start over"
          showBorder={false}
        >
          <SettingsAction title="Reset all" tone="danger" onPress={onResetAll} />
        </SettingRow>
      </CollapsibleSettingSection>

      <View className="h-8" />

      <BaselineTestModal
        visible={restingTestVisible}
        onClose={() => setRestingTestVisible(false)}
      />
      <MaxHRTestModal
        visible={maxTestVisible}
        onClose={() => setMaxTestVisible(false)}
      />
      <HrvTestModal
        visible={hrvTestVisible}
        onClose={() => setHrvTestVisible(false)}
      />
      <Co2TestModal
        visible={co2TestVisible}
        onClose={() => setCo2TestVisible(false)}
      />
      <PairingModal
        visible={pairingVisible}
        onClose={() => setPairingVisible(false)}
      />
    </Screen>
  );
}
