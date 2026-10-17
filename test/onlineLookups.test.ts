// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';

import { setOnlineLookupsEnabled } from '@/lib/config/lookups';
import { fetchGroundElevations } from '@/lib/elevation/dem';
import { fetchRunWeather } from '@/lib/run/weather';

describe('weather and elevation lookups turned off', () => {
  afterEach(() => {
    setOnlineLookupsEnabled(true);
    vi.unstubAllGlobals();
  });

  it('skips the weather request and reports weather as unavailable', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    setOnlineLookupsEnabled(false);

    const weather = await fetchRunWeather(33.585, -7.627, 1000);
    expect(weather.source).toBe('unavailable');
    expect(weather.captured_at).toBe(1000);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('skips the elevation request and returns no ground elevation', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    setOnlineLookupsEnabled(false);

    const coords = [
      { latitude: 33.585, longitude: -7.627 },
      { latitude: 33.586, longitude: -7.628 },
    ];
    await expect(fetchGroundElevations(coords)).resolves.toEqual([null, null]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
