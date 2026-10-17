// SPDX-License-Identifier: GPL-3.0-or-later

import { memo } from 'react';
import { Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import type { DecouplingResult } from '@/types';

interface DecouplingCardProps {
  result: DecouplingResult;
}

interface Verdict {
  label: string;
  colorClass: string;
}

function verdictFor(pct: number): Verdict {
  if (pct < 0) return { label: 'Negative split', colorClass: 'text-zone-z2' };
  if (pct < 5) return { label: 'Well-fueled and trained', colorClass: 'text-zone-z2' };
  if (pct <= 8) return { label: 'Mild drift, monitor', colorClass: 'text-zone-z3' };
  return { label: 'Significant drift, investigate fuel/hydration', colorClass: 'text-zone-z5' };
}

function formatPct(pct: number): string {
  const rounded = Math.round(pct * 10) / 10;
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded.toFixed(1)}%`;
}

export const DecouplingCard = memo(function DecouplingCard({ result }: DecouplingCardProps) {
  if (!result.reliable) {
    return (
      <Card className="p-3">
        <Text className="text-text-muted text-[10px] uppercase tracking-wider">
          Aerobic Decoupling
        </Text>
        <Text className="text-text-secondary text-sm mt-1.5">
          Run too short or HR too uneven for analysis
        </Text>
      </Card>
    );
  }

  const verdict = verdictFor(result.decoupling_pct);

  return (
    <Card className="p-3">
      <Text className="text-text-muted text-[10px] uppercase tracking-wider">
        Aerobic Decoupling
      </Text>
      <Text className={`text-3xl font-bold mt-1 ${verdict.colorClass}`}>
        {formatPct(result.decoupling_pct)}
      </Text>
      <Text className="text-text-secondary text-sm mt-1">{verdict.label}</Text>
      <View className="flex-row mt-3 pt-3 border-t border-bg-border/60">
        <View className="flex-1">
          <Text className="text-text-muted text-[10px] uppercase tracking-wider">
            1st half EF
          </Text>
          <Text className="text-text-primary text-base font-semibold mt-1">
            {result.first_half_efficiency.toFixed(4)}
          </Text>
        </View>
        <View className="flex-1">
          <Text className="text-text-muted text-[10px] uppercase tracking-wider">
            2nd half EF
          </Text>
          <Text className="text-text-primary text-base font-semibold mt-1">
            {result.second_half_efficiency.toFixed(4)}
          </Text>
        </View>
      </View>
    </Card>
  );
});
