// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Android runtime permissions the strap scan needs. Kept free of
 * react-native imports so the rules can be unit tested; the manager does the
 * actual PermissionsAndroid request.
 *
 * Android 12 (API 31) and later: "Nearby devices" (BLUETOOTH_SCAN and
 * BLUETOOTH_CONNECT). Location is asked for in the same prompt because the
 * scan permission is not declared neverForLocation, but only the Bluetooth
 * pair is required.
 * Android 11 and earlier: a BLE scan needs fine location.
 */

const SCAN = 'android.permission.BLUETOOTH_SCAN';
const CONNECT = 'android.permission.BLUETOOTH_CONNECT';
const FINE_LOCATION = 'android.permission.ACCESS_FINE_LOCATION';

export interface BlePermissionPlan {
  /** Everything to ask for in one prompt. */
  request: string[];
  /** The subset that must be granted before scanning. */
  required: string[];
}

export function blePermissionPlan(apiLevel: number): BlePermissionPlan {
  if (apiLevel >= 31) {
    return { request: [SCAN, CONNECT, FINE_LOCATION], required: [SCAN, CONNECT] };
  }
  return { request: [FINE_LOCATION], required: [FINE_LOCATION] };
}

export function blePermissionsGranted(
  plan: BlePermissionPlan,
  results: Record<string, string | undefined>,
): boolean {
  return plan.required.every((p) => results[p] === 'granted');
}

export const BLE_PERMISSION_DENIED_MESSAGE =
  'BaseMile needs Bluetooth permission to find your strap. Allow Nearby devices (or Location on older Android) for BaseMile in Android settings, then scan again.';
