// SPDX-License-Identifier: GPL-3.0-or-later

import '../global.css';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useEffectiveHRSource } from '@/lib/ble';
import { vlogCaptureErrors } from '@/lib/coach/voiceLog';
import {
  cancelStaleScheduledNotifications,
  requestNotificationPermissions,
} from '@/lib/notifications/setup';
import { initDb, recomputeAllRunZoneDistributions } from '@/lib/storage/db';
import { migrateLegacyPlaceholderNotes } from '@/lib/storage/notes';
import { backfillRoutes } from '@/lib/route/backfill';
import { migrateRouteVariantsOnce } from '@/lib/route/migrateRouteVariants';
import { backfillRunMetrics } from '@/lib/run/backfillMetrics';
import {
  launchFingerprint,
  maintenanceIsCurrent,
  markMaintenanceDone,
} from '@/lib/run/launchMaintenance';
import { purgePreRunEventsOnce } from '@/lib/run/purgePreRunEvents';
import { recomputeDecouplingOnce } from '@/lib/run/recomputeDecoupling';
import { recomputeRouteElevationOnce } from '@/lib/run/recomputeRouteElevation';
import { recomputeGapMetricsOnce } from '@/lib/run/recomputeGap';
import { useProfileStore } from '@/lib/storage/profile';

// Release builds log nothing to logcat: keep JS errors in the black box.
vlogCaptureErrors();

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export default function RootLayout() {
  useEffectiveHRSource();

  useEffect(() => {
    initDb();
    void (async () => {
      // The full-history passes below only rerun when the history or the
      // zones changed since they last completed.
      const zonesJson = JSON.stringify(useProfileStore.getState().profile.zones);
      const fingerprint = launchFingerprint(zonesJson);
      const maintenanceCurrent = await maintenanceIsCurrent(fingerprint);
      // Backfill terrain/elevation for runs that predate those features so the
      // trend charts are continuous (Bug 3). Runs before route backfill so the
      // route elevation average picks up the freshly-computed values.
      if (!maintenanceCurrent) backfillRunMetrics();
      await yieldToUi();
      // Clear the old free-text notes placeholder that was saved verbatim on
      // runs where nothing was actually typed (Bug 5).
      migrateLegacyPlaceholderNotes();
      // Null out pre_run_state blobs that are actually serialized RN press
      // events (the onPress={savePreRunState} leak).
      await purgePreRunEventsOnce();
      // Recompute GAP / MAF-GAP after the steep-climb inflation fix so the
      // trend chart stops reading too fast on hilly runs.
      await recomputeGapMetricsOnce();
      // Split sub-route variants / laps out of pooled routes under the
      // two-way coverage rule. Must run BEFORE the elevation re-base so
      // canonical profiles are built against final route memberships.
      await migrateRouteVariantsOnce();
      // Re-base elevation onto route-canonical barometric profiles (road, not
      // DEM terrain); GAP recomputes are chained inside.
      await recomputeRouteElevationOnce();
      // Backfill aerobic decoupling once onto the current method so historical
      // values stop drifting across app versions (read from storage thereafter).
      await recomputeDecouplingOnce();
      // Re-route any runs whose route is missing.
      backfillRoutes();
      await yieldToUi();
      if (!maintenanceCurrent) {
        recomputeAllRunZoneDistributions(useProfileStore.getState().profile.zones);
        // Fingerprint taken after the passes (route backfill can add rows).
        await markMaintenanceDone(launchFingerprint(zonesJson));
      }
    })();

    void (async () => {
      try {
        await requestNotificationPermissions();
        await cancelStaleScheduledNotifications();
      } catch {
        // Notifications are best-effort; failures don't block the app.
      }
    })();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#000' }}>
      <SafeAreaProvider>
        <StatusBar style="light" translucent backgroundColor="transparent" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#000' },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="run/[id]"
            options={{
              headerShown: false,
              presentation: 'card',
            }}
          />
          <Stack.Screen
            name="routes/[id]"
            options={{
              headerShown: false,
              presentation: 'card',
            }}
          />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
