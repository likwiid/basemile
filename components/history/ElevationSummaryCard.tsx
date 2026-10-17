// SPDX-License-Identifier: GPL-3.0-or-later

import { memo } from 'react';
import { Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { OpenMeteoCredit } from '@/components/ui/OpenMeteoCredit';
import { Pill } from '@/components/ui/Pill';
import type { ElevationSource, ElevationStats } from '@/types';
import { ElevationQualityStrip } from './ElevationQualityStrip';

interface ElevationSummaryCardProps {
  stats: ElevationStats;
  /**
   * Canonical-profile fit for this run (median |profile − GPS| in metres).
   * Above FIT_WARN_M the profile disagrees with the run's good fixes enough
   * to flag the elevation numbers as suspect.
   */
  fitM?: number | null;
}

const FIT_WARN_M = 8;

function metersLabel(value: number): string {
  return `${Math.round(value)} m`;
}

function signedMetersLabel(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded} m`;
}

interface SourceBadge {
  label: string;
  textClassName: string;
}

function badgeFor(source: ElevationSource): SourceBadge {
  if (source === 'route') {
    // Barometric profile from a trusted run on this route — road, not terrain.
    return { label: 'Route-calibrated', textClassName: 'text-accent' };
  }
  if (source === 'dem') {
    return { label: 'DEM-corrected', textClassName: 'text-accent' };
  }
  if (source === 'hybrid') {
    return { label: 'Partly corrected', textClassName: 'text-zone-z3' };
  }
  return { label: 'GPS estimate', textClassName: 'text-text-secondary' };
}

export const ElevationSummaryCard = memo(function ElevationSummaryCard({ stats, fitM }: ElevationSummaryCardProps) {
  const badge = badgeFor(stats.source);
  const poorFit = typeof fitM === 'number' && Number.isFinite(fitM) && fitM > FIT_WARN_M;

  return (
    <Card className="p-3">
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-text-muted text-[10px] uppercase tracking-wider">
          Elevation
        </Text>
        <Pill label={badge.label} textClassName={badge.textClassName} />
      </View>

      <View className="flex-row">
        <View className="flex-1">
          <Text className="text-text-muted text-[10px] uppercase tracking-wider">
            Gain
          </Text>
          <Text className="text-accent text-2xl font-bold mt-0.5">
            {`↑ ${metersLabel(stats.total_gain_m)}`}
          </Text>
        </View>
        <View className="flex-1">
          <Text className="text-text-muted text-[10px] uppercase tracking-wider">
            Loss
          </Text>
          <Text className="text-zone-z5 text-2xl font-bold mt-0.5">
            {`↓ ${metersLabel(stats.total_loss_m)}`}
          </Text>
        </View>
      </View>

      <View className="flex-row mt-3 pt-3 border-t border-bg-border/60">
        <StatCell label="Net" value={signedMetersLabel(stats.net_m)} />
        <StatCell label="Max" value={metersLabel(stats.max_elevation_m)} />
        <StatCell label="Min" value={metersLabel(stats.min_elevation_m)} />
      </View>

      <View className="flex-row mt-3 pt-3 border-t border-bg-border/60">
        <StatCell label="Start" value={metersLabel(stats.start_elevation_m)} />
        <StatCell
          label="End"
          value={metersLabel(stats.end_elevation_m)}
        />
        <View className="flex-1" />
      </View>

      <View className="mt-4">
        <ElevationQualityStrip stats={stats} />
      </View>

      {poorFit ? (
        <Text className="text-zone-z3 text-[11px] mt-3">
          {`Route profile differs from this run's GPS by ~${Math.round(fitM)} m, so elevation figures may be off.`}
        </Text>
      ) : null}

      {stats.source === 'dem' || stats.source === 'hybrid' ? (
        <OpenMeteoCredit subject="Elevation" className="mt-3" />
      ) : null}
    </Card>
  );
});

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1">
      <Text className="text-text-muted text-[10px] uppercase tracking-wider">
        {label}
      </Text>
      <Text className="text-text-primary text-base font-semibold mt-1">
        {value}
      </Text>
    </View>
  );
}
