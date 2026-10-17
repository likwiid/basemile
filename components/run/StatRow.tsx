// SPDX-License-Identifier: GPL-3.0-or-later

import { Text, View } from 'react-native';

import { formatDistance, formatDuration, formatPace } from '@/lib/time';

interface StatRowProps {
  elapsedSec: number;
  distanceM: number;
  paceSecPerKm: number | null;
  cadenceSpm: number | null;
  cadenceTarget: number;
  cadenceTargetLabel?: string;
}

interface MetricProps {
  label: string;
  value: string;
  unit?: string;
  sublabel?: string;
}

export function StatRow({
  elapsedSec,
  distanceM,
  paceSecPerKm,
  cadenceSpm,
  cadenceTarget,
  cadenceTargetLabel,
}: StatRowProps) {
  return (
    <View className="gap-1.5">
      <View className="flex-row gap-1.5">
        <Metric label="Pace" value={formatPace(paceSecPerKm ?? 0)} />
        <Metric label="Distance" value={formatDistance(distanceM)} />
      </View>
      <View className="flex-row gap-1.5">
        <Metric
          label="Cadence"
          value={cadenceSpm !== null ? String(Math.round(cadenceSpm)) : '--'}
          unit="spm"
          sublabel={cadenceTargetLabel ?? `target ${cadenceTarget}`}
        />
        <Metric label="Time" value={formatDuration(elapsedSec)} />
      </View>
    </View>
  );
}

function Metric({ label, value, unit, sublabel }: MetricProps) {
  return (
    <View className="flex-1 rounded-lg border border-bg-border/80 bg-bg-card/50 px-2.5 py-2">
      <Text className="text-text-muted text-[10px] font-semibold uppercase">
        {label}
      </Text>
      <View className="flex-row items-baseline mt-0.5">
        <Text className="text-text-primary text-xl font-bold">{value}</Text>
        {unit ? <Text className="text-text-muted text-xs ml-1">{unit}</Text> : null}
      </View>
      {sublabel ? (
        <Text className="text-text-muted text-[11px] mt-0.5">{sublabel}</Text>
      ) : null}
    </View>
  );
}
