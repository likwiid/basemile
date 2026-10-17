// SPDX-License-Identifier: GPL-3.0-or-later

import { memo, useMemo } from 'react';
import { Text, View } from 'react-native';

import { ELEVATION } from '@/config/constants';
import { sampleAltitudes } from '@/lib/run/liveTrack';
import { useActiveRunStore } from '@/lib/run/store';
import type { GpsPoint } from '@/types';

import { AltitudeSparkline } from './AltitudeSparkline';
import { useThrottledTrack } from './liveRunHooks';

/**
 * The sparkline is a ~40-sample overview of the whole run, so refreshing it
 * every few seconds is visually identical to 1 Hz but skips a full scan of the
 * 3-4k point track on every fix.
 */
const SPARKLINE_REFRESH_MS = 3000;

const ACCENT_GREEN = '#10b981'; // accent / zone-z2 — gain
const ORANGE = '#f97316'; // zone-z4 — loss

type FixQuality = 'good' | 'fair' | 'poor' | 'none';

const FIX_META: Record<FixQuality, { color: string; label: string }> = {
  good: { color: '#10b981', label: 'GPS good' },
  fair: { color: '#facc15', label: 'GPS fair' },
  poor: { color: '#ef4444', label: 'GPS poor' },
  none: { color: '#737373', label: 'No fix' },
};

export interface ElevationWidgetProps {
  /**
   * Render the altitude sparkline. Defaults to true. Turn off to save the SVG
   * pass on very constrained screens.
   */
  showSparkline?: boolean;
  /**
   * Max altitude samples used to draw the sparkline (the track is downsampled
   * to roughly this many points). Defaults to 40.
   */
  sparklineSamples?: number;
}

/**
 * Live elevation card for the active run. Self-contained: reads cumulative
 * gain/loss, current altitude, and the latest GPS fix straight from
 * `useActiveRunStore`. Matches the StatRow card styling.
 *
 * Subscribes only to the live elevation scalars and the latest fix's quality
 * bucket, so it repaints when a displayed number changes. The sparkline reads
 * a throttled view of the track (SPARKLINE_REFRESH_MS) and is downsampled.
 */
function ElevationWidgetComponent({
  showSparkline = true,
  sparklineSamples = 40,
}: ElevationWidgetProps) {
  const gainM = useActiveRunStore((s) => s.live_elevation_gain_m);
  const lossM = useActiveRunStore((s) => s.live_elevation_loss_m);
  const altitudeM = useActiveRunStore((s) => s.current_altitude_m);
  // Primitive selector: re-renders only when the quality bucket flips.
  const fix = useActiveRunStore((s) =>
    classifyFix(s.gps_count > 0 ? s.gps_points[s.gps_count - 1] : undefined)
  );
  const meta = FIX_META[fix];

  const track = useThrottledTrack(SPARKLINE_REFRESH_MS);
  const altSeries = useMemo(
    () =>
      showSparkline
        ? sampleAltitudes(track.points.slice(0, track.count), sparklineSamples)
        : [],
    [showSparkline, track.points, track.count, sparklineSamples]
  );

  return (
    <View className="rounded-xl border border-bg-border/70 bg-bg-card/80 px-3 py-2.5">
      <View className="flex-row items-center justify-between">
        <Text className="text-text-muted text-[10px] font-semibold uppercase tracking-wider">
          Elevation
        </Text>
        <View className="flex-row items-center gap-1.5">
          <View
            style={{
              width: 7,
              height: 7,
              borderRadius: 3.5,
              backgroundColor: meta.color,
            }}
          />
          <Text className="text-text-muted text-[10px] font-semibold uppercase tracking-wider">
            {meta.label}
          </Text>
        </View>
      </View>

      <View className="mt-1.5 flex-row items-end justify-between">
        <View className="flex-row items-end gap-4">
          <Stat
            symbol="↑"
            symbolColor={ACCENT_GREEN}
            value={formatMeters(gainM)}
            label="gain"
          />
          <Stat
            symbol="↓"
            symbolColor={ORANGE}
            value={formatMeters(lossM)}
            label="loss"
          />
          <Stat
            value={altitudeM !== null ? formatMeters(altitudeM) : '--'}
            label="altitude"
          />
        </View>

        {showSparkline && altSeries.length >= 2 ? (
          <AltitudeSparkline values={altSeries} color={ACCENT_GREEN} />
        ) : null}
      </View>
    </View>
  );
}

interface StatProps {
  symbol?: string;
  symbolColor?: string;
  value: string;
  label: string;
}

function Stat({ symbol, symbolColor, value, label }: StatProps) {
  return (
    <View>
      <View className="flex-row items-baseline">
        {symbol ? (
          <Text
            className="font-mono text-base font-bold mr-0.5"
            style={{ color: symbolColor }}
          >
            {symbol}
          </Text>
        ) : null}
        <Text className="text-text-primary font-mono text-lg font-bold">
          {value}
        </Text>
        <Text className="text-text-muted text-xs ml-0.5">m</Text>
      </View>
      <Text className="text-text-muted text-[10px] uppercase tracking-wider">
        {label}
      </Text>
    </View>
  );
}

/**
 * Classify the latest fix's elevation/horizontal accuracy against the shared
 * ELEVATION thresholds. Prefers vertical accuracy, falls back to horizontal.
 * No point or no usable accuracy → 'none'.
 */
function classifyFix(point: GpsPoint | undefined): FixQuality {
  if (!point) return 'none';
  const acc =
    point.altitudeAccuracy != null && Number.isFinite(point.altitudeAccuracy)
      ? point.altitudeAccuracy
      : point.accuracy != null && Number.isFinite(point.accuracy)
        ? point.accuracy
        : null;
  if (acc === null || acc < 0) return 'none';
  if (acc <= ELEVATION.GOOD_ACCURACY_M) return 'good';
  if (acc <= ELEVATION.POOR_ACCURACY_M) return 'fair';
  return 'poor';
}

function formatMeters(m: number): string {
  return String(Math.round(m));
}

export const ElevationWidget = memo(ElevationWidgetComponent);
