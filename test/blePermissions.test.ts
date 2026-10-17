// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { blePermissionPlan, blePermissionsGranted } from '@/lib/ble/permissions';

const SCAN = 'android.permission.BLUETOOTH_SCAN';
const CONNECT = 'android.permission.BLUETOOTH_CONNECT';
const FINE = 'android.permission.ACCESS_FINE_LOCATION';

describe('blePermissionPlan', () => {
  it('asks for Nearby devices on Android 12 and later', () => {
    const plan = blePermissionPlan(31);
    expect(plan.required).toEqual([SCAN, CONNECT]);
    expect(plan.request).toEqual(expect.arrayContaining([SCAN, CONNECT]));
    expect(blePermissionPlan(36).required).toEqual([SCAN, CONNECT]);
  });

  it('asks for fine location before Android 12', () => {
    expect(blePermissionPlan(30)).toEqual({ request: [FINE], required: [FINE] });
  });
});

describe('blePermissionsGranted', () => {
  const plan = blePermissionPlan(34);

  it('passes when both Bluetooth permissions are granted, even without location', () => {
    expect(
      blePermissionsGranted(plan, { [SCAN]: 'granted', [CONNECT]: 'granted', [FINE]: 'denied' }),
    ).toBe(true);
  });

  it('fails when either Bluetooth permission is denied or missing', () => {
    expect(blePermissionsGranted(plan, { [SCAN]: 'granted', [CONNECT]: 'denied' })).toBe(false);
    expect(blePermissionsGranted(plan, { [SCAN]: 'never_ask_again', [CONNECT]: 'granted' })).toBe(
      false,
    );
    expect(blePermissionsGranted(plan, {})).toBe(false);
  });
});
