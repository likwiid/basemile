// SPDX-License-Identifier: GPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DECOUPLING_METHOD_VERSION } from '@/lib/metrics/decoupling';
import { recomputeDecouplingOnce, resolveDecoupling } from '@/lib/run/recomputeDecoupling';
import type { CompletedRun, StoredDecoupling } from '@/types';

const h = vi.hoisted(() => ({
  asyncStore: {} as Record<string, string>,
  db: {
    getAllRuns: vi.fn(),
    getGpsPoints: vi.fn(() => []),
    getHRSamples: vi.fn(() => []),
    updateRunDecoupling: vi.fn(),
  },
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => h.asyncStore[k] ?? null),
    setItem: vi.fn(async (k: string, v: string) => {
      h.asyncStore[k] = v;
    }),
    removeItem: vi.fn(async (k: string) => {
      delete h.asyncStore[k];
    }),
  },
}));

vi.mock('@/lib/storage/db', () => h.db);

const FLAG = 'migration:decoupling-v1';

const stored = (method_version: number): StoredDecoupling => ({
  first_half_efficiency: 0.0162,
  second_half_efficiency: 0.0149,
  decoupling_pct: 8.2,
  reliable: true,
  method_version,
  params: { warmup_trim_sec: 300, min_duration_sec: 1800, min_distance_m: 3000, max_half_hr_delta: 8 },
});

const run = (id: string, decoupling?: StoredDecoupling | null): CompletedRun =>
  ({ id, decoupling }) as unknown as CompletedRun;

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(h.asyncStore)) delete h.asyncStore[k];
});

describe('resolveDecoupling', () => {
  it('returns the stored value without recomputing when the method version is current', () => {
    const current = stored(DECOUPLING_METHOD_VERSION);
    expect(resolveDecoupling(run('a', current), [], [])).toBe(current);
    expect(h.db.updateRunDecoupling).not.toHaveBeenCalled();
  });

  it('computes and persists once when no stored value exists', () => {
    const r = resolveDecoupling(run('b', null), [], []);
    expect(r.method_version).toBe(DECOUPLING_METHOD_VERSION);
    expect(h.db.updateRunDecoupling).toHaveBeenCalledWith(
      'b',
      expect.objectContaining({ method_version: DECOUPLING_METHOD_VERSION })
    );
  });

  it('recomputes when the stored value is from an older method version', () => {
    resolveDecoupling(run('c', stored(0)), [], []);
    expect(h.db.updateRunDecoupling).toHaveBeenCalledWith('c', expect.anything());
  });
});

describe('recomputeDecouplingOnce', () => {
  it('backfills runs lacking a current value, skips current ones, and sets the flag', async () => {
    h.db.getAllRuns.mockReturnValue([
      run('a', null),
      run('b', stored(DECOUPLING_METHOD_VERSION)),
      run('c', stored(0)),
    ]);
    const updated = await recomputeDecouplingOnce();
    expect(updated).toBe(2); // a (missing) + c (stale); b skipped
    expect(h.db.updateRunDecoupling).toHaveBeenCalledTimes(2);
    expect(h.asyncStore[FLAG]).toBe('1');
  });

  it('is a no-op once the flag is set', async () => {
    h.asyncStore[FLAG] = '1';
    expect(await recomputeDecouplingOnce()).toBe(0);
    expect(h.db.getAllRuns).not.toHaveBeenCalled();
  });
});
