// SPDX-License-Identifier: GPL-3.0-or-later

import { areOnlineLookupsEnabled } from '@/lib/config/lookups';
import type { RunWeather } from '@/types';

const WEATHER_TIMEOUT_MS = 8000;
const WEATHER_RETRIES = 2;
const WEATHER_RETRY_DELAY_MS = 3000;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

interface OpenMeteoCurrent {
  temperature_2m?: number;
  relative_humidity_2m?: number;
  wind_speed_10m?: number;
  weather_code?: number;
}

interface OpenMeteoResponse {
  current?: OpenMeteoCurrent;
}

export async function fetchRunWeather(
  latitude: number,
  longitude: number,
  now = Date.now()
): Promise<RunWeather> {
  // Turned off in Settings: no coordinates leave the device.
  if (!areOnlineLookupsEnabled()) return unavailable(now);

  // Bug 6: don't fire before a real GPS fix — (0,0) or NaN coords yield junk.
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    (latitude === 0 && longitude === 0)
  ) {
    console.warn('[weather] skipped: no valid GPS fix', { latitude, longitude });
    return unavailable(now);
  }

  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code',
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;

  // Retry a couple of times — the previous single-shot attempt swallowed every
  // transient failure (timeout/network) as "unavailable" with no signal.
  for (let attempt = 0; attempt <= WEATHER_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEATHER_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`weather HTTP ${response.status}`);
      const json = (await response.json()) as OpenMeteoResponse;
      const current = json.current;
      if (!current) throw new Error('weather: missing `current`');
      const weather: RunWeather = {
        temp_c: finiteOrNull(current.temperature_2m),
        humidity_pct: finiteOrNull(current.relative_humidity_2m),
        wind_kmh: finiteOrNull(current.wind_speed_10m),
        weather_code: finiteOrNull(current.weather_code),
        captured_at: now,
        source: 'open-meteo',
      };
      if (
        weather.temp_c === null &&
        weather.humidity_pct === null &&
        weather.wind_kmh === null &&
        weather.weather_code === null
      ) {
        throw new Error('weather: all fields null');
      }
      return weather;
    } catch (error) {
      console.warn(`[weather] attempt ${attempt + 1} failed:`, String(error));
      if (attempt < WEATHER_RETRIES) await delay(WEATHER_RETRY_DELAY_MS);
    } finally {
      clearTimeout(timeout);
    }
  }
  return unavailable(now);
}

export function weatherLabel(weather: RunWeather | null | undefined): string {
  if (!weather || weather.source === 'unavailable') return 'Weather unavailable';
  const temp = weather.temp_c !== null ? `${Math.round(weather.temp_c)}°C` : null;
  const humidity =
    weather.humidity_pct !== null ? `${Math.round(weather.humidity_pct)}% humidity` : null;
  const wind = weather.wind_kmh !== null ? windLabel(weather.wind_kmh) : null;
  const label = [temp, humidity, wind].filter((part): part is string => Boolean(part)).join(', ');
  return label.length > 0 ? label : 'Weather unavailable';
}

function windLabel(windKmh: number): string {
  if (windKmh < 6) return 'calm';
  if (windKmh < 18) return 'light breeze';
  if (windKmh < 30) return 'windy';
  return 'strong wind';
}

function unavailable(now: number): RunWeather {
  return {
    temp_c: null,
    humidity_pct: null,
    wind_kmh: null,
    weather_code: null,
    captured_at: now,
    source: 'unavailable',
  };
}

function finiteOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
