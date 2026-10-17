// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import { USER_PROFILE } from '@/config/user';
import { tanakaMaxHr } from '@/lib/metrics/maxHr';
import { migrateProfileState } from '@/lib/storage/profile';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

describe('profile migration: MAF ceiling/adjustment reconciliation', () => {
  it('reconciles a contradictory stored adjustment to match the stored ceiling', () => {
    const migrated = migrateProfileState({
      profile: { age: 26, hrMax: 190, hrRest: 49, mafCeiling: 149 },
      mafAdjustment: 5, // stale, contradicts the 149 ceiling
    });
    expect(migrated.profile?.mafCeiling).toBe(149);
    expect(migrated.mafAdjustment).toBe(-5);
  });

  it('keeps the user values instead of overwriting them with defaults', () => {
    const migrated = migrateProfileState({
      profile: { age: 41, hrMax: 178, hrRest: 55, mafCeiling: 139 },
      mafAdjustment: 0,
    });
    expect(migrated.profile).toMatchObject({ age: 41, hrMax: 178, hrRest: 55, mafCeiling: 139 });
    expect(migrated.mafAdjustment).toBe(0);
  });

  it('fills a missing profile with the neutral defaults', () => {
    const migrated = migrateProfileState({ mafAdjustment: 5 });
    expect(migrated.profile).toMatchObject({ name: 'Runner', age: 35, hrMax: 184, hrRest: 60 });
    expect(migrated.profile?.mafCeiling).toBe(145);
    expect(migrated.mafAdjustment).toBe(0);
  });

  it('seeds max HR with the Tanaka estimate that the default max HR source shows', () => {
    expect(USER_PROFILE.hrMax).toBe(tanakaMaxHr(USER_PROFILE.age));
  });
});
