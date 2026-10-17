// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * One-time route backfill.
 *
 * Routes are normally created only when a run is saved through the run-finish
 * flow (which calls `matchOrCreateRoute`). Runs that predate the route feature
 * — or were inserted another way — therefore have no `route_id` and never show
 * up on the Routes tab. `backfillRoutes` walks every unrouted run in
 * chronological order and matches it into a route (creating routes as needed),
 * exactly like the run-save flow. Idempotent: once a run has a `route_id` it is
 * skipped, so this is safe to call on every app start.
 */
import { matchOrCreateRoute, routeWithRunStats } from '@/lib/route/matching';
import {
  getAllRoutes,
  getAllRuns,
  getGpsPoints,
  getRunsForRoute,
  insertRoute,
  updateRunRoute,
} from '@/lib/storage/db';

/** Returns the number of runs newly matched into a route. */
export function backfillRoutes(): number {
  // Re-route runs that are unrouted OR whose route_id points to a route that
  // no longer exists, regenerating routes from the run GPS. Self-healing.
  const existingRouteIds = new Set(getAllRoutes().map((route) => route.id));
  const needsRoute = getAllRuns()
    .filter((run) => !run.route_id || !existingRouteIds.has(run.route_id))
    .sort((a, b) => a.started_at - b.started_at);

  let updated = 0;
  for (const run of needsRoute) {
    try {
      const points = getGpsPoints(run.id);
      if (points.length < 2) continue;

      const match = matchOrCreateRoute({
        runId: run.id,
        runStartedAt: run.started_at,
        distanceM: run.distance_m,
        ascentM: run.ascent_m ?? 0,
        points,
        existingRoutes: getAllRoutes(),
      });
      if (!match) continue;

      updateRunRoute(run.id, match.route.id, match.lapCount);
      const routeRuns = [
        { ...run, route_id: match.route.id, lap_count: match.lapCount },
        ...getRunsForRoute(match.route.id).filter((r) => r.id !== run.id),
      ];
      insertRoute(routeWithRunStats(match.route, routeRuns));
      updated++;
    } catch {
      // A single run's matching failure must not abort the whole backfill.
    }
  }
  return updated;
}

/**
 * Recompute every route's aggregate stats from its currently-assigned runs.
 * Called after passes that rewrite run ascent (elevation re-base) or move
 * runs between routes (variant split), so per-route averages never go stale.
 */
export function refreshRouteAggregates(): number {
  let refreshed = 0;
  for (const route of getAllRoutes()) {
    try {
      const runs = getRunsForRoute(route.id);
      if (runs.length === 0) continue;
      insertRoute(routeWithRunStats(route, runs));
      refreshed++;
    } catch {
      // One bad route must not abort the refresh.
    }
  }
  return refreshed;
}
