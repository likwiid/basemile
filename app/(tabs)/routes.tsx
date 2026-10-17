// SPDX-License-Identifier: GPL-3.0-or-later

import { useFocusEffect, useRouter } from 'expo-router';
import { memo, useCallback, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { RouteHeatMap } from '@/components/history/RouteHeatMap';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { createHeatTrackCache, type HeatTrack } from '@/lib/route/heatTracks';
import {
  getAllRoutes,
  getRoutesDataVersion,
  getRunIds,
  getThinTrackRows,
} from '@/lib/storage/db';
import { formatDistance } from '@/lib/time';
import type { RouteSummary } from '@/types';

// Module scope so built tracks survive the tab unmounting; only runs saved
// since the last build are read from SQLite.
const loadHeatTracks = createHeatTrackCache(getThinTrackRows);

export default function RoutesScreen() {
  const router = useRouter();
  const [routes, setRoutes] = useState<RouteSummary[]>([]);
  const [runTracks, setRunTracks] = useState<HeatTrack[]>([]);
  const dataVersion = useRef<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      // The token ignores writes this tab does not draw (run views stamping
      // decoupling or elevation, notes), and an unchanged run set returns the
      // same track array, so the heat map GeoJSON is not re-sent to native.
      const version = getRoutesDataVersion();
      if (version === dataVersion.current) return;
      dataVersion.current = version;
      setRoutes(getAllRoutes());
      setRunTracks(loadHeatTracks(getRunIds()));
    }, [])
  );

  const openRoute = useCallback((id: string) => router.push(`../routes/${id}`), [router]);

  return (
    <Screen scroll>
      <View className="mb-4">
        <Text className="text-text-primary text-3xl font-bold">Routes</Text>
        <Text className="text-text-secondary text-sm mt-1">
          Terrain-aware progress by repeated route
        </Text>
      </View>

      <View className="mb-5">
        <RouteHeatMap tracks={runTracks} height={280} />
      </View>

      <View className="gap-2">
        {routes.length === 0 ? (
          <Card>
            <Text className="text-text-secondary text-sm text-center py-6">
              Save a GPS run to create your first route.
            </Text>
          </Card>
        ) : (
          routes.map((route) => <RouteRow key={route.id} route={route} onPress={openRoute} />)
        )}
      </View>
    </Screen>
  );
}

const RouteRow = memo(function RouteRow({
  route,
  onPress,
}: {
  route: RouteSummary;
  onPress: (id: string) => void;
}) {
  return (
    <Pressable
      onPress={() => onPress(route.id)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${route.name}, ${route.run_count} run${route.run_count === 1 ? '' : 's'}`}
      className="rounded-2xl border border-bg-border bg-bg-card p-3"
    >
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-row items-center flex-1">
          <View
            className="h-3 w-3 rounded-full mr-2"
            style={{ backgroundColor: route.color }}
          />
          <View className="flex-1">
            <Text className="text-text-primary text-base font-semibold">
              {route.name}
            </Text>
            <Text className="text-text-secondary text-xs mt-0.5">
              {route.run_count} run{route.run_count === 1 ? '' : 's'} · {formatDistance(route.total_distance_m)}
            </Text>
          </View>
        </View>
        <Text className="text-text-muted text-xs">
          {route.avg_elevation_gain_m != null
            ? `+${Math.round(route.avg_elevation_gain_m)}m`
            : 'no elev'}
        </Text>
      </View>
    </Pressable>
  );
});
