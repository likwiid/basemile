// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  detectLapCount,
  matchOrCreateRoute,
  routeWithRunStats,
  twoWayCoverage,
} from '@/lib/route/matching';
import type { CompletedRun, GpsPoint, RouteSummary } from '@/types';

function gps(timestamp: number, latitude: number, longitude: number): GpsPoint {
  return { timestamp, latitude, longitude, accuracy: 5 };
}

const DEG_10M = 0.00009; // ≈ 10 m at the equator

/**
 * A square loop of side ~360 m starting/ending at (0,0), one point every
 * ~10 m (144 points + closing point per lap).
 */
function squareLoop(laps = 1, sideSteps = 36): GpsPoint[] {
  const points: GpsPoint[] = [];
  let t = 0;
  const push = (lat: number, lon: number) => {
    points.push(gps(t * 5000, lat, lon));
    t += 1;
  };
  for (let lap = 0; lap < laps; lap += 1) {
    for (let i = 0; i < sideSteps; i += 1) push(0, i * DEG_10M); // east
    for (let i = 0; i < sideSteps; i += 1) push(i * DEG_10M, sideSteps * DEG_10M); // north
    for (let i = sideSteps; i > 0; i -= 1) push(sideSteps * DEG_10M, i * DEG_10M); // west
    for (let i = sideSteps; i > 0; i -= 1) push(i * DEG_10M, 0); // south
  }
  push(0, 0); // close the loop
  return points;
}

/** Square perimeter track (4 corners + close). */
function loopTrack(sideSteps = 36): string {
  const c = sideSteps * DEG_10M;
  return JSON.stringify([
    { latitude: 0, longitude: 0 },
    { latitude: 0, longitude: c },
    { latitude: c, longitude: c },
    { latitude: c, longitude: 0 },
    { latitude: 0, longitude: 0 },
  ]);
}

function route(over: Partial<RouteSummary>): RouteSummary {
  return {
    id: 'route-base',
    name: 'Route 3',
    fingerprint: 'fp',
    total_distance_m: 1440,
    avg_elevation_gain_m: 20,
    color: '#3b82f6',
    first_run_date: 1,
    run_count: 1,
    track_json: loopTrack(),
    ...over,
  };
}

describe('twoWayCoverage', () => {
  it('reads ~100/100 for a full lap of the route', () => {
    const { a, b } = twoWayCoverage(squareLoop(), JSON.parse(loopTrack()));
    expect(a).toBeGreaterThan(0.95);
    expect(b).toBeGreaterThan(0.95);
  });

  it('reads A high / B low for a partial traversal (variant signature)', () => {
    // Only the first two sides: on-route the whole time, covering ~half.
    const half = squareLoop().slice(0, 73);
    const { a, b } = twoWayCoverage(half, JSON.parse(loopTrack()));
    expect(a).toBeGreaterThan(0.95);
    expect(b).toBeLessThan(0.7);
  });

  it('reads A low for a run that leaves the route', () => {
    const offRoute = squareLoop().map((p, i) =>
      i % 2 === 0 ? { ...p, latitude: p.latitude + 40 * DEG_10M } : p
    );
    const { a } = twoWayCoverage(offRoute, JSON.parse(loopTrack()));
    expect(a).toBeLessThan(0.9);
  });
});

describe('detectLapCount', () => {
  it('detects a single lap', () => {
    expect(detectLapCount(squareLoop(1), JSON.parse(loopTrack()))).toBe(1);
  });

  it('detects a double lap', () => {
    expect(detectLapCount(squareLoop(2), JSON.parse(loopTrack()))).toBe(2);
  });

  it('counts one lap for a loop started mid-route', () => {
    const lap = squareLoop(1);
    const midStart = [...lap.slice(60), ...lap.slice(0, 60)].map((p, i) =>
      ({ ...p, timestamp: i * 5000 })
    );
    expect(detectLapCount(midStart, JSON.parse(loopTrack()))).toBe(1);
  });

  it('reports 1 for a run that never passes the start', () => {
    const partial = squareLoop().slice(40, 100);
    expect(detectLapCount(partial, JSON.parse(loopTrack()))).toBe(1);
  });
});

describe('matchOrCreateRoute', () => {
  it('creates a route when no similar route exists', () => {
    const result = matchOrCreateRoute({
      runId: 'run-1',
      runStartedAt: 1000,
      distanceM: 1440,
      ascentM: 25,
      points: squareLoop(),
      existingRoutes: [],
    });

    expect(result?.isNew).toBe(true);
    expect(result?.route.name).toBe('Route 1');
    expect(result?.route.parent_route_id).toBeUndefined();
    expect(result?.route.track_json).toContain('longitude');
    expect(result?.lapCount).toBe(1);
  });

  it('matches an existing route on a full traversal (A ≥ 90%, B ≥ 70%)', () => {
    const existing = route({});
    const result = matchOrCreateRoute({
      runId: 'run-2',
      runStartedAt: 2000,
      distanceM: 1450,
      ascentM: 30,
      points: squareLoop(),
      existingRoutes: [existing],
    });

    expect(result?.isNew).toBe(false);
    expect(result?.route.id).toBe('route-base');
    expect(result?.lapCount).toBe(1);
  });

  it('matches a double lap to the same route with lap_count 2', () => {
    const result = matchOrCreateRoute({
      runId: 'run-2laps',
      runStartedAt: 3000,
      distanceM: 2880,
      ascentM: 60,
      points: squareLoop(2),
      existingRoutes: [route({})],
    });

    expect(result?.isNew).toBe(false);
    expect(result?.route.id).toBe('route-base');
    expect(result?.lapCount).toBe(2);
  });

  it('creates a linked variant for an on-route partial traversal', () => {
    const half = squareLoop().slice(0, 73);
    const result = matchOrCreateRoute({
      runId: 'run-short',
      runStartedAt: 4000,
      distanceM: 720,
      ascentM: 10,
      points: half,
      existingRoutes: [route({})],
    });

    expect(result?.isNew).toBe(true);
    expect(result?.route.parent_route_id).toBe('route-base');
    expect(result?.route.name).toBe('Route 3 · short');
    expect(result?.route.color).toBe('#3b82f6'); // inherits the base color
  });

  it('links a variant-of-a-variant to the original full route', () => {
    const variant = route({
      id: 'route-variant',
      name: 'Route 3 · short',
      parent_route_id: 'route-base',
      // Track = first two sides only; a quarter run stays on it but covers <70%.
      track_json: JSON.stringify([
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 36 * DEG_10M },
        { latitude: 36 * DEG_10M, longitude: 36 * DEG_10M },
      ]),
    });
    const quarter = squareLoop().slice(0, 37); // first side only
    const result = matchOrCreateRoute({
      runId: 'run-quarter',
      runStartedAt: 5000,
      distanceM: 360,
      ascentM: 5,
      points: quarter,
      existingRoutes: [variant],
    });

    expect(result?.isNew).toBe(true);
    expect(result?.route.parent_route_id).toBe('route-base');
    expect(result?.route.name).toBe('Route 3 · short');
  });

  it('does not merge a short partial run into a longer disjoint route', () => {
    const existing = route({
      id: 'route-long',
      name: 'Long road',
      total_distance_m: 10_000,
      track_json: JSON.stringify([
        { latitude: 0.5, longitude: 0.5 },
        { latitude: 0.5, longitude: 0.59 },
      ]),
    });
    const result = matchOrCreateRoute({
      runId: 'run-elsewhere',
      runStartedAt: 6000,
      distanceM: 1440,
      ascentM: 5,
      points: squareLoop(),
      existingRoutes: [existing],
    });

    expect(result?.isNew).toBe(true);
    expect(result?.route.parent_route_id).toBeUndefined();
    expect(result?.route.name).toBe('Route 2');
  });
});

describe('routeWithRunStats', () => {
  function run(over: Partial<CompletedRun>): CompletedRun {
    return {
      id: 'r1',
      started_at: 1000,
      ended_at: 2000,
      session_id: null,
      type: 'long',
      duration_sec: 3600,
      distance_m: 6000,
      avg_hr: 140,
      max_hr: 150,
      avg_pace_sec_per_km: 600,
      maf_pace_sec_per_km: null,
      avg_cadence_spm: null,
      route_id: 'route-base',
      zone_distribution: { z1_sec: 0, z2_sec: 3600, z3_sec: 0, z4_sec: 0, z5_sec: 0 },
      splits: [],
      elevation: {
        total_gain_m: 100,
        total_loss_m: 100,
        net_m: 0,
        max_elevation_m: 700,
        min_elevation_m: 600,
        start_elevation_m: 650,
        end_elevation_m: 650,
        source: 'route',
        corrected: true,
        coverage_pct: 1,
        segments: [],
      },
      ascent_m: 100,
      ...over,
    };
  }

  it('normalizes multi-lap runs per lap in distance and gain averages', () => {
    const base = route({});
    const stats = routeWithRunStats(base, [
      run({ id: 'r1', distance_m: 6000, ascent_m: 100, lap_count: 1 }),
      run({ id: 'r2', distance_m: 12_000, ascent_m: 200, lap_count: 2 }),
    ]);
    expect(stats.total_distance_m).toBeCloseTo(6000, 0);
    expect(stats.avg_elevation_gain_m).toBeCloseTo(100, 0);
    expect(stats.run_count).toBe(2);
  });

  it('treats missing lap_count as a single lap', () => {
    const stats = routeWithRunStats(route({}), [
      run({ id: 'r1', distance_m: 6000, lap_count: null }),
      run({ id: 'r2', distance_m: 6200 }),
    ]);
    expect(stats.total_distance_m).toBeCloseTo(6100, 0);
  });
});
