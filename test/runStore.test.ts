// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionForRunType } from '@/lib/run/runTypes';
import { useActiveRunStore } from '@/lib/run/store';
import { useProfileStore } from '@/lib/storage/profile';
import type { GpsPoint, HRSample } from '@/types';

const h = vi.hoisted(() => ({ vlog: vi.fn(), mafThrows: false }));

vi.mock('@/lib/coach/voiceLog', () => ({ vlog: h.vlog }));

vi.mock('@/lib/metrics/maf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/metrics/maf')>();
  return {
    ...actual,
    mafPaceFromSamples: (...args: Parameters<typeof actual.mafPaceFromSamples>) => {
      if (h.mafThrows) throw new Error('bad samples');
      return actual.mafPaceFromSamples(...args);
    },
  };
});

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

const T0 = Date.UTC(2026, 3, 1, 7, 0, 0);

function hrAt(sec: number): HRSample {
  // Warm-up ramp, steady drift, and 4 hard surges in the second half so the
  // interval recovery-drop path has a peak to anchor on.
  const base = 110 + Math.min(30, sec / 20) + sec / 400;
  const surge = sec > 1800 && sec % 300 < 60 ? 28 : 0;
  const wobble = Math.round(3 * Math.sin(sec / 7));
  return {
    bpm: Math.round(base + surge + wobble),
    timestamp: T0 + sec * 1000,
  };
}

function gpsAt(sec: number): GpsPoint {
  // ~3 m/s north-east with a rolling altitude profile and one glitch.
  const lat = 45 + (sec * 2.2) / 111_320;
  const lon = 6 + (sec * 2.0) / 78_710;
  const glitch = sec === 1500 ? 80 : 0;
  return {
    timestamp: T0 + sec * 1000 + 250,
    latitude: lat,
    longitude: lon,
    altitude: sec % 97 === 0 ? null : 400 + 25 * Math.sin(sec / 180) + glitch,
    altitudeAccuracy: 4,
    speed: 3,
    accuracy: 5,
  };
}

interface LiveDigest {
  distance: number;
  pace: number;
  gain: number;
  loss: number;
  alt: number;
  bpm: number;
  zones: number;
}

/**
 * Drive a 50-minute synthetic run through the store: 1 Hz HR and GPS, a
 * 2-minute pause at 20 min (pushes while paused must be dropped), then either
 * finish while active or finish while paused.
 */
function simulate(runType: 'long' | 'brief', finishPaused: boolean) {
  const profile = useProfileStore.getState().profile;
  const session = sessionForRunType(runType, profile);
  const store = useActiveRunStore.getState();
  vi.setSystemTime(T0);
  store.armRun(session);
  store.startRun();

  const digest: LiveDigest = {
    distance: 0,
    pace: 0,
    gain: 0,
    loss: 0,
    alt: 0,
    bpm: 0,
    zones: 0,
  };
  const TOTAL = 50 * 60;
  for (let sec = 0; sec < TOTAL; sec++) {
    vi.setSystemTime(T0 + sec * 1000);
    if (sec === 1200) useActiveRunStore.getState().pauseRun();
    if (sec === 1320) useActiveRunStore.getState().resumeRun();
    useActiveRunStore.getState().pushSample(hrAt(sec));
    useActiveRunStore.getState().pushGps(gpsAt(sec));
    const s = useActiveRunStore.getState();
    digest.distance += s.distance_m;
    digest.pace += s.current_pace_sec_per_km ?? -1;
    digest.gain += s.live_elevation_gain_m;
    digest.loss += s.live_elevation_loss_m;
    digest.alt += s.current_altitude_m ?? -1;
    digest.bpm += s.current_bpm ?? -1;
    digest.zones += s.current_zone ?? -1;
  }
  if (finishPaused) {
    vi.setSystemTime(T0 + TOTAL * 1000);
    useActiveRunStore.getState().pauseRun();
  }
  vi.setSystemTime(T0 + TOTAL * 1000 + 45_000);
  const before = useActiveRunStore.getState();
  const counts = {
    hr: before.hr_samples.length,
    gps: before.gps_points.length,
  };
  const completed = useActiveRunStore.getState().finishRun();
  return { completed, digest, counts };
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function roundDigest(d: LiveDigest): LiveDigest {
  return {
    distance: round(d.distance),
    pace: round(d.pace),
    gain: round(d.gain),
    loss: round(d.loss),
    alt: round(d.alt),
    bpm: d.bpm,
    zones: d.zones,
  };
}

describe('active run store — synthetic run is stable', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useActiveRunStore.getState().reset();
  });
  afterEach(() => {
    useActiveRunStore.getState().reset();
    vi.useRealTimers();
  });

  it.each([
    ['long', false],
    ['long', true],
    ['brief', false],
    ['brief', true],
  ] as const)('finishRun output for %s run (finish paused: %s)', (type, paused) => {
    const { completed, digest, counts } = simulate(type, paused);
    expect(counts).toEqual({ hr: 2880, gps: 2880 });
    expect(roundDigest(digest)).toMatchSnapshot('live digest');
    expect(completed).toMatchSnapshot('completed run');
  });

  it('starts every run with empty sample buffers', () => {
    simulate('long', false);
    const profile = useProfileStore.getState().profile;
    useActiveRunStore.getState().armRun(sessionForRunType('long', profile));
    const s = useActiveRunStore.getState();
    expect(s.hr_samples).toEqual([]);
    expect(s.gps_points).toEqual([]);
    expect(s.distance_m).toBe(0);
  });

  it('keeps a finished run snapshot intact after the next run starts', () => {
    const profile = useProfileStore.getState().profile;
    vi.setSystemTime(T0);
    const store = useActiveRunStore.getState();
    store.armRun(sessionForRunType('long', profile));
    store.startRun();
    for (let sec = 0; sec < 10; sec++) {
      vi.setSystemTime(T0 + sec * 1000);
      useActiveRunStore.getState().pushSample(hrAt(sec));
      useActiveRunStore.getState().pushGps(gpsAt(sec));
    }
    const hrSnapshot = useActiveRunStore.getState().hr_samples;
    const gpsSnapshot = useActiveRunStore.getState().gps_points;
    useActiveRunStore.getState().finishRun();

    useActiveRunStore.getState().armRun(sessionForRunType('long', profile));
    useActiveRunStore.getState().startRun();
    useActiveRunStore.getState().pushSample(hrAt(100));
    useActiveRunStore.getState().pushGps(gpsAt(100));

    expect(hrSnapshot).toHaveLength(10);
    expect(gpsSnapshot).toHaveLength(10);
    expect(useActiveRunStore.getState().hr_samples).toHaveLength(1);
    expect(useActiveRunStore.getState().gps_points).toHaveLength(1);
  });

  it('appends in place and bumps the sample counters on each push', () => {
    const profile = useProfileStore.getState().profile;
    vi.setSystemTime(T0);
    useActiveRunStore.getState().armRun(sessionForRunType('long', profile));
    useActiveRunStore.getState().startRun();
    const hrBuffer = useActiveRunStore.getState().hr_samples;
    const gpsBuffer = useActiveRunStore.getState().gps_points;
    for (let sec = 0; sec < 5; sec++) {
      useActiveRunStore.getState().pushSample(hrAt(sec));
      useActiveRunStore.getState().pushGps(gpsAt(sec));
      const s = useActiveRunStore.getState();
      expect(s.hr_count).toBe(sec + 1);
      expect(s.gps_count).toBe(sec + 1);
    }
    expect(useActiveRunStore.getState().hr_samples).toBe(hrBuffer);
    expect(useActiveRunStore.getState().gps_points).toBe(gpsBuffer);
    expect(hrBuffer).toHaveLength(5);
    useActiveRunStore.getState().reset();
    expect(useActiveRunStore.getState().hr_count).toBe(0);
    expect(useActiveRunStore.getState().hr_samples).not.toBe(hrBuffer);
  });

  it('still finishes the run when a derived metric throws', () => {
    h.mafThrows = true;
    try {
      const { completed } = simulate('long', false);
      expect(completed.maf_pace_sec_per_km).toBeNull();
      expect(completed.duration_sec).toBeGreaterThan(0);
      expect(completed.avg_hr).toBeGreaterThan(0);
      expect(useActiveRunStore.getState().status).toBe('finished');
      expect(h.vlog).toHaveBeenCalledWith('finish.metric-error', {
        metric: 'maf',
        msg: 'bad samples',
      });
    } finally {
      h.mafThrows = false;
    }
  });

  it('ignores pushes while paused or idle', () => {
    const profile = useProfileStore.getState().profile;
    vi.setSystemTime(T0);
    useActiveRunStore.getState().pushSample(hrAt(0));
    useActiveRunStore.getState().pushGps(gpsAt(0));
    expect(useActiveRunStore.getState().hr_samples).toHaveLength(0);
    useActiveRunStore.getState().armRun(sessionForRunType('long', profile));
    useActiveRunStore.getState().startRun();
    useActiveRunStore.getState().pushSample(hrAt(1));
    useActiveRunStore.getState().pauseRun();
    useActiveRunStore.getState().pushSample(hrAt(2));
    useActiveRunStore.getState().pushGps(gpsAt(2));
    expect(useActiveRunStore.getState().hr_samples).toHaveLength(1);
    expect(useActiveRunStore.getState().gps_points).toHaveLength(0);
  });
});
