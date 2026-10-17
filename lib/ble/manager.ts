// SPDX-License-Identifier: GPL-3.0-or-later

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, PermissionsAndroid, Platform, type AppStateStatus } from 'react-native';
import type {
  BleManager as BleManagerType,
  Characteristic,
  Device,
  State as BleNativeState,
  Subscription,
} from 'react-native-ble-plx';

import {
  BLE_RECONNECT_INTERVAL_MS,
  BLE_RECONNECT_TIMEOUT_MS,
  BLE_UUIDS,
} from '@/config/constants';
import type { BleDevice } from '@/types';

import { bytesFromBase64, parseHRMeasurement } from './parser';
import {
  BLE_PERMISSION_DENIED_MESSAGE,
  blePermissionPlan,
  blePermissionsGranted,
} from './permissions';
import { useBleStore } from './store';

const PERSISTED_DEVICE_ID_KEY = 'basemile:ble:device-id';
const SAMPLE_THROTTLE_MS = 1000;

let cachedManager: BleManagerType | null = null;
let managerUnsupported = false;

function getManager(): BleManagerType | null {
  if (managerUnsupported) return null;
  if (cachedManager) return cachedManager;
  try {
    // Lazy require so importing this module in Expo Go doesn't crash at load time.
    const mod = require('react-native-ble-plx') as typeof import('react-native-ble-plx');
    cachedManager = new mod.BleManager();
    return cachedManager;
  } catch {
    managerUnsupported = true;
    return null;
  }
}

function toBleDevice(d: Device, isPaired = false): BleDevice {
  return {
    id: d.id,
    name: d.name ?? d.localName ?? null,
    rssi: d.rssi ?? null,
    isPaired,
  };
}

class BleManagerSingleton {
  private hrSubscription: Subscription | null = null;
  private disconnectSubscription: Subscription | null = null;
  private stateSubscription: Subscription | null = null;
  private appStateSubscription: { remove: () => void } | null = null;
  private connectedDeviceId: string | null = null;
  private lastSampleAt = 0;
  private reconnectTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectStartedAt = 0;
  private reconnectInFlight = false;
  private bluetoothState: BleNativeState | null = null;
  private isPairing = false;
  /** True once dispose() has been called. Guards late async callbacks. */
  private disposed = false;
  /** True once suspendForMock() is in effect — blocks reconnects until released. */
  private suspendedForMock = false;

  constructor() {
    this.initStateListener();
    this.initAppStateListener();
  }

  private initStateListener(): void {
    const mgr = getManager();
    if (!mgr) {
      useBleStore.getState().setState('unsupported');
      return;
    }
    this.stateSubscription?.remove();
    this.stateSubscription = mgr.onStateChange((state) => {
      this.bluetoothState = state;
      const store = useBleStore.getState();
      if (state === 'PoweredOff') {
        // Bluetooth turned off mid-run: stop pounding the radio with reconnects
        // and surface the off state. The reconnect loop will resume when the
        // radio comes back on (handled below).
        this.stopReconnectLoop();
        this.hrSubscription?.remove();
        this.hrSubscription = null;
        this.disconnectSubscription?.remove();
        this.disconnectSubscription = null;
        this.connectedDeviceId = null;
        store.setState('poweredOff');
      } else if (state === 'Unsupported') {
        store.setState('unsupported');
      } else if (state === 'Unauthorized') {
        store.setState('unauthorized');
      } else if (state === 'PoweredOn') {
        // Don't downgrade an active connection just because BT became powered on.
        if (store.connectionState === 'poweredOff') {
          // Radio came back online after being toggled off. If we have a
          // persisted device, automatically try to recover the stream.
          store.setState('idle');
          if (!this.suspendedForMock) {
            void this.tryAutoReconnect();
          }
        } else if (store.connectionState === 'idle') {
          store.setState('idle');
        }
      }
    }, true);
  }

  private initAppStateListener(): void {
    // We don't act on foreground/background transitions — BLE-PLX with
    // `isBackgroundEnabled: true` plus the location foreground service
    // (started by run.tsx via expo-location) keeps the connection alive on
    // Android. The pedometer likewise rides the same FGS. We register the
    // listener so future hooks (e.g. forced reconnect on resume) have a seam.
    this.appStateSubscription = AppState.addEventListener(
      'change',
      this.handleAppStateChange,
    );
  }

  private handleAppStateChange = (next: AppStateStatus): void => {
    if (this.disposed) return;
    if (next !== 'active') return;
    // On resume, if BLE believes it's connected but the underlying device is
    // gone (OS killed the connection while backgrounded without a FGS), the
    // disconnect listener will have fired before this. Nothing to do here
    // beyond a defensive nudge: if we're stuck in 'reconnecting' with no
    // active timer, restart the loop.
    const store = useBleStore.getState();
    if (
      store.connectionState === 'reconnecting' &&
      this.reconnectTimer === null &&
      !this.suspendedForMock
    ) {
      this.startReconnectLoop();
    }
  };

  async startScan(onDevice: (d: BleDevice) => void): Promise<void> {
    const mgr = getManager();
    if (!mgr) return;
    // 'Unauthorized' falls through so the permission prompt below can fix it.
    if (
      this.bluetoothState &&
      this.bluetoothState !== 'PoweredOn' &&
      this.bluetoothState !== 'Unauthorized'
    ) {
      return;
    }

    if (!(await ensureAndroidBlePermissions())) {
      this.emitError('permission_denied', BLE_PERMISSION_DENIED_MESSAGE);
      useBleStore.getState().setState('error');
      return;
    }

    useBleStore.getState().setState('scanning');
    const seen = new Set<string>();

    mgr.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
      if (error) {
        this.emitError('scan_failed', error.message);
        mgr.stopDeviceScan();
        useBleStore.getState().setState('error');
        return;
      }
      if (!device) return;

      const services = device.serviceUUIDs ?? [];
      const matchesService = services.some(
        (uuid) => uuid.toLowerCase() === BLE_UUIDS.HEART_RATE_SERVICE.toLowerCase(),
      );
      const name = device.name ?? device.localName ?? '';
      const matchesName = /HRM/i.test(name);

      if (!matchesService && !matchesName) return;
      if (seen.has(device.id)) return;
      seen.add(device.id);
      onDevice(toBleDevice(device));
    });
  }

  stopScan(): void {
    const mgr = getManager();
    if (!mgr) return;
    mgr.stopDeviceScan();
    const cs = useBleStore.getState().connectionState;
    if (cs === 'scanning') useBleStore.getState().setState('idle');
  }

  async pair(deviceId: string): Promise<void> {
    const mgr = getManager();
    if (!mgr) return;
    if (this.isPairing) return;
    this.isPairing = true;

    try {
      mgr.stopDeviceScan();
      // A user-initiated pair always wins — cancel any reconnect loop and
      // tear down stale subscriptions so we start clean.
      this.stopReconnectLoop();
      this.teardownDeviceSubscriptions();

      useBleStore.getState().setState('connecting');

      const connected = await mgr.connectToDevice(deviceId, { autoConnect: false });
      await connected.discoverAllServicesAndCharacteristics();

      this.connectedDeviceId = connected.id;
      await AsyncStorage.setItem(PERSISTED_DEVICE_ID_KEY, connected.id);

      const device = toBleDevice(connected, true);
      useBleStore.getState().setDevice(device);

      this.subscribeHR(connected);
      this.attachDisconnectListener(connected);

      useBleStore.getState().setState('connected');
      useBleStore.getState().setError(null);

      // Fire-and-forget battery read; some HR straps don't expose it.
      this.readBatteryInternal(connected).catch(() => {
        useBleStore.getState().setBattery(null);
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown pairing error';
      this.emitError('pair_failed', msg);
      useBleStore.getState().setState('error');
    } finally {
      this.isPairing = false;
    }
  }

  private subscribeHR(device: Device): void {
    // Defensive: never stack two monitors on the same device.
    this.hrSubscription?.remove();
    this.hrSubscription = device.monitorCharacteristicForService(
      BLE_UUIDS.HEART_RATE_SERVICE,
      BLE_UUIDS.HEART_RATE_MEASUREMENT,
      (error, characteristic) => {
        if (error) {
          // Disconnect path handles state; just record the error.
          this.emitError('hr_monitor', error.message);
          return;
        }
        if (!characteristic?.value) return;
        const sample = parseHRMeasurement(characteristic.value);
        if (!sample) return;

        // Throttle to 1Hz at the source so subscribers don't repaint faster than UI cadence.
        const now = sample.timestamp;
        if (now - this.lastSampleAt < SAMPLE_THROTTLE_MS) return;
        this.lastSampleAt = now;
        useBleStore.getState().pushSample(sample);
      },
    );
  }

  private attachDisconnectListener(device: Device): void {
    const mgr = getManager();
    if (!mgr) return;
    this.disconnectSubscription?.remove();
    this.disconnectSubscription = mgr.onDeviceDisconnected(device.id, (_err, _d) => {
      this.handleDisconnect();
    });
  }

  private teardownDeviceSubscriptions(): void {
    this.hrSubscription?.remove();
    this.hrSubscription = null;
    this.disconnectSubscription?.remove();
    this.disconnectSubscription = null;
  }

  private handleDisconnect(): void {
    this.teardownDeviceSubscriptions();
    this.connectedDeviceId = null;
    if (this.suspendedForMock || this.disposed) {
      // We deliberately disconnected; don't re-attempt.
      return;
    }
    useBleStore.getState().setState('reconnecting');
    this.startReconnectLoop();
  }

  private startReconnectLoop(): void {
    if (this.reconnectTimer) return;
    if (this.suspendedForMock || this.disposed) return;
    this.reconnectStartedAt = Date.now();
    this.reconnectTimer = setInterval(() => {
      void this.attemptReconnect();
    }, BLE_RECONNECT_INTERVAL_MS);
    // Kick off an immediate try too; setInterval waits a full tick first.
    void this.attemptReconnect();
  }

  private stopReconnectLoop(): void {
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectInFlight = false;
  }

  private async attemptReconnect(): Promise<void> {
    // Guard against overlapping ticks: if a connect is already in flight,
    // the next setInterval tick will skip and try again afterward.
    if (this.reconnectInFlight) return;
    if (this.suspendedForMock || this.disposed) {
      this.stopReconnectLoop();
      return;
    }

    const elapsed = Date.now() - this.reconnectStartedAt;
    if (elapsed > BLE_RECONNECT_TIMEOUT_MS) {
      this.stopReconnectLoop();
      this.emitError('reconnect_timeout', 'Could not reconnect to HR strap');
      // Only downgrade if we're still in reconnecting — don't stomp on a
      // user-initiated pair that landed during the last tick.
      const cs = useBleStore.getState().connectionState;
      if (cs === 'reconnecting') {
        useBleStore.getState().setState('disconnected');
      }
      return;
    }

    const persistedId = await AsyncStorage.getItem(PERSISTED_DEVICE_ID_KEY).catch(() => null);
    if (!persistedId) {
      this.stopReconnectLoop();
      useBleStore.getState().setState('disconnected');
      return;
    }

    const mgr = getManager();
    if (!mgr) return;
    if (this.bluetoothState && this.bluetoothState !== 'PoweredOn') return;

    this.reconnectInFlight = true;
    try {
      const connected = await mgr.connectToDevice(persistedId, { autoConnect: false });
      // State could have changed while connect was awaiting (mock toggled,
      // dispose, BT off). Bail out without subscribing to avoid leaks.
      if (this.suspendedForMock || this.disposed) {
        try {
          await mgr.cancelDeviceConnection(connected.id);
        } catch {
          // best-effort
        }
        return;
      }
      await connected.discoverAllServicesAndCharacteristics();
      this.connectedDeviceId = connected.id;

      // Re-subscribe is required: characteristic monitors don't survive a disconnect.
      this.subscribeHR(connected);
      this.attachDisconnectListener(connected);

      useBleStore.getState().setDevice(toBleDevice(connected, true));
      useBleStore.getState().setState('connected');
      useBleStore.getState().setError(null);
      // Refresh battery on reconnect — straps drop charge while we were away.
      this.readBatteryInternal(connected).catch(() => {
        useBleStore.getState().setBattery(null);
      });
      this.stopReconnectLoop();
    } catch {
      // swallow — next interval tick will retry
    } finally {
      this.reconnectInFlight = false;
    }
  }

  async tryAutoReconnect(): Promise<boolean> {
    const mgr = getManager();
    if (!mgr) return false;
    if (this.suspendedForMock || this.disposed) return false;

    const persistedId = await AsyncStorage.getItem(PERSISTED_DEVICE_ID_KEY).catch(() => null);
    if (!persistedId) return false;

    // Already connected to the persisted device with a live HR subscription:
    // nothing to do. If the subscription got torn down (e.g. by a mock
    // suspend that's since been released) we need to re-subscribe.
    if (this.connectedDeviceId === persistedId && this.hrSubscription !== null) {
      return true;
    }

    // Defer to the disconnect-driven reconnect loop if it's already running —
    // running two parallel reconnect drivers against the same id leads to
    // BLE-PLX "Device already connected" errors and fights for resources.
    if (this.reconnectTimer !== null || this.reconnectInFlight) return false;

    useBleStore.getState().setState('reconnecting');
    const start = Date.now();

    while (Date.now() - start < BLE_RECONNECT_TIMEOUT_MS) {
      if (this.suspendedForMock || this.disposed) {
        return false;
      }
      if (this.bluetoothState && this.bluetoothState !== 'PoweredOn') {
        await sleep(BLE_RECONNECT_INTERVAL_MS);
        continue;
      }
      this.reconnectInFlight = true;
      try {
        const connected = await mgr.connectToDevice(persistedId, { autoConnect: false });
        if (this.suspendedForMock || this.disposed) {
          try {
            await mgr.cancelDeviceConnection(connected.id);
          } catch {
            // best-effort
          }
          return false;
        }
        await connected.discoverAllServicesAndCharacteristics();
        this.connectedDeviceId = connected.id;
        this.subscribeHR(connected);
        this.attachDisconnectListener(connected);
        useBleStore.getState().setDevice(toBleDevice(connected, true));
        useBleStore.getState().setState('connected');
        useBleStore.getState().setError(null);
        this.readBatteryInternal(connected).catch(() => {
          useBleStore.getState().setBattery(null);
        });
        return true;
      } catch {
        await sleep(BLE_RECONNECT_INTERVAL_MS);
      } finally {
        this.reconnectInFlight = false;
      }
    }

    // Only downgrade if we still own the 'reconnecting' state.
    const cs = useBleStore.getState().connectionState;
    if (cs === 'reconnecting') {
      useBleStore.getState().setState('disconnected');
    }
    return false;
  }

  async unpair(): Promise<void> {
    const mgr = getManager();
    this.stopReconnectLoop();
    this.teardownDeviceSubscriptions();

    if (mgr && this.connectedDeviceId) {
      try {
        await mgr.cancelDeviceConnection(this.connectedDeviceId);
      } catch {
        // already gone
      }
    }

    this.connectedDeviceId = null;
    await AsyncStorage.removeItem(PERSISTED_DEVICE_ID_KEY).catch(() => undefined);
    useBleStore.getState().setDevice(null);
    useBleStore.getState().setBattery(null);
    useBleStore.getState().pushSample(null);
    useBleStore.getState().setState('idle');
  }

  async getBatteryLevel(): Promise<number | null> {
    const mgr = getManager();
    if (!mgr || !this.connectedDeviceId) return null;
    try {
      const device = await mgr.connectedDevices([BLE_UUIDS.BATTERY_SERVICE]);
      const target = device.find((d) => d.id === this.connectedDeviceId);
      if (!target) return null;
      return await this.readBatteryInternal(target);
    } catch {
      return null;
    }
  }

  private async readBatteryInternal(device: Device): Promise<number | null> {
    try {
      const ch: Characteristic = await device.readCharacteristicForService(
        BLE_UUIDS.BATTERY_SERVICE,
        BLE_UUIDS.BATTERY_LEVEL,
      );
      if (!ch.value) return null;
      const bytes = bytesFromBase64(ch.value);
      if (bytes.length === 0) return null;
      const pct = bytes[0] ?? null;
      useBleStore.getState().setBattery(pct);
      return pct;
    } catch {
      return null;
    }
  }

  /** Pause real BLE so the mock source can take over without contention. */
  async suspendForMock(): Promise<void> {
    this.suspendedForMock = true;
    this.stopReconnectLoop();
    this.teardownDeviceSubscriptions();
    const mgr = getManager();
    if (mgr && this.connectedDeviceId) {
      try {
        await mgr.cancelDeviceConnection(this.connectedDeviceId);
      } catch {
        // already gone
      }
    }
    this.connectedDeviceId = null;
  }

  /**
   * Release the mock-suspend latch. Call before tryAutoReconnect when the
   * mock is being turned off, so the reconnect path doesn't bail out.
   */
  releaseFromMock(): void {
    this.suspendedForMock = false;
  }

  dispose(): void {
    this.disposed = true;
    this.stopReconnectLoop();
    this.teardownDeviceSubscriptions();
    this.stateSubscription?.remove();
    this.stateSubscription = null;
    this.appStateSubscription?.remove();
    this.appStateSubscription = null;
    this.connectedDeviceId = null;
  }

  isConnected(): boolean {
    return this.connectedDeviceId !== null;
  }

  private emitError(code: string, message: string): void {
    useBleStore.getState().setError({ code, message, timestamp: Date.now() });
  }
}

/**
 * Ask for the Android runtime permissions a scan needs. Without this a fresh
 * install on Android 12+ never shows the Nearby devices prompt and every scan
 * fails as unauthorized.
 */
async function ensureAndroidBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : Number(Platform.Version);
  const plan = blePermissionPlan(apiLevel);
  try {
    const results = await PermissionsAndroid.requestMultiple(
      plan.request as Parameters<typeof PermissionsAndroid.requestMultiple>[0],
    );
    return blePermissionsGranted(plan, results);
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const bleManager = new BleManagerSingleton();
