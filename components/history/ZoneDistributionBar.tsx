// SPDX-License-Identifier: GPL-3.0-or-later

import { memo } from 'react';
import { Text, View } from 'react-native';

import { totalZoneSec, zoneSeconds } from '@/lib/metrics/zones';
import { zoneColor } from '@/lib/zones';
import type { ZoneDistribution, ZoneNumber } from '@/types';

interface ZoneDistributionBarProps {
  distribution: ZoneDistribution;
  showLegend?: boolean;
  height?: number;
}

const ZONES: readonly ZoneNumber[] = [1, 2, 3, 4, 5];

export const ZoneDistributionBar = memo(function ZoneDistributionBar({
  distribution,
  showLegend = true,
  height = 18,
}: ZoneDistributionBarProps) {
  const total = totalZoneSec(distribution);

  if (total === 0) {
    return (
      <View className="bg-bg-elevated/35 border border-bg-border/60 rounded-xl items-center justify-center min-h-[40px] px-3">
        <Text className="text-text-muted text-xs text-center">No HR data</Text>
      </View>
    );
  }

  return (
    <View>
      <View
        className="flex-row rounded-full overflow-hidden"
        style={{ height }}
      >
        {ZONES.map((zone) => {
          const sec = zoneSeconds(distribution, zone);
          const flex = sec / total;
          if (flex <= 0) return null;
          return (
            <View
              key={zone}
              style={{ flex, backgroundColor: zoneColor(zone) }}
            />
          );
        })}
      </View>
      {showLegend ? (
        <View className="flex-row justify-between mt-2">
          {ZONES.map((zone) => {
            const sec = zoneSeconds(distribution, zone);
            const pct = (sec / total) * 100;
            return (
              <View key={zone} className="items-center">
                <View
                  className="w-3 h-2 rounded-full"
                  style={{ backgroundColor: zoneColor(zone) }}
                />
                <Text className="text-text-secondary text-xs mt-1">Z{zone}</Text>
                <Text className="text-text-primary text-xs font-semibold">
                  {pct.toFixed(0)}%
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
});
