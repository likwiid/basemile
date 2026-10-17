// SPDX-License-Identifier: GPL-3.0-or-later

import type { ReactNode } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';

interface SettingRowProps {
  label: string;
  description?: string;
  children: ReactNode;
  showBorder?: boolean;
}

export function SettingRow({
  label,
  description,
  children,
  showBorder = true,
}: SettingRowProps) {
  const { width } = useWindowDimensions();
  const stacked = width < 430 && Boolean(description);

  return (
    <View
      className={`min-h-12 py-2.5 ${
        stacked ? 'gap-2' : 'flex-row items-center justify-between gap-3'
      } ${showBorder ? 'border-b border-bg-border' : ''}`}
    >
      <View className={stacked ? '' : 'flex-1 pr-2'}>
        <Text className="text-text-primary text-sm font-semibold">{label}</Text>
        {description ? (
          <Text className="text-text-muted text-xs leading-4 mt-0.5">{description}</Text>
        ) : null}
      </View>
      <View className={stacked ? 'items-start w-full' : 'items-end shrink-0'}>
        {children}
      </View>
    </View>
  );
}
