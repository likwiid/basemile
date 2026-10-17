// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect } from 'react';

import { useSettingsStore } from '@/lib/storage/settings';
import type { MockHRConfig } from '@/types';

import { bleManager } from './manager';
import { mockHRSource } from './mock';

export { parseHRMeasurement, bytesFromBase64 } from './parser';
export { bleManager } from './manager';
export { MockHRSource, mockHRSource } from './mock';
export {
  useBleStore,
  useBleState,
  useDevice,
  useHeartRate,
  useBleBattery,
  useBleError,
} from './store';

const DEFAULT_MOCK_CONFIG: MockHRConfig = {
  pattern: 'steady_z2',
  baselineBpm: 128,
  intervalMs: 1000,
};

/**
 * Wires the right HR source based on the user's mock toggle. Call exactly
 * once near the root of the app (e.g. in `app/_layout.tsx`).
 *
 * - mock ON: real BLE manager suspends, mock generator drives the store.
 * - mock OFF: mock detaches, real BLE attempts auto-reconnect.
 *
 * Rapid toggling is sequenced via the `cancelled` flag below: if the
 * effect re-fires before the prior async chain settles, the stale chain
 * exits before mutating any shared state.
 */
export function useEffectiveHRSource(): void {
  const useMockHR = useSettingsStore((s) => s.useMockHR);

  useEffect(() => {
    let cancelled = false;

    if (useMockHR) {
      // Tear down real BLE first, then start the mock. Without this
      // sequencing a fast toggle can race the mock store mutation against
      // a still-in-flight cancelDeviceConnection.
      void (async () => {
        await bleManager.suspendForMock();
        if (cancelled) return;
        mockHRSource.start(DEFAULT_MOCK_CONFIG, () => undefined);
      })();
      return () => {
        cancelled = true;
        mockHRSource.stop();
      };
    }

    mockHRSource.detach();
    bleManager.releaseFromMock();
    void (async () => {
      if (cancelled) return;
      await bleManager.tryAutoReconnect();
    })();
    return () => {
      cancelled = true;
    };
  }, [useMockHR]);
}
