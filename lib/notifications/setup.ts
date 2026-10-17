// SPDX-License-Identifier: GPL-3.0-or-later

import * as Notifications from 'expo-notifications';

import { useNotificationStore } from './store';

let handlerConfigured = false;

function configureForegroundHandler(): void {
  if (handlerConfigured) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  handlerConfigured = true;
}

export async function requestNotificationPermissions(): Promise<boolean> {
  configureForegroundHandler();

  let granted = false;
  try {
    const existing = await Notifications.getPermissionsAsync();
    granted = existing.granted;
    if (!granted) {
      const requested = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: false,
          allowSound: true,
        },
      });
      granted = requested.granted;
    }
  } catch {
    useNotificationStore.getState().setPermissionStatus('denied');
    return false;
  }

  useNotificationStore
    .getState()
    .setPermissionStatus(granted ? 'granted' : 'denied');

  return granted;
}

/**
 * The 12-week plan used to schedule a daily morning briefing and a Sunday
 * review. Those no longer exist, so any ids still persisted from an earlier
 * install are cancelled once and the list cleared.
 */
export async function cancelStaleScheduledNotifications(): Promise<void> {
  configureForegroundHandler();

  const store = useNotificationStore.getState();
  for (const id of store.scheduledIds) {
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {
      // ignore — id may have already fired or been cancelled
    }
  }
  store.clearScheduledIds();
}
