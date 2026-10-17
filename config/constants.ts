// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * App-wide constants. No business logic, no defaults that change behavior —
 * those live in /lib.
 */

export const APP_NAME = 'BaseMile';

/** BLE service / characteristic UUIDs per Bluetooth GATT spec. */
export const BLE_UUIDS = {
  HEART_RATE_SERVICE: '0000180d-0000-1000-8000-00805f9b34fb',
  HEART_RATE_MEASUREMENT: '00002a37-0000-1000-8000-00805f9b34fb',
  BATTERY_SERVICE: '0000180f-0000-1000-8000-00805f9b34fb',
  BATTERY_LEVEL: '00002a19-0000-1000-8000-00805f9b34fb',
  DEVICE_INFORMATION: '0000180a-0000-1000-8000-00805f9b34fb',
} as const;

/** AsyncStorage keys for Zustand persist middleware. */
export const STORAGE_KEYS = {
  PROFILE: 'basemile:profile:v1',
  BLE: 'basemile:ble:v1',
  SETTINGS: 'basemile:settings:v1',
  COACH: 'basemile:coach:v1',
} as const;

/** SQLite database file. */
export const DB_NAME = 'basemile.db';

/** MAF window in bpm — used for drift tracking. */
export const MAF_WINDOW: readonly [number, number] = [145, 149];

/** Default coach throttle so we don't spam the runner. */
export const COACH_CUE_COOLDOWN_MS = 15_000;

/** Default Z2 long-run periodic check-in interval. */
export const COACH_PERIODIC_CHECKIN_MS = 10 * 60 * 1000;

/** UI throttle: paint at most this often during a run. */
export const UI_HR_UPDATE_INTERVAL_MS = 1000;

/** Reconnection retry cadence. */
export const BLE_RECONNECT_INTERVAL_MS = 5_000;
export const BLE_RECONNECT_TIMEOUT_MS = 60_000;

// ============================================================================
// Elevation
// ============================================================================

/** Elevation computation + data-quality thresholds. */
export const ELEVATION = {
  /**
   * Horizontal GPS accuracy (m) above which a point's altitude is treated as
   * unreliable for the data-quality strip. ≤ this = "good" lock.
   */
  GOOD_ACCURACY_M: 15,
  /** Accuracy (m) above this = "poor". Between GOOD and POOR = "fair". */
  POOR_ACCURACY_M: 35,
  /**
   * Minimum per-step altitude delta (m) that counts toward gain/loss. Filters
   * GPS jitter so a flat run doesn't accumulate hundreds of phantom meters.
   */
  MIN_STEP_DELTA_M: 1.0,
  /** Moving-average window (points) applied to altitude before summing deltas. */
  SMOOTHING_WINDOW: 5,
  /**
   * Minimum track points before elevation stats are attempted. Applied to the
   * total point count (not points-with-altitude) so quality segments can still
   * be classified on sparse-altitude tracks; coverage_pct flags sparseness.
   */
  MIN_POINTS: 6,
} as const;

/**
 * Open-Meteo Elevation API — free, no key, returns ground (DEM) elevation for
 * lat/lon pairs. Used to cloud-correct noisy GPS altitude into true elevation.
 * Docs: https://open-meteo.com/en/docs/elevation-api
 */
export const DEM_API = {
  BASE_URL: 'https://api.open-meteo.com/v1/elevation',
  /** Max coordinate pairs per request (API hard limit is 100). */
  BATCH_SIZE: 100,
  /** Network timeout per batch request. */
  TIMEOUT_MS: 12_000,
  /** Retry attempts per batch on transient failure (incl. 429 rate limits). */
  MAX_RETRIES: 4,
  /** Base backoff between retries (ms); scaled by attempt number. */
  RETRY_BACKOFF_MS: 1_500,
} as const;

// ============================================================================
// Maps (MapLibre + OpenFreeMap)
// ============================================================================

/**
 * MapLibre config. MapLibre needs no account or access token: the basemap
 * comes from OpenFreeMap's keyless tiles, or a raster provider set at build
 * time (components/map/maplibre).
 */
export const MAPLIBRE = {
  DEFAULT_ZOOM: 14,
} as const;

/**
 * True whenever the map can render. MapLibre + OpenFreeMap need no token, so this is
 * trivially true; kept so importers that previously gated on token availability
 * keep compiling without a behavior change.
 */
export const HAS_MAP = true;
