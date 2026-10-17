// SPDX-License-Identifier: GPL-3.0-or-later

import { Text, View } from 'react-native';

import {
  evaluateLiveGuardrails,
  type LiveGuardrailSample,
} from '@/lib/coach/guardrails';
import type { ZoneConfig, ZoneNumber } from '@/types';

interface LiveGuardrailsProps {
  samples: readonly LiveGuardrailSample[];
  zones: ZoneConfig;
  elapsedMs: number;
  targetZone: ZoneNumber;
}

const STYLE_BY_SEVERITY = {
  info: {
    container: 'bg-bg-elevated border-bg-border',
    title: 'text-text-secondary',
    body: 'text-text-muted',
  },
  warn: {
    container: 'bg-zone-z3/15 border-zone-z3/40',
    title: 'text-zone-z3',
    body: 'text-text-secondary',
  },
  urgent: {
    container: 'bg-zone-z5/15 border-zone-z5/50',
    title: 'text-zone-z5',
    body: 'text-text-secondary',
  },
} as const;

export function LiveGuardrails({
  samples,
  zones,
  elapsedMs,
  targetZone,
}: LiveGuardrailsProps) {
  const guardrails = evaluateLiveGuardrails({
    samples,
    zones,
    elapsedMs,
    targetZone,
  }).slice(0, 2);

  if (guardrails.length === 0) return null;

  return (
    <View className="gap-2">
      {guardrails.map((guardrail) => {
        const style = STYLE_BY_SEVERITY[guardrail.severity];
        return (
          <View
            key={guardrail.kind}
            className={`rounded-xl border px-3 py-2 ${style.container}`}
          >
            <Text className={`text-xs font-semibold uppercase ${style.title}`}>
              {guardrail.title}
            </Text>
            <Text className={`text-sm mt-1 ${style.body}`}>{guardrail.message}</Text>
          </View>
        );
      })}
    </View>
  );
}
