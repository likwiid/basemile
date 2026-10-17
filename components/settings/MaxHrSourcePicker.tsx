// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { observedPeakHr, resolveEffectiveMaxHr, tanakaMaxHr } from '@/lib/metrics/maxHr';
import { getAllRuns, getBaselines } from '@/lib/storage/db';
import { useProfileStore } from '@/lib/storage/profile';
import { useSettingsStore } from '@/lib/storage/settings';
import type { MaxHrSource } from '@/types';

/**
 * Surfaces the disagreement between the Tanaka estimate, the measured max-HR
 * baseline, and the highest HR observed in runs, and lets the athlete pick which
 * one drives Karvonen zones + TRIMP. The choice is applied to profile.hrMax only
 * on tap — nothing changes until then. Z2's top stays pinned to the MAF ceiling.
 */
export function MaxHrSourcePicker() {
  const profile = useProfileStore((s) => s.profile);
  const updateProfile = useProfileStore((s) => s.update);
  const source = useSettingsStore((s) => s.maxHrSource);
  const manual = useSettingsStore((s) => s.maxHrManual);
  const setSource = useSettingsStore((s) => s.setMaxHrSource);
  const setManual = useSettingsStore((s) => s.setMaxHrManual);

  const [measured, setMeasured] = useState<number | null>(null);
  const [observed, setObserved] = useState<number | null>(null);
  const [manualText, setManualText] = useState(manual != null ? String(manual) : '');

  useEffect(() => {
    const maxBaselines = getBaselines('max_hr');
    setMeasured(maxBaselines[0]?.bpm ?? null);
    setObserved(observedPeakHr(getAllRuns()));
  }, []);

  const estimate = tanakaMaxHr(profile.age);

  const apply = (nextSource: MaxHrSource, manualValue?: number) => {
    const effective = resolveEffectiveMaxHr({
      source: nextSource,
      age: profile.age,
      measured,
      manual: manualValue ?? manual,
    });
    setSource(nextSource);
    if (manualValue !== undefined) setManual(manualValue);
    // Recomputes zones from the new max; Z2's top stays pinned to the MAF ceiling.
    updateProfile({ hrMax: effective });
  };

  const applyManual = () => {
    const n = Number.parseInt(manualText, 10);
    if (!Number.isFinite(n) || n < 120 || n > 230) return;
    apply('manual', n);
  };

  const z = profile.zones;
  const bands: { label: string; range: readonly [number, number] }[] = [
    { label: 'Z2', range: z.z2 },
    { label: 'Z3', range: z.z3 },
    { label: 'Z4', range: z.z4 },
    { label: 'Z5', range: z.z5 },
  ];

  return (
    <View className="gap-3">
      <Text className="text-text-muted text-[10px] uppercase tracking-wider">
        Drives zones &amp; training load
      </Text>

      {/* The three candidate values, so the disagreement is always visible. */}
      <View className="flex-row gap-2">
        <Candidate
          label="Estimate"
          value={estimate}
          hint="Tanaka"
          active={source === 'estimate'}
          onPress={() => apply('estimate')}
        />
        <Candidate
          label="Measured"
          value={measured}
          hint="max-HR test"
          active={source === 'measured'}
          disabled={measured == null}
          onPress={() => measured != null && apply('measured')}
        />
        <Candidate
          label="Manual"
          value={source === 'manual' ? manual : null}
          hint="you set it"
          active={source === 'manual'}
          onPress={() => setSource('manual')}
        />
      </View>

      {source === 'manual' ? (
        <View className="flex-row items-center gap-2">
          <TextInput
            value={manualText}
            onChangeText={setManualText}
            keyboardType="number-pad"
            placeholder="e.g. 178"
            placeholderTextColor="#525252"
            className="bg-bg-elevated text-text-primary text-sm px-3 h-10 rounded-lg flex-1 text-center"
          />
          <Pressable
            onPress={applyManual}
            className="px-4 h-10 rounded-lg bg-accent justify-center"
          >
            <Text className="text-black text-xs font-semibold">Apply</Text>
          </Pressable>
        </View>
      ) : null}

      {observed != null ? (
        <Text className="text-text-muted text-xs">
          Highest HR seen in your runs: {observed} bpm
        </Text>
      ) : null}

      <View className="pt-2 border-t border-bg-border/60 gap-1.5">
        <Text className="text-text-secondary text-xs">
          Now driving zones &amp; TRIMP:{' '}
          <Text className="text-text-primary font-semibold">{profile.hrMax} bpm</Text>
        </Text>
        <View className="flex-row flex-wrap gap-x-3 gap-y-1">
          {bands.map((b) => (
            <Text key={b.label} className="text-text-muted text-xs">
              {b.label} {b.range[0]}-{b.range[1]}
            </Text>
          ))}
        </View>
        <Text className="text-text-muted text-[11px] leading-4 mt-1">
          Z2 stays capped at your MAF ceiling ({profile.mafCeiling}); only Z3-Z5 and training
          load shift. A lower max raises TRIMP/CTL.
        </Text>
      </View>
    </View>
  );
}

function Candidate({
  label,
  value,
  hint,
  active,
  disabled = false,
  onPress,
}: {
  label: string;
  value: number | null;
  hint: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`flex-1 px-2 py-2 rounded-lg border ${
        active ? 'bg-accent border-accent' : 'bg-bg-elevated border-bg-border/60'
      } ${disabled ? 'opacity-40' : ''}`}
    >
      <Text
        className={`text-[10px] uppercase tracking-wider ${
          active ? 'text-black/70' : 'text-text-muted'
        }`}
      >
        {label}
      </Text>
      <Text className={`text-lg font-bold ${active ? 'text-black' : 'text-text-primary'}`}>
        {value ?? '--'}
      </Text>
      <Text className={`text-[10px] ${active ? 'text-black/60' : 'text-text-muted'}`}>{hint}</Text>
    </Pressable>
  );
}
