// SPDX-License-Identifier: GPL-3.0-or-later

import { tanakaMaxHr } from '@/lib/metrics/maxHr';
import { computeZonesFromKarvonen } from '@/lib/zones';
import type { UserProfile } from '@/types';

/**
 * Default profile seed for a new install. Users edit these values in
 * Settings (age, weight, max and resting HR, zones, eating window); the
 * profile Zustand store persists their changes. The numbers are generic
 * starting points, not recommendations: run the max HR and resting HR tests
 * in Settings to replace them with your own.
 */
const DEFAULT_AGE = 35;
// Tanaka estimate, so it matches the default "estimate" max HR source in
// Settings. Replace with a field test.
const DEFAULT_HR_MAX = tanakaMaxHr(DEFAULT_AGE);
const DEFAULT_HR_REST = 60;
const DEFAULT_MAF_CEILING = 180 - DEFAULT_AGE; // MAF 180 formula, no adjustment

export const USER_PROFILE: UserProfile = {
  name: 'Runner',
  age: DEFAULT_AGE,
  sex: 'male',
  weight_kg: 75,
  height_cm: 175,
  hrMax: DEFAULT_HR_MAX,
  hrRest: DEFAULT_HR_REST,
  mafCeiling: DEFAULT_MAF_CEILING,
  zones: computeZonesFromKarvonen(DEFAULT_HR_MAX, DEFAULT_HR_REST, DEFAULT_MAF_CEILING),
  eatingWindow: { start: '08:00', end: '20:00' },
  liftingDays: [],
  runningDays: ['tuesday', 'thursday', 'saturday', 'sunday'],
};
