// SPDX-License-Identifier: GPL-3.0-or-later

import { memo } from 'react';
import { Text, View } from 'react-native';

import { formatDistance, formatDuration, formatPace } from '@/lib/time';
import type { SplitMetric } from '@/types';

interface SplitsTableProps {
  splits: SplitMetric[];
  totalDistanceM?: number;
  totalDurationSec?: number;
}

export const SplitsTable = memo(function SplitsTable({
  splits,
  totalDistanceM = 0,
  totalDurationSec = 0,
}: SplitsTableProps) {
  if (splits.length === 0) {
    if (totalDistanceM > 0 && totalDistanceM < 1000 && totalDurationSec > 0) {
      return (
        <View className="py-3 px-2">
          <Text className="text-text-secondary text-sm text-center">
            partial: {formatDistance(totalDistanceM)} in{' '}
            {formatDuration(totalDurationSec)}
          </Text>
        </View>
      );
    }
    return (
      <View className="py-4 px-2">
        <Text className="text-text-muted text-sm text-center">No splits recorded</Text>
      </View>
    );
  }

  const fastest = splits.reduce((acc, s) =>
    s.duration_sec < acc.duration_sec ? s : acc
  );

  // Only show the elevation column when at least one split carries it.
  const showElevation = splits.some(
    (s) => s.ascent_m !== undefined || s.descent_m !== undefined
  );

  return (
    <View>
      <View className="flex-row pb-2 border-b border-bg-border/70">
        <Text className="text-text-muted text-[10px] uppercase tracking-wider w-12">Km</Text>
        <Text className="text-text-muted text-[10px] uppercase tracking-wider flex-1">
          Time
        </Text>
        <Text className="text-text-muted text-[10px] uppercase tracking-wider flex-1">
          Pace
        </Text>
        <Text className="text-text-muted text-[10px] uppercase tracking-wider flex-1">
          GAP
        </Text>
        {showElevation ? (
          <Text className="text-text-muted text-[10px] uppercase tracking-wider w-20 text-right">
            Elev
          </Text>
        ) : null}
        <Text className="text-text-muted text-[10px] uppercase tracking-wider w-16 text-right">
          Avg HR
        </Text>
      </View>
      {splits.map((s) => {
        const isFastest = s.km === fastest.km;
        return (
          <View
            key={s.km}
            className="flex-row py-1.5 border-b border-bg-border/60"
          >
            <Text className="text-text-primary text-sm w-12">{s.km}</Text>
            <Text className="text-text-primary text-sm flex-1">
              {formatDuration(s.duration_sec)}
            </Text>
            <Text
              className={`text-sm flex-1 ${isFastest ? 'text-accent font-semibold' : 'text-text-primary'}`}
            >
              {formatPace(s.duration_sec)}
            </Text>
            <Text className="text-text-primary text-sm flex-1">
              {s.gap_sec_per_km ? formatPace(s.gap_sec_per_km) : '--'}
            </Text>
            {showElevation ? (
              <Text className="text-text-secondary text-xs w-20 text-right">
                {formatElevation(s.ascent_m, s.descent_m)}
              </Text>
            ) : null}
            <Text className="text-text-primary text-sm w-16 text-right">
              {s.avg_hr > 0 ? s.avg_hr : '--'}
            </Text>
          </View>
        );
      })}
    </View>
  );
});

/** "↑12 ↓3" style elevation cell, omitting zero/missing components. */
function formatElevation(gainM?: number, lossM?: number): string {
  const gain = gainM !== undefined && gainM >= 1 ? `↑${Math.round(gainM)}` : '';
  const loss = lossM !== undefined && lossM >= 1 ? `↓${Math.round(lossM)}` : '';
  const text = [gain, loss].filter(Boolean).join(' ');
  return text.length > 0 ? text : '--';
}
