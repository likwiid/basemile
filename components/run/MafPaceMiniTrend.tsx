// SPDX-License-Identifier: GPL-3.0-or-later

import { Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { formatDuration, formatPace } from '@/lib/time';
import type { CompletedRun } from '@/types';

interface MafPaceMiniTrendProps {
  current: CompletedRun;
  previousRuns: readonly CompletedRun[];
}

export function MafPaceMiniTrend({ current, previousRuns }: MafPaceMiniTrendProps) {
  const points = [current, ...previousRuns]
    .filter((r) => mafMetric(r) !== null)
    .slice(0, 4);
  if (points.length < 2) return null;

  const values = points.map((r) => mafMetric(r) ?? 0);
  const currentPace = points[0] ? mafMetric(points[0]) : null;
  const previousPace = points[1] ? mafMetric(points[1]) : null;
  const slowest = Math.max(...values);
  const fastest = Math.min(...values);
  const span = Math.max(1, slowest - fastest);
  const delta =
    currentPace !== null && previousPace !== null
      ? Math.round(currentPace - previousPace)
      : null;

  return (
    <Card className="p-3">
      <View className="flex-row items-baseline justify-between mb-2">
        <Text className="text-text-muted text-xs uppercase tracking-wider">
          GAP-MAF pace progress
        </Text>
        {currentPace !== null ? (
          <Text className="text-zone-z2 text-sm font-semibold">
            {formatPace(currentPace)}
          </Text>
        ) : null}
      </View>
      {delta !== null ? (
        <Text className="text-text-secondary text-[13px] leading-5 mb-3">
          {delta === 0
            ? 'Even with the previous MAF run.'
            : `${formatDuration(Math.abs(delta))}/km ${
                delta < 0 ? 'faster' : 'slower'
              } than the previous MAF run.`}
        </Text>
      ) : null}
      <View className="gap-2.5">
        {points.map((run, index) => {
          const pace = mafMetric(run) ?? 0;
          const width = 35 + ((slowest - pace) / span) * 65;
          return (
            <View key={run.id} className="gap-1">
              <View className="flex-row justify-between">
                <Text className="text-text-secondary text-xs">
                  {index === 0 ? 'Today' : `Run -${index}`}
                </Text>
                <Text className="text-text-primary text-xs font-mono">
                  {formatPace(pace)}
                </Text>
              </View>
              <View className="h-1.5 rounded-full bg-bg-elevated overflow-hidden">
                <View
                  className="h-1.5 rounded-full bg-zone-z2"
                  style={{ width: `${width}%`, opacity: index === 0 ? 1 : 0.55 }}
                />
              </View>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

function mafMetric(run: CompletedRun): number | null {
  return run.maf_gap_pace_sec_per_km ?? run.maf_pace_sec_per_km;
}
