// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * End-to-end GAP chain verification on REAL device data (Fix 1 + Fix 2):
 * Jun 8 donor (barometric, median vertical accuracy ~1.6 m) → canonical route
 * profile → applied to the Jul 6 run's positions → terrain/GAP recomputed.
 *
 * Reads local fixture files (a run export + a device sync dump) that are NOT
 * committed; every test skips gracefully when they are absent so CI never
 * breaks. Pure modules only — no db.ts / correct.ts imports.
 */
import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  altitudeTrustScore,
  elevationFitMedianM,
  mapProfileAltitudes,
  medianAltitudeAccuracy,
  projectAndResample,
} from '@/lib/elevation/routeCanonicalCore';
import { computeRunTerrainMetrics } from '@/lib/metrics/terrain';
import { mafWindowFromCeiling } from '@/lib/zones';
import type { GpsPointRecord, HRSample } from '@/types';

// Point these at your own files to run the chain on real data:
//   BASEMILE_RUN_EXPORT    a single-run JSON export (the target run)
//   BASEMILE_SYNC_JSON     a sync dump holding the donor run's GPS points
//   BASEMILE_DONOR_RUN_ID  id of the donor run inside that dump
const JUL6_EXPORT_PATHS = [process.env.BASEMILE_RUN_EXPORT ?? ''].filter(Boolean);

const SYNC_JSON_PATHS = [process.env.BASEMILE_SYNC_JSON ?? ''].filter(Boolean);

const JUN8_RUN_ID = process.env.BASEMILE_DONOR_RUN_ID ?? '';

function loadJson(paths: string[]): unknown | null {
  for (const path of paths) {
    try {
      if (!existsSync(path)) continue;
      const raw = readFileSync(path, 'utf8');
      // Device dumps can carry stray control characters — strip before parse.
      return JSON.parse(raw.replace(new RegExp('[\\u0000-\\u001f]', 'g'), ' '));
    } catch {
      continue;
    }
  }
  return null;
}

/** Jun 8 donor points from the sync dump (snake_case fields), or null. */
function loadJun8Donor(): GpsPointRecord[] | null {
  const parsed = loadJson(SYNC_JSON_PATHS) as {
    data?: {
      sqlite?: {
        gps_points?: {
          run_id: string;
          timestamp: number;
          latitude: number;
          longitude: number;
          altitude: number | null;
          altitude_accuracy: number | null;
          accuracy: number | null;
        }[];
      };
    };
  } | null;
  const rows = parsed?.data?.sqlite?.gps_points?.filter((p) => p.run_id === JUN8_RUN_ID);
  if (!rows || rows.length < 100) return null;
  return rows
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((p) => ({
      run_id: p.run_id,
      timestamp: p.timestamp,
      latitude: p.latitude,
      longitude: p.longitude,
      altitude: p.altitude,
      altitudeAccuracy: p.altitude_accuracy,
      groundElevation: null,
      speed: null,
      accuracy: p.accuracy,
    }));
}

/** Jul 6 run export (camelCase record fields), or null. */
function loadJul6(): {
  mafCeiling: number;
  points: GpsPointRecord[];
  hr: HRSample[];
} | null {
  const parsed = loadJson(JUL6_EXPORT_PATHS) as {
    run?: { maf_ceiling?: number | null };
    gps_points?: GpsPointRecord[];
    hr_samples?: { timestamp: number; bpm: number }[];
  } | null;
  if (!parsed?.gps_points || parsed.gps_points.length < 100) return null;
  return {
    mafCeiling: parsed.run?.maf_ceiling ?? 149,
    // Strip any stored correction: the chain under test must rebuild it.
    points: parsed.gps_points.map((p) => ({ ...p, groundElevation: null })),
    hr: (parsed.hr_samples ?? []).map((h) => ({ timestamp: h.timestamp, bpm: h.bpm })),
  };
}

describe('GAP chain on real data (skips when fixtures are absent)', () => {
  it('builds an amplitude-preserving profile from the Jun 8 donor', () => {
    const donor = loadJun8Donor();
    if (!donor) return; // fixture absent — skip silently

    // Jun 8 is the donor precisely because it is trusted AND the most accurate.
    expect(altitudeTrustScore(donor).trusted).toBe(true);
    const medAcc = medianAltitudeAccuracy(donor);
    expect(medAcc).not.toBeNull();
    expect(medAcc!).toBeLessThan(5);

    const profile = projectAndResample(donor);
    expect(profile.length).toBeGreaterThan(400); // ~6.4 km at 10 m spacing
    const alts = profile.map((p) => p.alt);
    const min = Math.min(...alts);
    const max = Math.max(...alts);
    // Full-loop band stays wide (no mean-reversion): ~54 m span, start ~656 m.
    expect(max - min).toBeGreaterThan(45);
    expect(max - min).toBeLessThan(70);
    expect(alts[0]!).toBeGreaterThan(645);
    expect(alts[0]!).toBeLessThan(665);
  });

  it('drops the Jul 6 GAP credit into the plausible band with a stored fit metric', () => {
    const donor = loadJun8Donor();
    const jul6 = loadJul6();
    if (!donor || !jul6) return; // fixtures absent — skip silently

    const profile = projectAndResample(donor);
    const mapped = mapProfileAltitudes(profile, jul6.points);
    const matched = mapped.filter((v) => v != null).length;
    // The run must land on the profile for the vast majority of its points.
    expect(matched / jul6.points.length).toBeGreaterThan(0.9);

    // Fit metric: median |profile − raw| over good fixes. The A55 carries a
    // datum offset vs the barometric donor, so this is expected to be > 8 m
    // (which is exactly why the elevation card surfaces a warning).
    const fit = elevationFitMedianM(mapped, jul6.points);
    expect(fit).not.toBeNull();
    expect(fit!).toBeGreaterThan(0);
    expect(fit!).toBeLessThan(20);

    const mafWindow = mafWindowFromCeiling(jul6.mafCeiling);
    const flat = jul6.points.map((p) => ({ ...p, altitude: 650, groundElevation: null }));
    const withProfile = jul6.points.map((p, i) => ({ ...p, groundElevation: mapped[i] ?? null }));

    // Terrain-space raw pace: same segments, flat elevation → multiplier 1.
    const rawPace = computeRunTerrainMetrics(flat, jul6.hr, [], mafWindow)
      .avg_gap_sec_per_km!;
    // BEFORE the fix: GAP from the raw A55 sawtooth altitude (the stored bug).
    const buggy = computeRunTerrainMetrics(jul6.points, jul6.hr, [], mafWindow);
    // AFTER: GAP from the canonical profile (what the chain now persists).
    const fixed = computeRunTerrainMetrics(withProfile, jul6.hr, [], mafWindow);

    const buggyCredit = rawPace - (buggy.avg_gap_sec_per_km ?? rawPace);
    const fixedCredit = rawPace - (fixed.avg_gap_sec_per_km ?? rawPace);

    // The sawtooth manufactured wildly asymmetric credit (~74 s/km on Jul 6).
    expect(buggyCredit).toBeGreaterThan(60);
    // The profile-based credit lands in the plausible band for this loop.
    expect(fixedCredit).toBeGreaterThanOrEqual(25);
    expect(fixedCredit).toBeLessThanOrEqual(45);
    // MAF-GAP stays in a sane aerobic band (~7:00–7:50 min/km).
    expect(fixed.maf_gap_pace_sec_per_km).not.toBeNull();
    expect(fixed.maf_gap_pace_sec_per_km!).toBeGreaterThan(400);
    expect(fixed.maf_gap_pace_sec_per_km!).toBeLessThan(470);
  });
});
