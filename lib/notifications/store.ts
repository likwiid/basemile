// SPDX-License-Identifier: GPL-3.0-or-later

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type NotificationPermissionStatus = 'unknown' | 'granted' | 'denied';

interface NotificationState {
  permissionStatus: NotificationPermissionStatus;
  scheduledIds: string[];
  setPermissionStatus: (status: NotificationPermissionStatus) => void;
  pushScheduledIds: (ids: string[]) => void;
  clearScheduledIds: () => void;
  removeScheduledIds: (ids: string[]) => void;
  replaceScheduledIds: (prev: readonly string[], next: readonly string[]) => void;
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, get) => ({
      permissionStatus: 'unknown',
      scheduledIds: [],
      setPermissionStatus: (permissionStatus) => set({ permissionStatus }),
      pushScheduledIds: (ids) => {
        if (ids.length === 0) return;
        set({ scheduledIds: [...get().scheduledIds, ...ids] });
      },
      clearScheduledIds: () => set({ scheduledIds: [] }),
      removeScheduledIds: (ids) => {
        const drop = new Set(ids);
        set({ scheduledIds: get().scheduledIds.filter((id) => !drop.has(id)) });
      },
      replaceScheduledIds: (prev, next) => {
        const drop = new Set(prev);
        const kept = get().scheduledIds.filter((id) => !drop.has(id));
        set({ scheduledIds: [...kept, ...next] });
      },
    }),
    {
      name: 'basemile:notifications:v1',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
    }
  )
);
