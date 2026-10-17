// SPDX-License-Identifier: GPL-3.0-or-later

import { haversineMeters } from '@/lib/run/distance';
import { classifyHR } from '@/lib/zones';
import type { GpsPoint, HRSample, ZoneConfig, ZoneNumber } from '@/types';

export interface RouteCoordinate {
  latitude: number;
  longitude: number;
}

export interface RouteZoneSegment {
  zone: ZoneNumber;
  coordinates: RouteCoordinate[];
}

export interface RouteNote {
  kind: 'hill' | 'hr_spike';
  label: string;
}

const HR_MATCH_WINDOW_MS = 15_000;
const MIN_ALTITUDE_POINTS = 6;
const MAX_RELIABLE_ACCURACY_M = 35;

export function routeZoneSegments(
  points: GpsPoint[],
  hrSamples: HRSample[],
  zones?: ZoneConfig
): RouteZoneSegment[] {
  if (points.length < 2 || !zones || hrSamples.length === 0) return [];

  const segments: RouteZoneSegment[] = [];
  let hrIndex = 0;
  let canExtendPreviousSegment = false;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (!prev || !curr) {
      canExtendPreviousSegment = false;
      continue;
    }

    const midpointTs = prev.timestamp + (curr.timestamp - prev.timestamp) / 2;
    while (
      hrIndex + 1 < hrSamples.length &&
      Math.abs((hrSamples[hrIndex + 1]?.timestamp ?? Infinity) - midpointTs) <=
        Math.abs((hrSamples[hrIndex]?.timestamp ?? Infinity) - midpointTs)
    ) {
      hrIndex += 1;
    }

    const sample = hrSamples[hrIndex];
    if (!sample || Math.abs(sample.timestamp - midpointTs) > HR_MATCH_WINDOW_MS) {
      canExtendPreviousSegment = false;
      continue;
    }
    const zone = classifyHR(sample.bpm, zones);
    if (zone === null) {
      canExtendPreviousSegment = false;
      continue;
    }

    const last = segments[segments.length - 1];
    const start = toCoordinate(prev);
    const end = toCoordinate(curr);
    if (canExtendPreviousSegment && last && last.zone === zone) {
      last.coordinates.push(end);
    } else {
      segments.push({ zone, coordinates: [start, end] });
    }
    canExtendPreviousSegment = true;
  }

  return segments;
}

export function routeNote(points: GpsPoint[], hrSamples: HRSample[]): RouteNote | null {
  if (points.length < 2) return null;

  const hill = hillNote(points, hrSamples);
  if (hill) return hill;

  return hrSpikeNote(points, hrSamples);
}

function hillNote(points: GpsPoint[], hrSamples: HRSample[]): RouteNote | null {
  if (!hasReliableAltitude(points)) return null;

  let bestGain = 0;
  let bestDistance = 0;
  let bestStartTs = 0;
  let bestEndTs = 0;
  let gain = 0;
  let distance = 0;
  let startTs = points[0]?.timestamp ?? 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (!prev || !curr || prev.altitude == null || curr.altitude == null) continue;
    const delta = curr.altitude - prev.altitude;
    const segmentDistance = haversineMeters(prev, curr);

    if (delta > 0) {
      if (gain === 0) startTs = prev.timestamp;
      gain += delta;
      distance += segmentDistance;
      if (gain > bestGain) {
        bestGain = gain;
        bestDistance = distance;
        bestStartTs = startTs;
        bestEndTs = curr.timestamp;
      }
    } else {
      gain = 0;
      distance = 0;
    }
  }

  if (bestGain < 8 || bestDistance < 80) return null;

  const peakHr = maxHrInWindow(hrSamples, bestStartTs, bestEndTs);
  const hrSuffix = peakHr ? `, HR peaked ${peakHr}` : '';
  return {
    kind: 'hill',
    label: `Hill: +${Math.round(bestGain)} m over ${formatDistance(bestDistance)}${hrSuffix}`,
  };
}

function hrSpikeNote(points: GpsPoint[], hrSamples: HRSample[]): RouteNote | null {
  if (hrSamples.length < 2) return null;

  let bestRise = 0;
  let bestSeconds = 0;
  let bestTimestamp = 0;

  for (let i = 0; i < hrSamples.length; i++) {
    const start = hrSamples[i];
    if (!start) continue;
    for (let j = i + 1; j < hrSamples.length; j++) {
      const end = hrSamples[j];
      if (!end) continue;
      const elapsedMs = end.timestamp - start.timestamp;
      if (elapsedMs > 120_000) break;
      if (elapsedMs < 30_000) continue;

      const rise = end.bpm - start.bpm;
      if (rise > bestRise) {
        bestRise = rise;
        bestSeconds = Math.round(elapsedMs / 1000);
        bestTimestamp = end.timestamp;
      }
    }
  }

  if (bestRise < 18) return null;

  const km = distanceToTimestamp(points, bestTimestamp) / 1000;
  return {
    kind: 'hr_spike',
    label: `HR spike: +${Math.round(bestRise)} bpm in ${bestSeconds}s near ${km.toFixed(1)} km`,
  };
}

function hasReliableAltitude(points: GpsPoint[]): boolean {
  let altitudeCount = 0;
  let accurateCount = 0;

  for (const point of points) {
    if (point.altitude == null || !Number.isFinite(point.altitude)) continue;
    altitudeCount += 1;
    if (point.accuracy == null || point.accuracy <= MAX_RELIABLE_ACCURACY_M) {
      accurateCount += 1;
    }
  }

  return (
    altitudeCount >= MIN_ALTITUDE_POINTS &&
    accurateCount / altitudeCount >= 0.7
  );
}

function maxHrInWindow(samples: HRSample[], startMs: number, endMs: number): number | null {
  let max = 0;
  for (const sample of samples) {
    if (sample.timestamp >= startMs && sample.timestamp <= endMs && sample.bpm > max) {
      max = sample.bpm;
    }
  }
  return max > 0 ? max : null;
}

function distanceToTimestamp(points: GpsPoint[], timestamp: number): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (!prev || !curr) continue;
    const segmentDistance = haversineMeters(prev, curr);
    if (timestamp <= curr.timestamp) {
      const span = curr.timestamp - prev.timestamp;
      const ratio = span > 0 ? Math.max(0, Math.min(1, (timestamp - prev.timestamp) / span)) : 0;
      return total + segmentDistance * ratio;
    }
    total += segmentDistance;
  }
  return total;
}

function formatDistance(meters: number): string {
  const rounded = Math.round(meters);
  if (rounded < 1000) return `${rounded} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function toCoordinate(point: GpsPoint): RouteCoordinate {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
  };
}
