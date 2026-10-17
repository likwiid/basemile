// SPDX-License-Identifier: GPL-3.0-or-later

import { Text, View } from 'react-native';

interface PillProps {
  label: string;
  className?: string;
  textClassName?: string;
}

export function Pill({ label, className, textClassName }: PillProps) {
  return (
    <View
      className={`px-2.5 py-0.5 rounded-full bg-bg-elevated/50 border border-bg-border/70 self-start ${
        className ?? ''
      }`}
    >
      <Text className={`text-text-secondary text-[11px] font-medium ${textClassName ?? ''}`}>
        {label}
      </Text>
    </View>
  );
}
