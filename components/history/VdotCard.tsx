// SPDX-License-Identifier: GPL-3.0-or-later

import { memo } from 'react';
import { Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { Stat } from '@/components/ui/Stat';
import { racePredictions } from '@/lib/metrics/vdot';
import { formatDuration, formatPace, parseISO } from '@/lib/time';
import type { RaceProjection, VdotResult } from '@/types';

interface VdotCardProps {
  result: VdotResult | null;
}

const RACE_LABELS: Record<number, string> = {
  5000: '5K',
  10000: '10K',
  21097.5: 'Half',
  42195: 'Full',
};

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

function formatSourceDate(iso: string): string {
  const d = parseISO(iso);
  const dow = WEEKDAY_LABELS[d.getUTCDay()];
  const mon = MONTH_LABELS[d.getUTCMonth()];
  const day = d.getUTCDate();
  return `${dow} ${day} ${mon}`;
}

function ProjectionRow({ projection }: { projection: RaceProjection }) {
  const label = RACE_LABELS[projection.distance_m] ?? `${projection.distance_m} m`;
  return (
    <View className="flex-row items-baseline justify-between py-2">
      <Text className="text-text-primary text-base font-semibold w-16">{label}</Text>
      <Text className="text-text-primary text-base font-mono flex-1 text-right mr-3">
        {formatDuration(projection.predicted_sec)}
      </Text>
      <Text className="text-text-secondary text-xs font-mono w-20 text-right">
        {formatPace(projection.predicted_pace_sec_per_km)}
      </Text>
    </View>
  );
}

export const VdotCard = memo(function VdotCard({ result }: VdotCardProps) {
  if (!result) {
    return (
      <Card className="p-3">
        <Text className="text-text-muted text-xs uppercase tracking-wider">Aerobic score</Text>
        <Text className="text-text-secondary text-sm mt-2">
          Run at MAF pace to compute your aerobic fitness marker
        </Text>
      </Card>
    );
  }

  const projections = racePredictions(result.vdot);

  return (
    <Card className="p-3">
      <Stat
        label="Aerobic score"
        value={result.vdot.toFixed(1)}
        sublabel="MAF-based fitness marker"
      />
      <Text className="text-text-muted text-xs mt-1.5">
        Based on {formatSourceDate(result.source_date)} GAP-MAF pace
      </Text>

      <View className="bg-bg-elevated/55 border border-bg-border/60 rounded-lg mt-3 px-3 py-2">
        <Text className="text-text-muted text-[10px] uppercase tracking-wider mb-1">
          Conservative race estimates
        </Text>
        {projections.map((p) => (
          <ProjectionRow key={p.distance_m} projection={p} />
        ))}
        <Text className="text-text-muted text-[10px] mt-1.5 leading-4">
          From easy aerobic (MAF) pace. True race potential is faster.
        </Text>
      </View>
    </Card>
  );
});
