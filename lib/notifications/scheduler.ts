// SPDX-License-Identifier: GPL-3.0-or-later

import * as Notifications from 'expo-notifications';

import type { CompletedRun } from '@/types';

import { postRunSummaryText } from './copy';
import { useNotificationStore } from './store';

export async function firePostRunSummary(run: CompletedRun): Promise<void> {
  if (useNotificationStore.getState().permissionStatus !== 'granted') return;
  const { title, body } = postRunSummaryText(run);
  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: null,
  });
}
