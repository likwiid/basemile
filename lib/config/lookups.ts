// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Whether the app may look up weather and terrain elevation from Open-Meteo.
 * These lookups send run coordinates to api.open-meteo.com. They are on by
 * default and can be turned off in Settings; the settings store keeps this
 * flag in sync. Kept as a plain module so the fetch helpers stay free of
 * storage dependencies.
 */

let enabled = true;

export function areOnlineLookupsEnabled(): boolean {
  return enabled;
}

export function setOnlineLookupsEnabled(on: boolean): void {
  enabled = on;
}
