// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * One-time re-evaluation of run→route assignments under the two-way coverage
 * rule (migration:route-variants-v1).
 *
 * The old matcher pooled anything scoring ≥0.7 min-coverage into one route, so
 * "Route 3" mixes full loops, short/flat variants and garbage-era values —
 * poisoning its aggregates and every "vs similar runs" comparison. This pass:
 *  - keeps a run on its route when A ≥ 90% (run on track) AND B ≥ 70% (track
 *    covered), stamping the detected lap_count;
 *  - otherwise re-matches it against all routes, auto-creating linked
 *    sub-route variants ("Route 3 · short") or standalone routes;
 *  - recomputes every route's aggregates and deletes routes left runless.
 *
 * Runs BEFORE the route-elevation re-base in _layout so canonical profiles are
 * built against final route memberships. Self-healing flag semantics match the
 * other migrations.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  detectLapCount,
  matchOrCreateRoute,
  parseRouteTrack,
  routeWithRunStats,
  twoWayCoverage,
} from '@/lib/route/matching';
import {
  deleteRoute,
  getAllRoutes,
  getAllRuns,
  getGpsPoints,
  getRoute,
  getRunsForRoute,
  insertRoute,
  updateRunRoute,
} from '@/lib/storage/db';

const FLAG = 'migration:route-variants-v1';

const SAME_ROUTE_MIN_RUN_COVERAGE = 0.9;
const SAME_ROUTE_MIN_TRACK_COVERAGE = 0.7;

/** Returns the number of runs whose assignment changed (0 when applied). */
export async function migrateRouteVariantsOnce(): Promise<number> {
  try {
    if ((await AsyncStorage.getItem(FLAG)) != null) return 0;
  } catch {
    // Unreadable flag → treat as not-done; the pass is idempotent.
  }

  let moved = 0;
  let clean = true;

  const routedRuns = getAllRuns()
    .filter((run) => run.route_id)
    .sort((a, b) => a.started_at - b.started_at);

  for (const run of routedRuns) {
    try {
      const points = getGpsPoints(run.id);
      if (points.length < 2) continue;

      const route = run.route_id ? getRoute(run.route_id) : null;
      if (route) {
        const track = parseRouteTrack(route);
        if (track.length >= 2) {
          const cov = twoWayCoverage(points, track);
          if (
            cov.a >= SAME_ROUTE_MIN_RUN_COVERAGE &&
            cov.b >= SAME_ROUTE_MIN_TRACK_COVERAGE
          ) {
            // Same route under the new rule — stamp the lap count and move on.
            updateRunRoute(run.id, route.id, detectLapCount(points, track));
            continue;
          }
        }
      }

      // Doesn't belong on its current route: re-match against everything
      // (may land on another route, an existing variant, or create one).
      const match = matchOrCreateRoute({
        runId: run.id,
        runStartedAt: run.started_at,
        distanceM: run.distance_m,
        ascentM: run.ascent_m ?? 0,
        points,
        existingRoutes: getAllRoutes(),
      });
      if (!match) continue;
      if (match.isNew) insertRoute(match.route);
      updateRunRoute(run.id, match.route.id, match.lapCount);
      moved += 1;
    } catch {
      clean = false; // retry this run on the next launch
    }
  }

  // Recompute aggregates over final memberships; drop routes left runless
  // (unless another route still points at them as its variant parent).
  try {
    const routes = getAllRoutes();
    const parentIds = new Set(
      routes.map((r) => r.parent_route_id).filter((id): id is string => !!id)
    );
    for (const route of routes) {
      const runs = getRunsForRoute(route.id);
      if (runs.length === 0) {
        if (!parentIds.has(route.id)) deleteRoute(route.id);
        continue;
      }
      insertRoute(routeWithRunStats(route, runs));
    }
  } catch {
    clean = false;
  }

  if (clean) {
    try {
      await AsyncStorage.setItem(FLAG, '1');
    } catch {
      // Best-effort flag; the pass is idempotent.
    }
  }
  return moved;
}
