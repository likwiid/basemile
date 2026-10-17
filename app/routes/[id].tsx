// SPDX-License-Identifier: GPL-3.0-or-later

import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { MafDriftChart } from '@/components/history/MafDriftChart';
import { RouteMiniMap } from '@/components/history/RouteMiniMap';
import { RunRow } from '@/components/history/RunRow';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { totalZoneSec, zoneSeconds } from '@/lib/metrics/zones';
import { parseRouteTrack } from '@/lib/route/matching';
import {
  getRoute,
  getRunsForRoute,
  renameRoute,
} from '@/lib/storage/db';
import { formatDistance, formatPace, todayISO } from '@/lib/time';
import type { CompletedRun, GpsPoint, RouteSummary } from '@/types';

export default function RouteDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const routeId = Array.isArray(id) ? id[0] : id;
  const router = useRouter();
  const [route, setRoute] = useState<RouteSummary | null>(null);
  const [runs, setRuns] = useState<CompletedRun[]>([]);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');

  const reload = useCallback(() => {
    if (!routeId) return;
    const nextRoute = getRoute(routeId);
    setRoute(nextRoute);
    setRuns(nextRoute ? getRunsForRoute(routeId) : []);
    setDraftName(nextRoute?.name ?? '');
  }, [routeId]);

  useFocusEffect(reload);

  const track = useMemo(
    () => (route ? parseRouteTrack(route).map(toGpsPoint) : []),
    [route]
  );
  const trend = useMemo(
    () =>
      [...runs]
        .filter((run) => (run.maf_gap_pace_sec_per_km ?? run.maf_pace_sec_per_km) !== null)
        .sort((a, b) => a.started_at - b.started_at)
        .map((run, index) => ({
          weekStart: todayISO(new Date(run.started_at)),
          weekNumber: index + 1,
          pace_sec_per_km: run.maf_gap_pace_sec_per_km ?? run.maf_pace_sec_per_km ?? 0,
          sample_count: 1,
        })),
    [runs]
  );
  const prs = useMemo(() => routePrs(runs), [runs]);
  const miniMapTracks = useMemo(() => [track], [track]);
  const miniMapRoutes = useMemo(() => (route ? [route] : []), [route]);
  const openRun = useCallback(
    (runId: string) => router.push({ pathname: '/run/[id]', params: { id: runId } }),
    [router]
  );

  if (!route) {
    return (
      <Screen noBottomInset={false}>
        <View className="flex-1 items-center justify-center">
          <Text className="text-text-secondary">Route not found</Text>
          <View className="h-4" />
          <Button title="Back" onPress={() => router.back()} variant="secondary" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll noBottomInset={false}>
      <View className="flex-row items-center justify-between mb-3">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          className="h-12 w-12 -ml-3 items-center justify-center"
        >
          <Text className="text-text-primary text-2xl">‹</Text>
        </Pressable>
        <Text className="text-text-muted text-xs">{route.run_count} run{route.run_count === 1 ? '' : 's'}</Text>
      </View>

      <Card className="p-3 mb-4">
        {editing ? (
          <View className="gap-3">
            <TextInput
              value={draftName}
              onChangeText={setDraftName}
              autoFocus
              className="rounded-lg border border-bg-border bg-bg-elevated px-3 py-3 text-text-primary"
              placeholderTextColor="#525252"
            />
            <View className="flex-row gap-2">
              <View className="flex-1">
                <Button
                  title="Save"
                  size="md"
                  onPress={() => {
                    const name = draftName.trim();
                    if (name.length > 0) renameRoute(route.id, name);
                    setEditing(false);
                    reload();
                  }}
                />
              </View>
              <View className="flex-1">
                <Button
                  title="Cancel"
                  variant="secondary"
                  size="md"
                  onPress={() => setEditing(false)}
                />
              </View>
            </View>
          </View>
        ) : (
          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-1">
              <Text className="text-text-primary text-2xl font-bold">{route.name}</Text>
              <Text className="text-text-secondary text-sm mt-1">
                {formatDistance(route.total_distance_m)}
                {route.avg_elevation_gain_m != null
                  ? ` · +${Math.round(route.avg_elevation_gain_m)}m avg`
                  : ' · no elevation data'}
              </Text>
            </View>
            <Button title="Rename" variant="secondary" size="md" onPress={() => setEditing(true)} />
          </View>
        )}
      </Card>

      <View className="mb-5">
        <RouteMiniMap tracks={miniMapTracks} routes={miniMapRoutes} />
      </View>

      <Card className="p-3 mb-5">
        <Text className="text-text-muted text-xs uppercase tracking-wider mb-3">
          Route PRs
        </Text>
        <View className="flex-row flex-wrap" style={{ rowGap: 12 }}>
          <Pr label="Best GAP" value={prs.bestGap} />
          <Pr label="Best Z2" value={prs.bestZ2} />
          <Pr label="Longest" value={prs.longest} />
          <Pr label="Fast finish" value={prs.fastFinish} />
        </View>
      </Card>

      <View className="mb-5">
        <Text className="text-text-muted text-xs uppercase tracking-wider mb-2">
          Route MAF-GAP Trend
        </Text>
        <MafDriftChart data={trend} xLabelPrefix="R" />
      </View>

      <View className="gap-2">
        <Text className="text-text-muted text-xs uppercase tracking-wider mb-1">
          Runs
        </Text>
        {runs.map((run) => (
          <RunRow key={run.id} run={run} onPress={openRun} />
        ))}
      </View>
    </Screen>
  );
}

function Pr({ label, value }: { label: string; value: string }) {
  return (
    <View className="w-1/2">
      <Text className="text-text-muted text-[10px] uppercase tracking-wider">{label}</Text>
      <Text className="text-text-primary text-base font-semibold mt-0.5">{value}</Text>
    </View>
  );
}

function routePrs(runs: readonly CompletedRun[]) {
  const bestGap = minBy(
    runs.filter((run) => run.avg_gap_sec_per_km !== null && run.avg_gap_sec_per_km !== undefined),
    (run) => run.avg_gap_sec_per_km ?? Number.POSITIVE_INFINITY
  );
  const bestZ2 = maxBy(runs, z2Pct);
  const longest = maxBy(runs, (run) => run.distance_m);
  const fastFinish = minBy(
    runs.filter((run) => run.splits.length > 0),
    (run) => run.splits[run.splits.length - 1]?.duration_sec ?? Number.POSITIVE_INFINITY
  );
  return {
    bestGap: bestGap?.avg_gap_sec_per_km ? formatPace(bestGap.avg_gap_sec_per_km) : '--:--',
    bestZ2: bestZ2 ? `${Math.round(z2Pct(bestZ2))}%` : '--',
    longest: longest ? formatDistance(longest.distance_m) : '--',
    fastFinish: fastFinish?.splits.length
      ? formatPace(fastFinish.splits[fastFinish.splits.length - 1]?.duration_sec ?? 0)
      : '--:--',
  };
}

function z2Pct(run: CompletedRun): number {
  const total = totalZoneSec(run.zone_distribution);
  return total > 0 ? (zoneSeconds(run.zone_distribution, 2) / total) * 100 : 0;
}

function minBy<T>(values: readonly T[], score: (value: T) => number): T | null {
  let best: T | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const value of values) {
    const current = score(value);
    if (current < bestScore) {
      best = value;
      bestScore = current;
    }
  }
  return best;
}

function maxBy<T>(values: readonly T[], score: (value: T) => number): T | null {
  let best: T | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    const current = score(value);
    if (current > bestScore) {
      best = value;
      bestScore = current;
    }
  }
  return best;
}

function toGpsPoint(point: { latitude: number; longitude: number }): GpsPoint {
  return { timestamp: 0, latitude: point.latitude, longitude: point.longitude };
}
