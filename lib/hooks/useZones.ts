// SPDX-License-Identifier: GPL-3.0-or-later

import { useMemo } from 'react';

import { classifyHR, zoneBoundaryHint, zoneLabel } from '@/lib/zones';
import { useProfileStore } from '@/lib/storage/profile';
import type { ZoneConfig, ZoneNumber } from '@/types';

export interface ZonesView {
  zones: ZoneConfig;
  classify: (bpm: number | null) => ZoneNumber | null;
  labelFor: (zone: ZoneNumber | null) => string;
  boundaryHint: (bpm: number | null) => string | null;
}

export function useZones(): ZonesView {
  const zones = useProfileStore((s) => s.profile.zones);

  return useMemo(
    () => ({
      zones,
      classify: (bpm: number | null) =>
        bpm === null ? null : classifyHR(bpm, zones),
      labelFor: (zone: ZoneNumber | null) =>
        zone === null ? 'No HR signal' : zoneLabel(zone),
      boundaryHint: (bpm: number | null) =>
        zoneBoundaryHint(bpm, zones)?.label ?? null,
    }),
    [zones]
  );
}
