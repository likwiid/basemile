// SPDX-License-Identifier: GPL-3.0-or-later

import { useMemo } from 'react';
import { Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { runReport, type RunReportSection } from '@/lib/metrics/insights';
import type { CompletedRun, HRSample, HRSampleRecord, ZoneConfig } from '@/types';

interface RunInsightsProps {
  run: CompletedRun;
  zones: ZoneConfig;
  samples?: readonly (HRSample | HRSampleRecord)[];
  previousRuns?: readonly CompletedRun[];
}

const NO_SAMPLES: readonly (HRSample | HRSampleRecord)[] = [];
const NO_RUNS: readonly CompletedRun[] = [];

export function RunInsights({
  run,
  zones,
  samples = NO_SAMPLES,
  previousRuns = NO_RUNS,
}: RunInsightsProps) {
  const report = useMemo(
    () => runReport(run, zones, samples, previousRuns),
    [run, zones, samples, previousRuns]
  );
  const sections: RunReportSection[] = [
    report.next,
    report.whatHappened,
    report.mafProgress,
    report.splits,
    report.comparison,
  ].filter((section) => section.items.length > 0);

  if (sections.length === 0) return null;

  return (
    <Card className="p-3">
      <View className="flex-row items-baseline justify-between mb-3">
        <Text className="text-text-muted text-xs uppercase tracking-wider">
          Run report
        </Text>
        <Text className="text-text-muted text-[11px]">
          {sections.length} section{sections.length === 1 ? '' : 's'}
        </Text>
      </View>

      <View className="gap-3">
        {sections.map((section, sectionIndex) => {
          const isPriority = section.title === report.next.title;
          return (
            <View
              key={section.title}
              className={
                isPriority
                  ? 'bg-bg-elevated/45 border border-bg-border/60 rounded-lg p-3'
                  : sectionIndex === 0
                    ? ''
                    : 'border-t border-bg-border/60 pt-3'
              }
            >
              <Text
                className={`text-sm font-semibold mb-2 ${
                  isPriority ? 'text-text-primary' : 'text-text-secondary'
                }`}
              >
                {section.title}
              </Text>
              <View className="gap-1.5">
                {section.items.map((item) => (
                  <View key={item} className="flex-row gap-2.5">
                    <View
                      className={`h-1.5 w-1.5 rounded-full mt-2 ${
                        isPriority ? 'bg-accent' : 'bg-bg-border'
                      }`}
                    />
                    <Text className="text-text-primary text-[13px] leading-5 flex-1">
                      {item}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          );
        })}
      </View>
    </Card>
  );
}
