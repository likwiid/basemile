// SPDX-License-Identifier: GPL-3.0-or-later

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { STORAGE_KEYS } from '@/config/constants';
import { USER_PROFILE } from '@/config/user';
import {
  computeMafCeiling,
  computeZonesFromKarvonen,
  mafAdjustmentForCeiling,
} from '@/lib/zones';
import type { UserProfile } from '@/types';

interface ProfileState {
  profile: UserProfile;
  /** Health adjustment used by computeMafCeiling. Stored alongside profile to recompute on age change. */
  mafAdjustment: number;
  update: (partial: Partial<UserProfile>) => void;
  setMafAdjustment: (adjustment: number) => void;
  reset: () => void;
}

// No health adjustment: the default ceiling is the plain 180 - age.
const INITIAL_MAF_ADJUSTMENT = 0;

function applyDerivations(
  next: UserProfile,
  prev: UserProfile,
  adjustment: number,
  manualZones: boolean
): UserProfile {
  let derived = next;
  if (next.age !== prev.age) {
    derived = { ...derived, mafCeiling: computeMafCeiling(next.age, adjustment) };
  }
  if (
    !manualZones &&
    (derived.hrMax !== prev.hrMax ||
      derived.hrRest !== prev.hrRest ||
      derived.mafCeiling !== prev.mafCeiling)
  ) {
    derived = {
      ...derived,
      zones: computeZonesFromKarvonen(
        derived.hrMax,
        derived.hrRest,
        derived.mafCeiling
      ),
    };
  }
  return derived;
}

/**
 * Persist migration. Fills any field missing from an older stored profile with
 * the defaults, keeps every value the user set, and derives mafAdjustment from
 * (age, ceiling) so the additive formula reproduces the stored ceiling exactly
 * and it cannot silently drift on a future recompute.
 */
export function migrateProfileState(persisted: unknown): Partial<ProfileState> {
  const state = persisted as Partial<ProfileState> | undefined;
  const profile: UserProfile = {
    ...USER_PROFILE,
    ...(state?.profile ?? {}),
  };
  const mafAdjustment = mafAdjustmentForCeiling(profile.age, profile.mafCeiling);
  return { ...state, profile, mafAdjustment };
}

export const useProfileStore = create<ProfileState>()(
  persist(
    (set, get) => ({
      profile: USER_PROFILE,
      mafAdjustment: INITIAL_MAF_ADJUSTMENT,
      update: (partial) => {
        const { profile, mafAdjustment } = get();
        const merged: UserProfile = { ...profile, ...partial };
        const derived = applyDerivations(
          merged,
          profile,
          mafAdjustment,
          partial.zones !== undefined
        );
        set({ profile: derived });
      },
      setMafAdjustment: (adjustment) => {
        const { profile } = get();
        const mafCeiling = computeMafCeiling(profile.age, adjustment);
        set({
          mafAdjustment: adjustment,
          profile: {
            ...profile,
            mafCeiling,
            zones: computeZonesFromKarvonen(profile.hrMax, profile.hrRest, mafCeiling),
          },
        });
      },
      reset: () =>
        set({ profile: USER_PROFILE, mafAdjustment: INITIAL_MAF_ADJUSTMENT }),
    }),
    {
      name: STORAGE_KEYS.PROFILE,
      storage: createJSONStorage(() => AsyncStorage),
      // v5: keep the stored values and reconcile mafAdjustment with them.
      version: 5,
      migrate: (persisted) => migrateProfileState(persisted) as unknown as ProfileState,
    }
  )
);
