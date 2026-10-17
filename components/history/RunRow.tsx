// SPDX-License-Identifier: GPL-3.0-or-later

import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';

import { zonePercent } from '@/lib/metrics/zones';
import { runTypeLabel } from '@/lib/run/runTypes';
import { dayOfWeekFromDate, formatDistance, formatDuration } from '@/lib/time';
import type { CompletedRun } from '@/types';

interface RunRowProps {
  run: CompletedRun;
  onPress: (id: string) => void;
}

function shortDate(ms: number): string {
  const d = new Date(ms);
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  return `${month} ${d.getDate()}`;
}

function dayLabel(ms: number): string {
  const day = dayOfWeekFromDate(new Date(ms));
  return day.charAt(0).toUpperCase() + day.slice(1, 3);
}

export const RunRow = memo(function RunRow({ run, onPress }: RunRowProps) {
  const z2 = zonePercent(run.zone_distribution, 2);

  return (
    <Pressable
      onPress={() => onPress(run.id)}
      className="bg-bg-card/75 border border-bg-border/60 rounded-xl px-3 py-3 mb-2 flex-row items-center active:opacity-70"
    >
      <View className="w-14">
        <Text className="text-text-muted text-[10px] uppercase">{dayLabel(run.started_at)}</Text>
        <Text className="text-text-primary text-sm font-semibold">
          {shortDate(run.started_at)}
        </Text>
      </View>
      <View className="flex-1 ml-3">
        <Text className="text-text-primary text-sm font-semibold">
          {runTypeLabel(run.type)}
        </Text>
        <Text className="text-text-secondary text-xs mt-0.5">
          {formatDuration(run.duration_sec)} · {formatDistance(run.distance_m)} ·{' '}
          {run.avg_hr > 0 ? `${run.avg_hr} bpm` : '-- bpm'}
        </Text>
      </View>
      <View className="items-end">
        <Text className="text-sm font-semibold text-zone-z2">{z2.toFixed(0)}%</Text>
        <Text className="text-text-muted text-[10px]">in Z2</Text>
      </View>
    </Pressable>
  );
});
