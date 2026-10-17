// SPDX-License-Identifier: GPL-3.0-or-later

import { memo } from 'react';
import { Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { OpenMeteoCredit } from '@/components/ui/OpenMeteoCredit';
import { MafPaceMiniTrend } from '@/components/run/MafPaceMiniTrend';
import { RunInsights } from '@/components/run/RunInsights';
import { totalZoneSec, zoneSeconds } from '@/lib/metrics/zones';
import { zoneColor } from '@/lib/zones';
import { formatDistance, formatDuration, formatPace } from '@/lib/time';
import { weatherLabel } from '@/lib/run/weather';
import type { CompletedRun, HRSample, HRSampleRecord, ZoneConfig, ZoneNumber } from '@/types';

interface RunSummaryProps {
  run: CompletedRun;
  zones: ZoneConfig;
  samples?: readonly (HRSample | HRSampleRecord)[];
  previousRuns?: CompletedRun[];
}

const ZONES: readonly ZoneNumber[] = [1, 2, 3, 4, 5];
const NO_SAMPLES: readonly (HRSample | HRSampleRecord)[] = [];
const NO_RUNS: CompletedRun[] = [];

/** Memoized: the summary sits above note/context editors that re-render per keystroke. */
export const RunSummary = memo(function RunSummary({
  run,
  zones,
  samples = NO_SAMPLES,
  previousRuns = NO_RUNS,
}: RunSummaryProps) {
  const totalSec = totalZoneSec(run.zone_distribution);
  const hasSecondaryMarkers =
    run.maf_pace_sec_per_km !== null ||
    run.avg_gap_sec_per_km !== null ||
    run.maf_gap_pace_sec_per_km !== null ||
    run.avg_cadence_spm !== null ||
    (run.recovery_hr_drop !== undefined && run.recovery_hr_drop > 0);
  const paceDelta =
    run.avg_gap_sec_per_km !== null && run.avg_gap_sec_per_km !== undefined
      ? Math.round(run.avg_gap_sec_per_km - run.avg_pace_sec_per_km)
      : null;

  return (
    <View className="gap-3">
      <Card className="p-3">
        <View className="flex-row gap-2">
          <SummaryMetric
            label="Time"
            value={formatDuration(run.duration_sec)}
            className="flex-1"
            featured
          />
          <SummaryMetric
            label="Distance"
            value={formatDistance(run.distance_m)}
            className="flex-1"
            featured
          />
        </View>
        <View className="flex-row gap-2 mt-3">
          <SummaryMetric
            label="Avg HR"
            value={run.avg_hr > 0 ? String(run.avg_hr) : '--'}
            className="flex-1"
          />
          <SummaryMetric
            label="Max HR"
            value={run.max_hr > 0 ? String(run.max_hr) : '--'}
            className="flex-1"
          />
          <SummaryMetric
            label="Avg Pace"
            value={run.avg_pace_sec_per_km > 0 ? formatPace(run.avg_pace_sec_per_km) : '--'}
            className="flex-1"
          />
          <SummaryMetric
            label="GAP"
            value={run.avg_gap_sec_per_km ? formatPace(run.avg_gap_sec_per_km) : '--'}
            hint={paceDelta !== null ? formatGapDelta(paceDelta) : undefined}
            className="flex-1"
            valueClassName="text-zone-z2"
          />
        </View>
        {hasSecondaryMarkers ? (
          <View className="flex-row flex-wrap gap-2 mt-3 pt-3 border-t border-bg-border/60">
            {run.maf_pace_sec_per_km !== null ? (
              <SummaryMetric
                label="MAF Pace"
                value={formatPace(run.maf_pace_sec_per_km)}
                hint={
                  run.maf_ceiling != null
                    ? `${run.maf_ceiling - 4}-${run.maf_ceiling} bpm`
                    : 'MAF window'
                }
                valueClassName="text-zone-z2"
                className="flex-1"
              />
            ) : null}
            {run.maf_gap_pace_sec_per_km !== null && run.maf_gap_pace_sec_per_km !== undefined ? (
              <SummaryMetric
                label="MAF GAP"
                value={formatPace(run.maf_gap_pace_sec_per_km)}
                hint="terrain adjusted"
                valueClassName="text-zone-z2"
                className="flex-1"
              />
            ) : null}
            {run.avg_cadence_spm !== null && run.avg_cadence_spm !== undefined ? (
              <SummaryMetric
                label="Cadence"
                value={`${Math.round(run.avg_cadence_spm)}`}
                hint="spm"
                className="flex-1"
              />
            ) : null}
            {run.recovery_hr_drop !== undefined && run.recovery_hr_drop > 0 ? (
              <SummaryMetric
                label="60s Drop"
                value={`${run.recovery_hr_drop} bpm`}
                className="flex-1"
              />
            ) : null}
          </View>
        ) : null}
        <View className="mt-3 pt-3 border-t border-bg-border/60">
          <Text className="text-text-secondary text-xs">
            {weatherLabel(run.weather)}
          </Text>
          {run.weather?.source === 'open-meteo' ? <OpenMeteoCredit className="mt-1" /> : null}
          {run.ascent_m !== undefined || run.descent_m !== undefined ? (
            <Text className="text-text-muted text-xs mt-1">
              Elevation +{Math.round(run.ascent_m ?? 0)}m / -{Math.round(run.descent_m ?? 0)}m
            </Text>
          ) : null}
        </View>
      </Card>

      <MafPaceMiniTrend current={run} previousRuns={previousRuns} />

      <Card className="p-3">
        <View className="flex-row items-baseline justify-between mb-3">
          <Text className="text-text-muted text-xs uppercase tracking-wider">
            Time in zone
          </Text>
          <Text className="text-text-muted text-[11px]">
            {formatDuration(Math.round(totalSec))}
          </Text>
        </View>
        <View className="h-3 flex-row rounded-full overflow-hidden bg-bg-elevated">
          {ZONES.map((zone) => {
            const sec = zoneSeconds(run.zone_distribution, zone);
            const pct = totalSec > 0 ? (sec / totalSec) * 100 : 0;
            if (pct <= 0) return null;
            return (
              <View
                key={zone}
                style={{ width: `${pct}%`, backgroundColor: zoneColor(zone) }}
              />
            );
          })}
        </View>
        <View className="flex-row justify-between mt-2.5">
          {ZONES.map((zone) => {
            const sec = zoneSeconds(run.zone_distribution, zone);
            return (
              <View key={zone} className="items-center">
                <View
                  className="w-3 h-2 rounded-full"
                  style={{ backgroundColor: zoneColor(zone) }}
                />
                <Text className="text-text-secondary text-xs mt-1">Z{zone}</Text>
                <Text className="text-text-primary text-xs font-semibold">
                  {formatDuration(Math.round(sec))}
                </Text>
              </View>
            );
          })}
        </View>
      </Card>

      <RunInsights
        run={run}
        zones={zones}
        samples={samples}
        previousRuns={previousRuns}
      />

      {run.splits.length > 0 ? (
        <Card className="p-3">
          <View className="flex-row items-baseline justify-between mb-2">
            <Text className="text-text-muted text-xs uppercase tracking-wider">
              Splits
            </Text>
            <Text className="text-text-muted text-[11px]">
              {run.splits.length} km
            </Text>
          </View>
          {run.splits.map((s, i) => (
            <View
              key={s.km}
              className={`flex-row items-center justify-between py-1.5 ${
                i < run.splits.length - 1 ? 'border-b border-bg-border' : ''
              }`}
            >
              <Text className="text-text-primary text-sm font-semibold">Km {s.km}</Text>
              <Text className="text-text-primary text-sm font-mono">
                {formatDuration(s.duration_sec)}
              </Text>
              <Text className="text-text-secondary text-sm">
                {s.avg_hr > 0 ? `${s.avg_hr} bpm` : '--'}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}

    </View>
  );
});

function formatGapDelta(deltaSec: number): string {
  if (deltaSec === 0) return 'same as raw';
  return `${deltaSec > 0 ? '+' : '−'}${formatDuration(Math.abs(deltaSec))}/km`;
}

interface SummaryMetricProps {
  label: string;
  value: string;
  hint?: string;
  className?: string;
  valueClassName?: string;
  featured?: boolean;
}

function SummaryMetric({
  label,
  value,
  hint,
  className,
  valueClassName,
  featured = false,
}: SummaryMetricProps) {
  return (
    <View className={className}>
      <Text className="text-text-muted text-[10px] uppercase tracking-wider">
        {label}
      </Text>
      <Text
        className={`${featured ? 'text-xl' : 'text-base'} font-semibold mt-0.5 ${
          valueClassName ?? 'text-text-primary'
        }`}
      >
        {value}
      </Text>
      {hint ? <Text className="text-text-muted text-[11px] mt-0.5">{hint}</Text> : null}
    </View>
  );
}
