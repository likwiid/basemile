// SPDX-License-Identifier: GPL-3.0-or-later

import { Text, View } from 'react-native';

import type { ElevationQuality, ElevationStats } from '@/types';

interface ElevationQualityStripProps {
  stats: ElevationStats;
}

/** Quality → fill color. Mirrors the legend below the strip. */
const QUALITY_COLOR: Record<ElevationQuality, string> = {
  good: '#10b981',
  fair: '#facc15',
  poor: '#f97316',
  missing: '#404040',
  corrected: '#3b82f6',
};

const QUALITY_LABEL: Record<ElevationQuality, string> = {
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
  missing: 'Missing',
  corrected: 'DEM',
};

const STRIP_HEIGHT = 12;

export function ElevationQualityStrip({ stats }: ElevationQualityStripProps) {
  const segments = stats.segments;
  const totalDistance = segments.reduce(
    (sum, s) => sum + (Number.isFinite(s.distance_m) ? Math.max(0, s.distance_m) : 0),
    0
  );

  // Which quality classes actually appear (for a compact, relevant legend).
  const present: ElevationQuality[] = [];
  for (const s of segments) {
    if (!present.includes(s.quality)) present.push(s.quality);
  }

  const coveragePct = Math.round(clamp01(stats.coverage_pct) * 100);

  return (
    <View>
      <View
        className="flex-row overflow-hidden rounded-full bg-bg-elevated/60"
        style={{ height: STRIP_HEIGHT }}
      >
        {totalDistance > 0 ? (
          segments.map((s, i) => {
            const width = (Math.max(0, s.distance_m) / totalDistance) * 100;
            if (width <= 0) return null;
            return (
              <View
                key={`${s.startIndex}-${s.endIndex}-${i}`}
                style={{
                  width: `${width}%`,
                  backgroundColor: QUALITY_COLOR[s.quality],
                }}
              />
            );
          })
        ) : (
          <View
            className="flex-1"
            style={{ backgroundColor: QUALITY_COLOR.missing }}
          />
        )}
      </View>

      <View className="flex-row items-center justify-between mt-2">
        <View className="flex-row flex-wrap" style={{ rowGap: 4, columnGap: 10 }}>
          {present.map((quality) => (
            <View key={quality} className="flex-row items-center" style={{ gap: 4 }}>
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  backgroundColor: QUALITY_COLOR[quality],
                }}
              />
              <Text className="text-text-secondary text-[10px]">
                {QUALITY_LABEL[quality]}
              </Text>
            </View>
          ))}
        </View>
        <Text className="text-text-secondary text-[11px] font-medium">
          {coveragePct}% reliable
        </Text>
      </View>
    </View>
  );
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
