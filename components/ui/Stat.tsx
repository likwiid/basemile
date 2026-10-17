// SPDX-License-Identifier: GPL-3.0-or-later

import { Text, View } from 'react-native';

interface StatProps {
  label: string;
  value: string;
  sublabel?: string;
  className?: string;
  valueClassName?: string;
}

export function Stat({ label, value, sublabel, className, valueClassName }: StatProps) {
  return (
    <View className={className}>
      <Text className="text-text-muted text-[11px] uppercase">{label}</Text>
      <Text
        className={`text-text-primary text-2xl font-semibold mt-0.5 ${valueClassName ?? ''}`}
      >
        {value}
      </Text>
      {sublabel ? (
        <Text className="text-text-secondary text-xs mt-0.5">{sublabel}</Text>
      ) : null}
    </View>
  );
}
