// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  altitudeTrustScore,
  buildDonorIndex,
  elevationFitMedianM,
  mapDonorAltitudes,
  mapProfileAltitudes,
  medianAltitudeAccuracy,
  parseCanonicalProfile,
  projectAndResample,
} from '@/lib/elevation/routeCanonicalCore';
import type { GpsPointRecord } from '@/types';

// Synthetic tracks around a public city park (Parc de la Ligue Arabe, Casablanca).
function pt(over: Partial<GpsPointRecord>): GpsPointRecord {
  return {
    run_id: 'r',
    timestamp: 0,
    latitude: 33.585,
    longitude: -7.627,
    altitude: null,
    altitudeAccuracy: null,
    groundElevation: null,
    speed: null,
    accuracy: null,
    ...over,
  };
}

/** A gentle 30-point track climbing 0.5 m/fix — barometric-quality. */
function baroTrack(): GpsPointRecord[] {
  return Array.from({ length: 30 }, (_, i) =>
    pt({ timestamp: i * 1000, longitude: -7.627 + i * 0.0001, altitude: 300 + i * 0.5 })
  );
}

/** Same coords but GPS-noise altitude: ±40 m swings, 300 m span. */
function noisyTrack(): GpsPointRecord[] {
  return Array.from({ length: 30 }, (_, i) =>
    pt({
      timestamp: i * 1000,
      longitude: -7.627 + i * 0.0001,
      altitude: 500 + (i % 2 === 0 ? 150 : -150) + i * 5,
    })
  );
}

describe('altitudeTrustScore', () => {
  it('trusts a smooth barometric series', () => {
    const t = altitudeTrustScore(baroTrack());
    expect(t.trusted).toBe(true);
  });

  it('rejects a noisy GPS-altitude series (huge span, big steps)', () => {
    const t = altitudeTrustScore(noisyTrack());
    expect(t.trusted).toBe(false);
  });

  it('rejects sparse-altitude tracks', () => {
    const sparse = baroTrack().map((p, i) => (i % 3 === 0 ? p : { ...p, altitude: null }));
    expect(altitudeTrustScore(sparse).trusted).toBe(false);
  });
});

describe('mapDonorAltitudes', () => {
  it('samples the nearest donor point for co-located tracks', () => {
    const donor = buildDonorIndex(baroTrack());
    // Target follows the same line, offset ~5 m north.
    const target = baroTrack().map((p) => ({ ...p, latitude: p.latitude + 0.000045, altitude: null }));
    const mapped = mapDonorAltitudes(donor, target);
    expect(mapped.filter((v) => v != null).length).toBe(target.length);
    // Values come from the donor profile (300..314.5), monotone-ish.
    expect(mapped[0]).toBeCloseTo(300, 0);
    expect(mapped[mapped.length - 1]).toBeCloseTo(314.5, 0);
  });

  it('returns null beyond the match radius (off-route detour)', () => {
    const donor = buildDonorIndex(baroTrack());
    const far = [pt({ latitude: 33.595, longitude: -7.617, altitude: null })]; // ~1.4 km away
    expect(mapDonorAltitudes(donor, far)[0]).toBeNull();
  });
});

/** Straight east-west donor: 1 fix every ~9.2 m, altitude climbing 1 m/fix. */
function longDonor(n = 120): GpsPointRecord[] {
  return Array.from({ length: n }, (_, i) =>
    pt({
      timestamp: i * 1000,
      longitude: -7.627 + i * 0.0001, // ≈ 9.27 m/step at lat 33.585
      altitude: 600 + i * 1,
      altitudeAccuracy: 2,
      accuracy: 5,
    })
  );
}

describe('projectAndResample', () => {
  it('resamples at the requested spacing along the donor path', () => {
    const donor = longDonor();
    const profile = projectAndResample(donor, 10, 1); // no smoothing
    // ~1100 m of track → ~110 samples at 10 m spacing (+ start sample).
    expect(profile.length).toBeGreaterThan(100);
    expect(profile.length).toBeLessThan(120);
    // Interpolated altitude keeps the 1 m per 9.27 m gradient.
    const last = profile[profile.length - 1]!;
    expect(last.alt).toBeGreaterThan(710);
  });

  it('preserves amplitude: profile span matches the donor span (light low-pass)', () => {
    const donor = longDonor();
    const profile = projectAndResample(donor, 10, 5);
    const alts = profile.map((p) => p.alt);
    const span = Math.max(...alts) - Math.min(...alts);
    const donorSpan = 119; // 600..719
    // Only edge clamping may shave a couple of metres — never band compression.
    expect(span).toBeGreaterThan(donorSpan - 3);
    expect(span).toBeLessThanOrEqual(donorSpan);
  });

  it('low-passes a single-fix spike instead of keeping it', () => {
    const donor = longDonor().map((p, i) =>
      i === 60 ? { ...p, altitude: (p.altitude ?? 0) + 12 } : p
    );
    const spiky = projectAndResample(donor, 10, 1);
    const smoothed = projectAndResample(donor, 10, 5);
    const maxSpiky = Math.max(...spiky.map((p) => p.alt - 600 - 1));
    const maxSmoothed = Math.max(...smoothed.map((p) => p.alt - 600 - 1));
    expect(maxSmoothed).toBeLessThan(maxSpiky);
  });

  it('returns [] for degenerate donors', () => {
    expect(projectAndResample([], 10, 5)).toEqual([]);
    expect(projectAndResample([pt({ altitude: 600 })], 10, 5)).toEqual([]);
  });
});

describe('mapProfileAltitudes', () => {
  it('samples the nearest position within 25 m and nulls beyond it', () => {
    const profile = projectAndResample(longDonor(), 10, 1);
    // ~11 m north of the line → matches; ~44 m north → off-route.
    const near = pt({ latitude: 33.585 + 0.0001, longitude: -7.622, altitude: null });
    const far = pt({ latitude: 33.585 + 0.0004, longitude: -7.622, altitude: null });
    const [nearAlt, farAlt] = mapProfileAltitudes(profile, [near, far]);
    expect(nearAlt).not.toBeNull();
    expect(farAlt).toBeNull();
    // The matched altitude comes from the donor gradient near lon -7.622 (~i=50).
    expect(nearAlt!).toBeGreaterThan(640);
    expect(nearAlt!).toBeLessThan(660);
  });
});

describe('elevationFitMedianM', () => {
  it('computes the median |profile − raw| over good fixes only', () => {
    const targets = Array.from({ length: 40 }, (_, i) =>
      pt({
        timestamp: i * 1000,
        longitude: -7.627 + i * 0.0001,
        altitude: 600 + (i % 2 === 0 ? 3 : 5), // diffs of 3 and 5 → median 5 (upper mid)
        altitudeAccuracy: 4,
        accuracy: 4,
      })
    );
    const profileAlts = targets.map(() => 600);
    const fit = elevationFitMedianM(profileAlts, targets);
    expect(fit).not.toBeNull();
    expect(fit!).toBeGreaterThanOrEqual(3);
    expect(fit!).toBeLessThanOrEqual(5);
  });

  it('ignores poor fixes and returns null below the sample floor', () => {
    const targets = Array.from({ length: 40 }, (_, i) =>
      pt({
        timestamp: i * 1000,
        longitude: -7.627 + i * 0.0001,
        altitude: 700, // wildly off, but accuracy is bad → excluded
        altitudeAccuracy: 30,
        accuracy: 30,
      })
    );
    expect(elevationFitMedianM(targets.map(() => 600), targets)).toBeNull();
  });
});

describe('medianAltitudeAccuracy', () => {
  it('returns the median of reported accuracies and null when unreported', () => {
    const reported = [1, 2, 9].map((v, i) =>
      pt({ timestamp: i, altitudeAccuracy: v })
    );
    expect(medianAltitudeAccuracy(reported)).toBe(2);
    expect(medianAltitudeAccuracy([pt({}), pt({})])).toBeNull();
  });
});

describe('parseCanonicalProfile', () => {
  it('round-trips a serialized profile', () => {
    const profile = {
      positions: projectAndResample(longDonor(), 10, 5),
      spacing_m: 10,
      donor_run_id: 'run-donor',
      built_at: 123,
    };
    const parsed = parseCanonicalProfile(JSON.stringify(profile));
    expect(parsed?.positions.length).toBe(profile.positions.length);
    expect(parsed?.donor_run_id).toBe('run-donor');
  });

  it('rejects malformed payloads', () => {
    expect(parseCanonicalProfile(null)).toBeNull();
    expect(parseCanonicalProfile('')).toBeNull();
    expect(parseCanonicalProfile('{not json')).toBeNull();
    expect(parseCanonicalProfile('{"positions":[]}')).toBeNull();
    expect(parseCanonicalProfile('{"positions":[{"x":1}]}')).toBeNull();
  });
});
