// SPDX-License-Identifier: GPL-3.0-or-later

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { STORAGE_KEYS } from '@/config/constants';
import type { BleConnectionState, BleDevice, BleError, HRSample } from '@/types';

interface BleStoreState {
  connectionState: BleConnectionState;
  device: BleDevice | null;
  lastSample: HRSample | null;
  lastError: BleError | null;
  batteryPct: number | null;
}

interface BleStoreActions {
  setState: (state: BleConnectionState) => void;
  setDevice: (device: BleDevice | null) => void;
  pushSample: (sample: HRSample | null) => void;
  setError: (error: BleError | null) => void;
  setBattery: (pct: number | null) => void;
  reset: () => void;
}

export type BleStore = BleStoreState & BleStoreActions;

const INITIAL_STATE: BleStoreState = {
  connectionState: 'idle',
  device: null,
  lastSample: null,
  lastError: null,
  batteryPct: null,
};

interface PersistedShape {
  device: { id: string; name: string | null; isPaired: boolean } | null;
}

export const useBleStore = create<BleStore>()(
  persist(
    (set) => ({
      ...INITIAL_STATE,
      setState: (connectionState) => set({ connectionState }),
      setDevice: (device) => set({ device }),
      pushSample: (lastSample) => set({ lastSample }),
      setError: (lastError) => set({ lastError }),
      setBattery: (batteryPct) => set({ batteryPct }),
      reset: () => set(INITIAL_STATE),
    }),
    {
      name: STORAGE_KEYS.BLE,
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist the paired device id/name, never live samples or transient state.
      partialize: (state): PersistedShape => ({
        device: state.device
          ? { id: state.device.id, name: state.device.name, isPaired: state.device.isPaired }
          : null,
      }),
      merge: (persisted, current) => {
        const p = persisted as PersistedShape | undefined;
        if (!p?.device) return current;
        return {
          ...current,
          device: { id: p.device.id, name: p.device.name, isPaired: p.device.isPaired },
        };
      },
    },
  ),
);

// Selectors / hooks ---------------------------------------------------------

export function useBleState(): BleConnectionState {
  return useBleStore((s) => s.connectionState);
}

export function useDevice(): BleDevice | null {
  return useBleStore((s) => s.device);
}

export function useHeartRate(): { bpm: number | null; sample: HRSample | null } {
  // lastSample is throttled to 1Hz upstream by the manager / mock source, so a
  // direct subscription here is safe for UI repaint cadence.
  const sample = useBleStore((s) => s.lastSample);
  return { bpm: sample?.bpm ?? null, sample };
}

export function useBleBattery(): number | null {
  return useBleStore((s) => s.batteryPct);
}

export function useBleError(): BleError | null {
  return useBleStore((s) => s.lastError);
}
