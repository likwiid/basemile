// SPDX-License-Identifier: GPL-3.0-or-later

import { Pressable, Text, View } from 'react-native';

import type { CoachCue, CoachVerbosity, RunStatus } from '@/types';

type CoachIntent =
  | 'steady'
  | 'faster'
  | 'slower'
  | 'rest'
  | 'urgent'
  | 'muted';

export interface CoachDisplayCue {
  action: string;
  detail: string;
  intent: CoachIntent;
}

interface LiveCoachPanelProps {
  cue: CoachCue | null;
  fallback: CoachDisplayCue | null;
  status: RunStatus;
  strapConnected: boolean;
  verbosity: CoachVerbosity;
  onVerbosityChange: (value: CoachVerbosity) => void;
  compact?: boolean;
}

const MODE_OPTIONS: readonly { value: CoachVerbosity; label: string }[] = [
  { value: 'voice', label: 'Voice' },
  { value: 'silent', label: 'Off' },
];

const INTENT_CLASS: Record<
  CoachIntent,
  { badge: string; action: string; detail: string; panel: string }
> = {
  steady: {
    badge: 'bg-zone-z2/20 border-zone-z2/40',
    action: 'text-zone-z2',
    detail: 'text-text-secondary',
    panel: 'border-bg-border bg-bg-elevated/60',
  },
  faster: {
    badge: 'bg-zone-z3/20 border-zone-z3/50',
    action: 'text-zone-z3',
    detail: 'text-text-secondary',
    panel: 'border-zone-z3/40 bg-zone-z3/10',
  },
  slower: {
    badge: 'bg-zone-z4/20 border-zone-z4/50',
    action: 'text-zone-z4',
    detail: 'text-text-secondary',
    panel: 'border-zone-z4/40 bg-zone-z4/10',
  },
  rest: {
    badge: 'bg-zone-z1/20 border-zone-z1/50',
    action: 'text-zone-z1',
    detail: 'text-text-secondary',
    panel: 'border-zone-z1/40 bg-zone-z1/10',
  },
  urgent: {
    badge: 'bg-zone-z5/20 border-zone-z5/50',
    action: 'text-zone-z5',
    detail: 'text-text-secondary',
    panel: 'border-zone-z5/50 bg-zone-z5/10',
  },
  muted: {
    badge: 'bg-bg-card border-bg-border',
    action: 'text-text-muted',
    detail: 'text-text-muted',
    panel: 'border-bg-border bg-bg-elevated/40',
  },
};

export function LiveCoachPanel({
  cue,
  fallback,
  status,
  strapConnected,
  verbosity,
  onVerbosityChange,
  compact = false,
}: LiveCoachPanelProps) {
  const display = cue
    ? displayForCue(cue)
    : fallback ?? displayForStatus(status, strapConnected, verbosity);
  const classes = INTENT_CLASS[display.intent];

  return (
    <View className={`rounded-xl border px-3 py-2.5 ${classes.panel}`}>
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-1">
          <Text className="text-text-muted text-[11px] font-semibold uppercase">
            Live coach
          </Text>
          <Text
            className={`${compact ? 'text-xl' : 'text-2xl'} font-bold mt-0.5 ${classes.action}`}
          >
            {display.action}
          </Text>
        </View>
        <View className={`rounded-full border px-2.5 py-1 ${classes.badge}`}>
          <Text className="text-text-primary text-[11px] font-semibold">
            {modeStatus(verbosity)}
          </Text>
        </View>
      </View>

      <Text
        className={`text-sm leading-5 mt-1.5 ${classes.detail}`}
        numberOfLines={compact ? 2 : undefined}
      >
        {display.detail}
      </Text>

      {compact ? null : (
        <View className="flex-row gap-1.5 mt-2">
          {MODE_OPTIONS.map((option) => {
            const selected = option.value === verbosity;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityLabel={`Set coach mode to ${option.label}`}
                accessibilityState={{ selected }}
                onPress={() => onVerbosityChange(option.value)}
                hitSlop={4}
                className={`min-h-11 flex-1 items-center justify-center rounded-lg border ${
                  selected
                    ? 'bg-accent border-accent'
                    : 'bg-bg border-bg-border active:opacity-80'
                }`}
              >
                <Text
                  className={`text-xs font-semibold ${
                    selected ? 'text-black' : 'text-text-secondary'
                  }`}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

function displayForCue(cue: CoachCue): CoachDisplayCue {
  const text = cue.text ?? cue.kind.replace(/_/g, ' ');
  switch (cue.kind) {
    case 'zone_exceeded':
      return {
        action: 'Slow down',
        detail: text,
        intent: cue.tone === 'urgent' ? 'urgent' : 'slower',
      };
    case 'maf_buffer':
    case 'early_too_fast':
    case 'hr_drift':
      return { action: 'Ease back', detail: text, intent: 'slower' };
    case 'interval_start':
    case 'interval_push':
    case 'final_interval':
      return { action: 'Go faster', detail: text, intent: 'faster' };
    case 'interval_recover':
    case 'interval_recovered':
      return { action: 'Rest', detail: text, intent: 'rest' };
    case 'zone_recovered':
      return { action: 'Restart easy', detail: text, intent: 'steady' };
    case 'nasal_breathing':
      return { action: 'Breathe', detail: text, intent: 'steady' };
    case 'session_complete':
      return { action: 'Done', detail: text, intent: 'rest' };
    case 'interval_warmup':
    case 'periodic_checkin':
      return inferDisplayFromText(text);
  }
}

function inferDisplayFromText(text: string): CoachDisplayCue {
  const lower = text.toLowerCase();
  if (
    lower.includes('slow') ||
    lower.includes('drop') ||
    lower.includes('back off') ||
    lower.includes('ease back')
  ) {
    return { action: 'Slow down', detail: text, intent: 'slower' };
  }
  if (
    lower.includes('push') ||
    lower.includes('go hard') ||
    lower.includes('stride') ||
    lower.includes('faster')
  ) {
    return { action: 'Go faster', detail: text, intent: 'faster' };
  }
  if (lower.includes('recover') || lower.includes('rest')) {
    return { action: 'Rest', detail: text, intent: 'rest' };
  }
  return { action: 'Hold steady', detail: text, intent: 'steady' };
}

function displayForStatus(
  status: RunStatus,
  strapConnected: boolean,
  verbosity: CoachVerbosity
): CoachDisplayCue {
  if (verbosity === 'silent') {
    return {
      action: 'Coach muted',
      detail: 'Switch to Voice for spoken slow down, go faster, and rest cues.',
      intent: 'muted',
    };
  }
  if (!strapConnected) {
    return {
      action: 'Connect strap',
      detail: 'HR cues resume when the heart rate strap is connected.',
      intent: 'urgent',
    };
  }
  if (status === 'paused') {
    return {
      action: 'Paused',
      detail: 'Resume when ready.',
      intent: 'rest',
    };
  }
  return {
    action: 'Hold steady',
    detail: 'Watching HR, pace, and cadence changes.',
    intent: 'steady',
  };
}

function modeStatus(verbosity: CoachVerbosity): string {
  switch (verbosity) {
    case 'voice':
      return 'Voice on';
    case 'silent':
      return 'Muted';
  }
}
