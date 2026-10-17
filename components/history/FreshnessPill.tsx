// SPDX-License-Identifier: GPL-3.0-or-later

import { memo } from 'react';
import { Text, View } from 'react-native';
import { formatTsbLabel, type FreshnessTone } from '@/lib/metrics/load';

interface FreshnessPillProps {
  tsb: number;
}

const TONE_TEXT_CLASS: Record<FreshnessTone, string> = {
  good: 'text-zone-z2',
  warn: 'text-zone-z3',
  bad: 'text-zone-z5',
};

const LABEL_COPY: Record<ReturnType<typeof formatTsbLabel>['label'], string> = {
  fresh: 'Fresh',
  neutral: 'Neutral',
  fatigued: 'Fatigued',
  overcooked: 'Overcooked',
};

export const FreshnessPill = memo(function FreshnessPill({ tsb }: FreshnessPillProps) {
  const { label, tone } = formatTsbLabel(tsb);
  const toneClass = TONE_TEXT_CLASS[tone];
  const display = Math.round(tsb);
  const sign = display > 0 ? '+' : '';

  return (
    <View className="flex-1 mx-0.5 bg-bg-card/80 border border-bg-border/70 rounded-xl px-2 py-2">
      <Text className="text-text-muted text-[10px] uppercase tracking-wider">
        Freshness
      </Text>
      <Text className={`text-lg font-bold mt-0.5 ${toneClass}`}>
        {`${sign}${display}`}
      </Text>
      <Text className={`text-[11px] mt-0.5 ${toneClass}`}>{LABEL_COPY[label]}</Text>
    </View>
  );
});
