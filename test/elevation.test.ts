// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  applyPerSplitElevation,
  computeElevationStats,
  elevationPerSplit,
  liveElevationStep,
  type LiveElevationState,
} from '@/lib/metrics/elevation';
import {
  buildElevationUrl,
  fillElevationGaps,
  parseElevationResponse,
} from '@/lib/elevation/dem';
import type { GpsPointRecord } from '@/types';

// IMPORTANT: do NOT import correct.ts or db.ts here — db.ts pulls in
// expo-sqlite, which will not load under the node vitest environment. Only the
// pure functions are exercised.

/** Build a GPS point record with sensible defaults; override per field. */
function point(over: Partial<GpsPointRecord>): GpsPointRecord {
  return {
    run_id: 'r1',
    timestamp: 0,
    latitude: 0,
    longitude: 0,
    altitude: null,
    altitudeAccuracy: null,
    groundElevation: null,
    speed: null,
    accuracy: 5,
    ...over,
  };
}

describe('computeElevationStats', () => {
  it('returns zeroed, empty-safe stats below MIN_POINTS', () => {
    const pts = [
      point({ timestamp: 0, altitude: 10 }),
      point({ timestamp: 1, altitude: 20 }),
    ];
    const stats = computeElevationStats(pts);
    expect(stats.total_gain_m).toBe(0);
    expect(stats.total_loss_m).toBe(0);
    expect(stats.coverage_pct).toBe(0);
    expect(stats.segments).toEqual([]);
    expect(stats.source).toBe('gps');
    expect(stats.corrected).toBe(false);
  });

  it('accumulates gain/loss on a climbing-then-descending raw GPS track', () => {
    // Longitudes step east so each consecutive pair has real distance.
    // Altitude climbs 0→40 then descends back to 0 in clean 10 m steps.
    const alts = [0, 10, 20, 30, 40, 30, 20, 10, 0];
    const pts = alts.map((a, i) =>
      point({ timestamp: i * 1000, longitude: i * 0.001, altitude: a, accuracy: 8 })
    );

    const stats = computeElevationStats(pts);

    // Smoothing (window 5, centered) flattens the peak: the 0→40→0 series
    // becomes 10→28→10, so gain and loss are each ~18 — substantial, equal,
    // and net ~0 (start and end both smoothed to ~10).
    expect(stats.total_gain_m).toBeGreaterThan(15);
    expect(stats.total_loss_m).toBeGreaterThan(15);
    expect(stats.total_gain_m).toBeCloseTo(stats.total_loss_m, 5);
    expect(Math.abs(stats.net_m)).toBeLessThan(1);
    expect(stats.coverage_pct).toBe(1);
    expect(stats.source).toBe('gps');
    expect(stats.corrected).toBe(false);
    // All points share 'good' quality (accuracy 8 ≤ GOOD_ACCURACY_M 15).
    expect(stats.segments).toHaveLength(1);
    expect(stats.segments[0]?.quality).toBe('good');
    expect(stats.segments[0]?.startIndex).toBe(0);
    expect(stats.segments[0]?.endIndex).toBe(8);
    expect(stats.segments[0]?.distance_m).toBeGreaterThan(0);
  });

  it('accumulates a steady shallow climb whose per-step delta is below the deadband', () => {
    // 0.6 m/step monotone climb (< MIN_STEP_DELTA_M 1.0). With a per-step
    // deadband this would sum to 0; with hysteresis it must reach ~net gain.
    const pts = Array.from({ length: 60 }, (_, i) =>
      point({ timestamp: i * 1000, longitude: i * 0.0003, altitude: 100 + i * 0.6, accuracy: 8 })
    );
    const stats = computeElevationStats(pts);
    // True net ≈ 59 * 0.6 ≈ 35.4 m (smoothing trims the ends slightly).
    expect(stats.total_gain_m).toBeGreaterThan(28);
    expect(stats.total_loss_m).toBe(0);
  });

  it('rejects a GPS altitude glitch instead of accumulating phantom gain', () => {
    // Flat at 100 m with a single large spike (GPS re-acquisition glitch). The
    // steps in/out of the spike exceed the 40 m max-step guard, so they
    // re-baseline rather than summing into gain/loss.
    const alts = [100, 100, 100, 100, 400, 100, 100, 100, 100, 100];
    const pts = alts.map((a, i) =>
      point({ timestamp: i * 1000, longitude: i * 0.001, altitude: a, accuracy: 8 })
    );

    const stats = computeElevationStats(pts);

    expect(stats.total_gain_m).toBeLessThan(5);
    expect(stats.total_loss_m).toBeLessThan(5);
  });

  it('per-split elevation also ignores glitch steps', () => {
    const alts = [100, 100, 100, 100, 400, 100, 100, 100, 100, 100];
    const pts = alts.map((a, i) =>
      point({ timestamp: i * 1000, longitude: i * 0.001, altitude: a, accuracy: 8 })
    );
    const perSplit = elevationPerSplit(pts);
    const totalGain = perSplit.reduce((s, p) => s + p.gain_m, 0);
    expect(totalGain).toBeLessThan(5);
  });

  it('rejects a mid-size spike that smoothing used to smear under the glitch guard', () => {
    // A single 150 m spike smeared by the 5-point mean into 30 m steps slipped
    // under the 40 m guard (+30/-30 phantom). Segmented smoothing preserves the
    // sharp step so the guard re-baselines it - 0 gain, 0 loss on flat ground.
    const alts = [100, 100, 100, 100, 100, 250, 100, 100, 100, 100, 100, 100];
    const pts = alts.map((a, i) =>
      point({ timestamp: i * 1000, longitude: i * 0.001, altitude: a, accuracy: 8 })
    );
    const stats = computeElevationStats(pts);
    expect(stats.total_gain_m).toBeLessThan(1);
    expect(stats.total_loss_m).toBeLessThan(1);
  });

  it('re-baselines a persistent re-acquisition offset instead of ramping into it', () => {
    // GPS re-acquires 60 m high and stays there: not climbing, just a datum
    // jump. The smeared ramp used to count all 60 m as gain.
    const alts = [100, 100, 100, 100, 100, 160, 160, 160, 160, 160, 160, 160];
    const pts = alts.map((a, i) =>
      point({ timestamp: i * 1000, longitude: i * 0.001, altitude: a, accuracy: 8 })
    );
    const stats = computeElevationStats(pts);
    expect(stats.total_gain_m).toBeLessThan(1);
    expect(stats.total_loss_m).toBeLessThan(1);
  });

  it('still counts genuine gradual climbs after the segmentation change', () => {
    // 2 m per fix for 25 fixes = 50 m real climb - far below the 40 m/step
    // guard, must be fully counted (smoothing edges cost < 3 m).
    const alts = Array.from({ length: 26 }, (_, i) => 100 + i * 2);
    const pts = alts.map((a, i) =>
      point({ timestamp: i * 1000, longitude: i * 0.001, altitude: a, accuracy: 8 })
    );
    const stats = computeElevationStats(pts);
    expect(stats.total_gain_m).toBeGreaterThan(44);
    expect(stats.total_loss_m).toBeLessThan(1);
  });

  it('classifies quality and merges contiguous segments, including missing + poor', () => {
    // good x3, then poor (accuracy 50) x2, then missing (no altitude) x2.
    const pts: GpsPointRecord[] = [
      point({ timestamp: 0, longitude: 0.0, altitude: 100, accuracy: 5 }),
      point({ timestamp: 1000, longitude: 0.001, altitude: 102, accuracy: 5 }),
      point({ timestamp: 2000, longitude: 0.002, altitude: 104, accuracy: 5 }),
      point({ timestamp: 3000, longitude: 0.003, altitude: 106, accuracy: 50 }),
      point({ timestamp: 4000, longitude: 0.004, altitude: 108, accuracy: 50 }),
      point({ timestamp: 5000, longitude: 0.005, altitude: null, accuracy: 50 }),
      point({ timestamp: 6000, longitude: 0.006, altitude: null, accuracy: 50 }),
    ];

    const stats = computeElevationStats(pts);

    expect(stats.segments).toHaveLength(3);
    expect(stats.segments[0]?.quality).toBe('good');
    expect(stats.segments[0]?.startIndex).toBe(0);
    expect(stats.segments[0]?.endIndex).toBe(2);
    expect(stats.segments[1]?.quality).toBe('poor');
    expect(stats.segments[1]?.startIndex).toBe(3);
    expect(stats.segments[1]?.endIndex).toBe(4);
    expect(stats.segments[2]?.quality).toBe('missing');
    expect(stats.segments[2]?.startIndex).toBe(5);
    expect(stats.segments[2]?.endIndex).toBe(6);

    // 5 of 7 points have usable elevation.
    expect(stats.coverage_pct).toBeCloseTo(5 / 7, 3);
  });

  it("uses altitudeAccuracy over horizontal accuracy when classifying", () => {
    // Horizontal accuracy is great (5) but vertical is terrible (60) → 'poor'.
    const pts = Array.from({ length: 6 }, (_, i) =>
      point({
        timestamp: i * 1000,
        longitude: i * 0.001,
        altitude: 50 + i,
        accuracy: 5,
        altitudeAccuracy: 60,
      })
    );
    const stats = computeElevationStats(pts);
    expect(stats.segments).toHaveLength(1);
    expect(stats.segments[0]?.quality).toBe('poor');
  });

  it("marks source 'dem' and quality 'corrected' when groundElevation is present", () => {
    const pts = Array.from({ length: 6 }, (_, i) =>
      point({
        timestamp: i * 1000,
        longitude: i * 0.001,
        altitude: 50 + i, // noisy raw — should be ignored in favor of ground
        groundElevation: 200 + i * 2,
        accuracy: 5,
      })
    );
    const stats = computeElevationStats(pts);
    expect(stats.source).toBe('dem');
    expect(stats.corrected).toBe(true);
    expect(stats.segments).toHaveLength(1);
    expect(stats.segments[0]?.quality).toBe('corrected');
    // Ground rises 200→210, so it should register gain and ~no loss.
    expect(stats.total_gain_m).toBeGreaterThan(0);
    expect(stats.total_loss_m).toBe(0);
    // start/end come from the corrected series, not raw altitude.
    expect(stats.start_elevation_m).toBeGreaterThanOrEqual(200);
    expect(stats.end_elevation_m).toBeLessThanOrEqual(210);
  });

  it("marks source 'hybrid' when only some points are corrected", () => {
    const pts: GpsPointRecord[] = [
      point({ timestamp: 0, longitude: 0.0, altitude: 10, groundElevation: 100 }),
      point({ timestamp: 1000, longitude: 0.001, altitude: 12, groundElevation: 101 }),
      point({ timestamp: 2000, longitude: 0.002, altitude: 14, groundElevation: 102 }),
      point({ timestamp: 3000, longitude: 0.003, altitude: 16 }), // raw only
      point({ timestamp: 4000, longitude: 0.004, altitude: 18 }),
      point({ timestamp: 5000, longitude: 0.005, altitude: 20 }),
    ];
    const stats = computeElevationStats(pts);
    expect(stats.source).toBe('hybrid');
    expect(stats.corrected).toBe(true);
    // Quality flips from 'corrected' to (accuracy-based) at index 3.
    expect(stats.segments).toHaveLength(2);
    expect(stats.segments[0]?.quality).toBe('corrected');
    expect(stats.segments[1]?.quality).toBe('good');
  });
});

describe('elevationPerSplit', () => {
  it('buckets gain/loss per kilometer of horizontal distance', () => {
    // Step longitude so each step covers a known distance. At the equator
    // 0.001 deg lon ≈ 111.3 m, so ~9 steps per km. Build a long enough track
    // that we cross into a second km bucket, climbing the whole way.
    const n = 20;
    const pts = Array.from({ length: n }, (_, i) =>
      point({ timestamp: i * 1000, longitude: i * 0.001, altitude: 100 + i * 3 })
    );

    const splits = elevationPerSplit(pts, 1000);

    expect(splits.length).toBeGreaterThanOrEqual(2);
    expect(splits[0]?.km).toBe(1);
    // Monotonic climb → all gain, no loss.
    const totalGain = splits.reduce((s, x) => s + x.gain_m, 0);
    const totalLoss = splits.reduce((s, x) => s + x.loss_m, 0);
    expect(totalGain).toBeGreaterThan(0);
    expect(totalLoss).toBe(0);
  });

  it('returns empty for too-short tracks', () => {
    expect(elevationPerSplit([point({ altitude: 10 })])).toEqual([]);
  });
});

describe('liveElevationStep', () => {
  const seed: LiveElevationState = { gain: 0, loss: 0, lastAlt: null };

  it('seeds lastAlt on first finite reading without accumulating', () => {
    const next = liveElevationStep(seed, 100);
    expect(next).toEqual({ gain: 0, loss: 0, lastAlt: 100 });
  });

  it('is a no-op on null readings', () => {
    const state: LiveElevationState = { gain: 5, loss: 2, lastAlt: 100 };
    expect(liveElevationStep(state, null)).toBe(state);
  });

  it('accumulates gain and loss above the jitter threshold', () => {
    let s = liveElevationStep(seed, 100); // seed
    s = liveElevationStep(s, 105); // +5 gain
    s = liveElevationStep(s, 103); // -2 loss
    s = liveElevationStep(s, 110); // +7 gain
    expect(s.gain).toBeCloseTo(12, 5);
    expect(s.loss).toBeCloseTo(2, 5);
    expect(s.lastAlt).toBe(110);
  });

  it('absorbs sub-threshold wiggle (holds reference, no accumulation)', () => {
    let s: LiveElevationState = { gain: 0, loss: 0, lastAlt: 100 };
    s = liveElevationStep(s, 100.5); // < MIN_STEP_DELTA_M (1.0) → ignored
    expect(s.gain).toBe(0);
    expect(s.loss).toBe(0);
    expect(s.lastAlt).toBe(100); // reference held, not moved to 100.5
    // A later real climb is measured from the held reference, not the wiggle.
    s = liveElevationStep(s, 102); // +2 from 100
    expect(s.gain).toBeCloseTo(2, 5);
  });
});

describe('buildElevationUrl', () => {
  it('comma-joins latitudes and longitudes in open-meteo format', () => {
    const url = buildElevationUrl([
      { latitude: 45.1, longitude: -73.2 },
      { latitude: 45.2, longitude: -73.3 },
    ]);
    expect(url).toContain('https://api.open-meteo.com/v1/elevation?');
    // URLSearchParams encodes the comma; assert on the decoded form.
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain('latitude=45.1,45.2');
    expect(decoded).toContain('longitude=-73.2,-73.3');
  });
});

describe('parseElevationResponse', () => {
  it('extracts the positional elevation array', () => {
    expect(parseElevationResponse({ elevation: [100, 200, 300] })).toEqual([
      100, 200, 300,
    ]);
  });

  it('coerces non-finite / null entries to null', () => {
    expect(
      parseElevationResponse({ elevation: [100, null, 'x', NaN] })
    ).toEqual([100, null, null, null]);
  });

  it('accepts a singular numeric elevation', () => {
    expect(parseElevationResponse({ elevation: 42 })).toEqual([42]);
  });

  it('returns empty array for malformed bodies', () => {
    expect(parseElevationResponse(null)).toEqual([]);
    expect(parseElevationResponse({})).toEqual([]);
    expect(parseElevationResponse('nope')).toEqual([]);
    expect(parseElevationResponse({ elevation: 'bad' })).toEqual([]);
  });
});

describe('fillElevationGaps', () => {
  it('leaves a complete series unchanged', () => {
    expect(fillElevationGaps([100, 110, 120])).toEqual([100, 110, 120]);
  });

  it('linearly interpolates an interior gap (prevents datum mixing)', () => {
    // A failed DEM batch between two good values must not leave a cliff.
    expect(fillElevationGaps([100, null, null, 130])).toEqual([100, 110, 120, 130]);
  });

  it('carries the nearest known value at the edges', () => {
    expect(fillElevationGaps([null, null, 200, null])).toEqual([200, 200, 200, 200]);
  });

  it('returns all-null unchanged when DEM fully failed (GPS fallback)', () => {
    expect(fillElevationGaps([null, null, null])).toEqual([null, null, null]);
  });

  it('handles the empty series', () => {
    expect(fillElevationGaps([])).toEqual([]);
  });
});

describe('applyPerSplitElevation (Bug 1 reconciliation)', () => {
  const splits = [
    { km: 1, duration_sec: 300, avg_hr: 140 },
    { km: 2, duration_sec: 300, avg_hr: 142 },
  ];

  it('sets each split ascent/descent from the per-km series', () => {
    const out = applyPerSplitElevation(splits, [
      { km: 1, gain_m: 40, loss_m: 5 },
      { km: 2, gain_m: 10, loss_m: 30 },
    ]);
    expect(out.map((s) => s.ascent_m)).toEqual([40, 10]);
    expect(out.map((s) => s.descent_m)).toEqual([5, 30]);
  });

  it('folds a trailing leftover km into the last split so the sum reconciles', () => {
    const perSplit = [
      { km: 1, gain_m: 40, loss_m: 5 },
      { km: 2, gain_m: 10, loss_m: 30 },
      { km: 3, gain_m: 8, loss_m: 12 }, // trailing partial km, no terrain split
    ];
    const out = applyPerSplitElevation(splits, perSplit);
    const totalGain = perSplit.reduce((s, p) => s + p.gain_m, 0); // 58
    const totalLoss = perSplit.reduce((s, p) => s + p.loss_m, 0); // 47
    expect(out).toHaveLength(2); // no bare extra split
    expect(Math.abs(out.reduce((s, x) => s + (x.ascent_m ?? 0), 0) - totalGain)).toBeLessThanOrEqual(2);
    expect(Math.abs(out.reduce((s, x) => s + (x.descent_m ?? 0), 0) - totalLoss)).toBeLessThanOrEqual(2);
  });
});
