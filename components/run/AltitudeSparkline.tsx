// SPDX-License-Identifier: GPL-3.0-or-later

import { memo, useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

/**
 * Minimal, allocation-light altitude sparkline. Takes a pre-sampled series of
 * altitudes (oldest → newest) and draws a single normalized polyline. Renders
 * nothing when there are fewer than two finite points to connect.
 *
 * Deliberately dumb: no axes, no labels, no animation. The caller is expected
 * to downsample before passing `values` so the path stays cheap at 1 Hz.
 */
export interface AltitudeSparklineProps {
  /** Altitude samples in chronological order. Non-finite entries are dropped. */
  values: number[];
  /** Stroke color. Defaults to the accent green. */
  color?: string;
  width?: number;
  height?: number;
}

function AltitudeSparklineComponent({
  values,
  color = '#10b981',
  width = 120,
  height = 28,
}: AltitudeSparklineProps) {
  const d = useMemo(
    () => buildPath(values, width, height),
    [values, width, height]
  );

  if (d === null) return null;

  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height}>
        <Path
          d={d}
          stroke={color}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
    </View>
  );
}

function buildPath(
  values: number[],
  width: number,
  height: number
): string | null {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length < 2) return null;

  let min = Infinity;
  let max = -Infinity;
  for (const v of finite) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min;
  // Flat track: pin to vertical center so we still draw a baseline.
  const pad = 2;
  const usableH = height - pad * 2;
  const step = finite.length > 1 ? width / (finite.length - 1) : width;

  let path = '';
  for (let i = 0; i < finite.length; i++) {
    const v = finite[i] as number;
    const x = i * step;
    const norm = span > 0 ? (v - min) / span : 0.5;
    // SVG y grows downward; invert so higher altitude sits higher.
    const y = pad + (1 - norm) * usableH;
    path += `${i === 0 ? 'M' : 'L'}${round(x)} ${round(y)} `;
  }
  return path.trim();
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export const AltitudeSparkline = memo(AltitudeSparklineComponent);
