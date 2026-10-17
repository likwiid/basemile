// SPDX-License-Identifier: GPL-3.0-or-later

import { Pressable, Text, TextInput, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import type { RunContext, RunFuelingChecklist, RunSurface } from '@/types';

const SURFACES: readonly { value: RunSurface; label: string }[] = [
  { value: 'road', label: 'Road' },
  { value: 'trail', label: 'Trail' },
  { value: 'track', label: 'Track' },
  { value: 'treadmill', label: 'Treadmill' },
  { value: 'grass', label: 'Grass' },
  { value: 'mixed', label: 'Mixed' },
];

const FUEL_ITEMS: readonly {
  key: keyof RunFuelingChecklist;
  label: string;
}[] = [
  { key: 'hydrated_before', label: 'Hydrated before' },
  { key: 'carried_fluids', label: 'Carried fluids' },
  { key: 'took_fuel', label: 'Took fuel' },
  { key: 'post_run_refuel', label: 'Refueled after' },
];

const DEFAULT_FUELING: RunFuelingChecklist = {
  hydrated_before: false,
  carried_fluids: false,
  took_fuel: false,
  post_run_refuel: false,
};

interface RunContextEditorProps {
  value: RunContext;
  onChange: (next: RunContext) => void;
}

export function RunContextEditor({ value, onChange }: RunContextEditorProps) {
  const fueling = value.fueling ?? DEFAULT_FUELING;

  const setSurface = (surface: RunSurface) => {
    onChange({
      ...value,
      surface: value.surface === surface ? undefined : surface,
    });
  };

  const toggleFuel = (key: keyof RunFuelingChecklist) => {
    onChange({
      ...value,
      fueling: {
        ...fueling,
        [key]: !fueling[key],
      },
    });
  };

  const setNiggle = (niggle: string) => {
    onChange({
      ...value,
      niggle,
    });
  };

  return (
    <Card className="p-3">
      <Text className="text-text-muted text-xs uppercase tracking-wider mb-2">
        Surface
      </Text>
      <View className="flex-row flex-wrap gap-2 mb-4">
        {SURFACES.map((surface) => {
          const selected = value.surface === surface.value;
          return (
            <Pressable
              key={surface.value}
              onPress={() => setSurface(surface.value)}
              className={`px-3 h-10 rounded-lg border justify-center ${
                selected
                  ? 'bg-accent border-accent'
                  : 'bg-bg-elevated/70 border-bg-border/70'
              }`}
            >
              <Text
                className={`text-sm font-semibold ${
                  selected ? 'text-black' : 'text-text-secondary'
                }`}
              >
                {surface.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text className="text-text-muted text-xs uppercase tracking-wider mb-2">
        Fuel and hydration
      </Text>
      <View className="gap-1.5 mb-4">
        {FUEL_ITEMS.map((item) => {
          const selected = fueling[item.key];
          return (
            <Pressable
              key={item.key}
              onPress={() => toggleFuel(item.key)}
              className="min-h-10 flex-row items-center gap-3"
            >
              <View
                className={`h-6 w-6 rounded-md border items-center justify-center ${
                  selected
                    ? 'bg-accent border-accent'
                    : 'bg-bg-elevated/70 border-bg-border/70'
                }`}
              >
                <Text className={selected ? 'text-black text-xs font-bold' : 'text-transparent text-xs'}>
                  X
                </Text>
              </View>
              <Text className="text-text-primary text-sm">{item.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text className="text-text-muted text-xs uppercase tracking-wider mb-2">
        Niggle check
      </Text>
      <TextInput
        value={value.niggle ?? ''}
        onChangeText={setNiggle}
        placeholder="e.g. left achilles tightness"
        placeholderTextColor="#525252"
        className="text-text-primary text-sm bg-bg-elevated/70 border border-bg-border/60 rounded-lg px-3 h-11"
      />
    </Card>
  );
}
