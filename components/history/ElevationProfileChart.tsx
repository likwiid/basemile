// SPDX-License-Identifier: GPL-3.0-or-later

import { memo, useCallback, useMemo, useState } from 'react';
import { LayoutChangeEvent, Text, View } from 'react-native';
import Svg, { Line, Path, Text as SvgText } from 'react-native-svg';

import { CHART_MAX_POINTS, extent, lttb } from '@/lib/charts/downsample';
import { buildElevationProfile, linePath, type ProfilePoint } from '@/lib/charts/series';
import type { GpsPointRecord } from '@/types';
import { CHART_COLORS, CHART_EMPTY_CLASS } from './chartColors';

interface ElevationProfileChartProps {
  points: GpsPointRecord[];
  height?: number;
}

/** Accent green for the area fill / climb emphasis — matches `text-accent`. */
const ACCENT = '#10b981';

const PADDING = { top: 8, right: 12, bottom: 24, left: 40 };

const profileDistance = (p: ProfilePoint) => p.distanceM;
const profileElevation = (p: ProfilePoint) => p.elevationM;

export const ElevationProfileChart = memo(function ElevationProfileChart({
  points,
  height = 180,
}: ElevationProfileChartProps) {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback(
    (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width),
    []
  );

  const profile = useMemo(() => buildElevationProfile(points), [points]);
  const [minElev, maxElev] = useMemo(
    () => extent(profile, profileElevation),
    [profile]
  );
  const drawn = useMemo(
    () => lttb(profile, CHART_MAX_POINTS, profileDistance, profileElevation),
    [profile]
  );

  const innerW = Math.max(0, width - PADDING.left - PADDING.right);
  const innerH = Math.max(0, height - PADDING.top - PADDING.bottom);

  const distEnd = profile[profile.length - 1]?.distanceM ?? 0;
  const distSpan = Math.max(1, distEnd);

  // Pad the vertical range a touch so flat tracks don't hug an edge.
  const pad = Math.max(2, (maxElev - minElev) * 0.08);
  const yLo = minElev - pad;
  const yHi = maxElev + pad;
  const elevSpan = Math.max(1, yHi - yLo);

  const xFor = (distanceM: number) =>
    PADDING.left + (distanceM / distSpan) * innerW;
  const yFor = (elevationM: number) =>
    PADDING.top + innerH - ((elevationM - yLo) / elevSpan) * innerH;

  const lineD = useMemo(
    () =>
      linePath(
        drawn,
        (p) => PADDING.left + (p.distanceM / distSpan) * innerW,
        (p) => PADDING.top + innerH - ((p.elevationM - yLo) / elevSpan) * innerH
      ),
    [drawn, distSpan, innerW, innerH, yLo, elevSpan]
  );

  if (profile.length < 2) {
    return (
      <View className={CHART_EMPTY_CLASS} style={{ height }}>
        <Text className="text-text-muted text-sm text-center">
          No elevation data
        </Text>
      </View>
    );
  }

  // Closed area: trace, then drop to baseline and close back to the start.
  const baselineY = PADDING.top + innerH;
  const firstX = xFor(profile[0]?.distanceM ?? 0);
  const lastX = xFor(distEnd);
  const areaD = `${lineD} L ${lastX.toFixed(1)} ${baselineY.toFixed(
    1
  )} L ${firstX.toFixed(1)} ${baselineY.toFixed(1)} Z`;

  const distKmTotal = distEnd / 1000;
  const distLabels = [0, distKmTotal * 0.5, distKmTotal];

  return (
    <View onLayout={onLayout}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          {/* horizontal grid lines */}
          {[0.25, 0.5, 0.75].map((p) => {
            const y = PADDING.top + innerH * p;
            return (
              <Line
                key={p}
                x1={PADDING.left}
                x2={PADDING.left + innerW}
                y1={y}
                y2={y}
                stroke={CHART_COLORS.grid}
                strokeWidth={1}
              />
            );
          })}

          {/* subtle accent-green area fill under the profile */}
          <Path d={areaD} fill={ACCENT} fillOpacity={0.12} stroke="none" />

          {/* elevation trace */}
          <Path
            d={lineD}
            stroke={CHART_COLORS.trace}
            strokeWidth={1.5}
            fill="none"
          />

          {/* Y axis: min / mid / max elevation in meters */}
          {[yLo, (yLo + yHi) / 2, yHi].map((m) => (
            <SvgText
              key={m}
              x={PADDING.left - 6}
              y={yFor(m) + 4}
              fontSize={10}
              fill={CHART_COLORS.axisText}
              textAnchor="end"
            >
              {`${Math.round(m)}m`}
            </SvgText>
          ))}

          {/* X axis: distance in km */}
          {distLabels.map((km, i) => {
            const x = PADDING.left + (distKmTotal > 0 ? km / distKmTotal : 0) * innerW;
            return (
              <SvgText
                key={i}
                x={x}
                y={height - 6}
                fontSize={10}
                fill={CHART_COLORS.axisText}
                textAnchor="middle"
              >
                {`${km.toFixed(km >= 10 ? 0 : 1)}km`}
              </SvgText>
            );
          })}
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
    </View>
  );
});
