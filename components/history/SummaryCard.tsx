// SPDX-License-Identifier: GPL-3.0-or-later

import { memo } from 'react';
import { Text, View } from 'react-native';

interface SummaryCardProps {
  label: string;
  value: string;
  hint?: string;
  accentClass?: string;
}

export const SummaryCard = memo(function SummaryCard({ label, value, hint, accentClass }: SummaryCardProps) {
  return (
    <View className="flex-1 mx-0.5 bg-bg-card/80 border border-bg-border/70 rounded-xl px-2 py-2">
      <Text className="text-text-muted text-[10px] uppercase tracking-wider">{label}</Text>
      <Text
        className={`text-lg font-bold mt-0.5 ${accentClass ?? 'text-text-primary'}`}
      >
        {value}
      </Text>
      {hint ? <Text className="text-text-secondary text-[11px] mt-0.5">{hint}</Text> : null}
    </View>
  );
});
