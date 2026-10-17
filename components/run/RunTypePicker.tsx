// SPDX-License-Identifier: GPL-3.0-or-later

import { Pressable, Text, View } from 'react-native';

import {
  BRIEF_VARIANTS,
  briefVariant,
  clampBriefReps,
  RUN_TYPE_IDS,
  runTypeCard,
  type BriefVariantId,
  type RunTypeCardContent,
  type RunTypeProfile,
} from '@/lib/run/runTypes';
import { zoneColor } from '@/lib/zones';
import type { RunTypeId } from '@/types';

interface RunTypePickerProps {
  value: RunTypeId;
  onChange: (id: RunTypeId) => void;
  briefVariant: BriefVariantId;
  onBriefVariantChange: (id: BriefVariantId) => void;
  briefReps: number;
  onBriefRepsChange: (reps: number) => void;
  profile: RunTypeProfile;
  disabled?: boolean;
}

// Used sparingly: the selected card's border, name and radio dot.
const ACCENT: Record<RunTypeId, string> = {
  long: zoneColor(2),
  medium: '#f59e0b',
  brief: zoneColor(5),
};

const INK = {
  primary: '#f5f5f4',
  secondary: '#a8a29e',
  label: '#78716c',
  chipBg: '#161616',
  chipBorder: '#262626',
  cardBg: '#0a0a0a',
  cardSelectedBg: '#111111',
  cardBorder: '#1f1f1f',
} as const;

export function RunTypePicker({
  value,
  onChange,
  briefVariant: variantId,
  onBriefVariantChange,
  briefReps,
  onBriefRepsChange,
  profile,
  disabled = false,
}: RunTypePickerProps) {
  const reps = clampBriefReps(variantId, briefReps);
  return (
    <View accessibilityRole="radiogroup" className="gap-3">
      {RUN_TYPE_IDS.map((id) => {
        const selected = id === value;
        const card = runTypeCard(id, profile, { variant: variantId, reps });
        return (
          <RunTypeCard
            key={id}
            card={card}
            accent={ACCENT[id]}
            selected={selected}
            disabled={disabled}
            onPress={() => onChange(id)}
          >
            {selected && id === 'brief' ? (
              <BriefOptions
                accent={ACCENT.brief}
                variantId={variantId}
                onVariantChange={onBriefVariantChange}
                reps={reps}
                onRepsChange={onBriefRepsChange}
                disabled={disabled}
              />
            ) : null}
          </RunTypeCard>
        );
      })}
    </View>
  );
}

interface RunTypeCardProps {
  card: RunTypeCardContent;
  accent: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
  children?: React.ReactNode;
}

function RunTypeCard({ card, accent, selected, disabled, onPress, children }: RunTypeCardProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`${card.name} run, ${card.chips.join(', ')}`}
      accessibilityState={{ selected, checked: selected, disabled }}
      onPress={onPress}
      disabled={disabled}
      className={`rounded-2xl px-4 py-4 ${disabled ? 'opacity-60' : 'active:opacity-80'}`}
      style={{
        backgroundColor: selected ? INK.cardSelectedBg : INK.cardBg,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? accent : INK.cardBorder,
        // Keep the content from shifting 1px when the border thickens.
        margin: selected ? 0 : 1,
      }}
    >
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-1">
          <Text
            className="text-2xl font-bold"
            style={{ color: selected ? accent : INK.primary }}
          >
            {card.name}
          </Text>
          <Text className="text-sm mt-0.5" style={{ color: INK.secondary }}>
            {card.tagline}
          </Text>
        </View>
        <RadioDot selected={selected} accent={accent} />
      </View>

      <View className="flex-row flex-wrap gap-2 mt-3">
        {card.chips.map((chip) => (
          <View
            key={chip}
            className="rounded-full px-3 py-1"
            style={{ backgroundColor: INK.chipBg, borderWidth: 1, borderColor: INK.chipBorder }}
          >
            <Text className="text-xs font-semibold" style={{ color: INK.primary }}>
              {chip}
            </Text>
          </View>
        ))}
      </View>

      {selected ? (
        <View
          className="mt-4 pt-3 gap-2"
          style={{ borderTopWidth: 1, borderTopColor: INK.cardBorder }}
        >
          {card.details.map((row) => (
            <View key={row.label} className="flex-row items-baseline">
              <Text
                className="w-20 text-[11px] font-semibold uppercase tracking-widest"
                style={{ color: INK.label }}
              >
                {row.label}
              </Text>
              <Text className="flex-1 text-sm" style={{ color: INK.primary }}>
                {row.value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {children}
    </Pressable>
  );
}

function RadioDot({ selected, accent }: { selected: boolean; accent: string }) {
  return (
    <View
      className="w-6 h-6 rounded-full items-center justify-center"
      style={{ borderWidth: 2, borderColor: selected ? accent : INK.chipBorder }}
    >
      {selected ? (
        <View className="w-3 h-3 rounded-full" style={{ backgroundColor: accent }} />
      ) : null}
    </View>
  );
}

interface BriefOptionsProps {
  accent: string;
  variantId: BriefVariantId;
  onVariantChange: (id: BriefVariantId) => void;
  reps: number;
  onRepsChange: (reps: number) => void;
  disabled: boolean;
}

function BriefOptions({
  accent,
  variantId,
  onVariantChange,
  reps,
  onRepsChange,
  disabled,
}: BriefOptionsProps) {
  const variant = briefVariant(variantId);
  return (
    <View className="mt-4 gap-3">
      <OptionRow label="Protocol">
        {BRIEF_VARIANTS.map((v) => (
          <Chip
            key={v.id}
            label={v.name}
            accent={accent}
            selected={v.id === variantId}
            disabled={disabled}
            onPress={() => onVariantChange(v.id)}
          />
        ))}
      </OptionRow>
      {variant.repsOptions.length > 1 ? (
        <OptionRow label="Reps">
          {variant.repsOptions.map((n) => (
            <Chip
              key={n}
              label={`×${n}`}
              accent={accent}
              selected={n === reps}
              disabled={disabled}
              onPress={() => onRepsChange(n)}
            />
          ))}
        </OptionRow>
      ) : null}
    </View>
  );
}

function OptionRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="gap-2">
      <Text
        className="text-[11px] font-semibold uppercase tracking-widest"
        style={{ color: INK.label }}
      >
        {label}
      </Text>
      <View className="flex-row flex-wrap gap-2">{children}</View>
    </View>
  );
}

interface ChipProps {
  label: string;
  accent: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}

function Chip({ label, accent, selected, disabled, onPress }: ChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      className="px-4 h-12 min-w-14 rounded-xl justify-center items-center active:opacity-80"
      style={{
        backgroundColor: selected ? `${accent}26` : INK.chipBg,
        borderWidth: 1,
        borderColor: selected ? accent : INK.chipBorder,
      }}
    >
      <Text
        className="text-sm font-semibold"
        style={{ color: selected ? INK.primary : INK.secondary }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
