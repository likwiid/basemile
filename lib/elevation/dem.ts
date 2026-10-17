// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * DEM (Digital Elevation Model) cloud-correction client.
 *
 * Uses the free, key-less Open-Meteo Elevation API to turn noisy GPS
 * altitudes into true ground elevation. The URL-building and
 * response-parsing halves are kept pure and exported so they can be unit
 * tested without a network. Only `fetchGroundElevations` touches the
 * network, and it never throws — it degrades to nulls.
 *
 * Open-Meteo request shape:
 *   GET .../v1/elevation?latitude=a,b,c&longitude=x,y,z
 * Response shape (assumed):
 *   { "elevation": [number, number, number] }
 * The `elevation` array is positional, 1:1 with the latitude/longitude lists.
 */

import { DEM_API } from '@/config/constants';
import { areOnlineLookupsEnabled } from '@/lib/config/lookups';

export interface DemCoordinate {
  latitude: number;
  longitude: number;
}

/**
 * Build an Open-Meteo elevation request URL for a batch of coordinates.
 * Latitudes and longitudes are comma-joined positional lists. Pure.
 *
 * NOTE: callers should keep each batch ≤ DEM_API.BATCH_SIZE; this helper does
 * not split — `fetchGroundElevations` handles batching.
 */
export function buildElevationUrl(coords: DemCoordinate[]): string {
  const lats = coords.map((c) => c.latitude).join(',');
  const lons = coords.map((c) => c.longitude).join(',');
  const params = new URLSearchParams({ latitude: lats, longitude: lons });
  return `${DEM_API.BASE_URL}?${params.toString()}`;
}

/**
 * Extract the positional `elevation` array from an Open-Meteo response body.
 * Pure and defensive: any unexpected shape yields an empty array, and
 * non-finite entries (or explicit nulls) become null. Open-Meteo returns the
 * field as `elevation`; we also accept a singular numeric `elevation` just in
 * case a single-coordinate request collapses it.
 */
export function parseElevationResponse(json: unknown): (number | null)[] {
  if (json == null || typeof json !== 'object') return [];
  const elevation = (json as { elevation?: unknown }).elevation;

  if (Array.isArray(elevation)) {
    return elevation.map((v) =>
      typeof v === 'number' && Number.isFinite(v) ? v : null
    );
  }
  if (typeof elevation === 'number' && Number.isFinite(elevation)) {
    return [elevation];
  }
  return [];
}

/**
 * Fill null gaps in a positional elevation series by linear interpolation
 * between the nearest known neighbours (edges carry the nearest known value).
 * This keeps the corrected series on a SINGLE datum: downstream gain/loss math
 * must never mix DEM ground elevation with raw GPS altitude, or every
 * partial-correction boundary becomes a phantom cliff. If every entry is null
 * (DEM fully failed), the series is returned unchanged so callers fall back to
 * raw GPS altitude. Pure.
 */
export function fillElevationGaps(values: (number | null)[]): (number | null)[] {
  const n = values.length;
  if (n === 0) return [];
  const isNum = (x: number | null | undefined): x is number =>
    typeof x === 'number' && Number.isFinite(x);

  const prevKnown: number[] = new Array(n).fill(-1);
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (isNum(values[i])) last = i;
    prevKnown[i] = last;
  }
  const nextKnown: number[] = new Array(n).fill(-1);
  let nxt = -1;
  for (let i = n - 1; i >= 0; i--) {
    if (isNum(values[i])) nxt = i;
    nextKnown[i] = nxt;
  }

  const out: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (isNum(v)) {
      out[i] = v;
      continue;
    }
    const lo = prevKnown[i] ?? -1;
    const hi = nextKnown[i] ?? -1;
    const vlo = lo >= 0 ? values[lo] : null;
    const vhi = hi >= 0 ? values[hi] : null;
    if (isNum(vlo) && isNum(vhi)) {
      out[i] = vlo + (vhi - vlo) * ((i - lo) / (hi - lo));
    } else if (isNum(vlo)) {
      out[i] = vlo;
    } else if (isNum(vhi)) {
      out[i] = vhi;
    }
  }
  return out;
}

/** Split a flat list into fixed-size chunks. */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Fetch one batch with an AbortController timeout and bounded retries.
 * Returns a null-filled array of length `batch.length` on any failure (never
 * throws). A successful response is normalized to exactly `batch.length`
 * entries (truncated or null-padded if the API disagrees on length).
 */
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchBatch(batch: DemCoordinate[]): Promise<(number | null)[]> {
  const fallback = (): (number | null)[] => new Array(batch.length).fill(null);
  const url = buildElevationUrl(batch);

  for (let attempt = 0; attempt <= DEM_API.MAX_RETRIES; attempt++) {
    // Back off before each retry. Rate limits (429) are the common failure when
    // a multi-batch run is corrected in one burst, so retrying after a pause
    // (rather than bailing) is what makes correction reliable.
    if (attempt > 0) await delay(DEM_API.RETRY_BACKOFF_MS * attempt);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEM_API.TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      // 429 and other non-OK responses are retryable.
      if (!res.ok) throw new Error(`DEM HTTP ${res.status}`);
      const json: unknown = await res.json();
      const parsed = parseElevationResponse(json);

      // Align strictly to the batch length.
      const aligned: (number | null)[] = new Array(batch.length).fill(null);
      for (let i = 0; i < batch.length; i++) {
        aligned[i] = i < parsed.length ? (parsed[i] ?? null) : null;
      }
      return aligned;
    } catch {
      // fall through to retry / fallback
    } finally {
      clearTimeout(timer);
    }
  }
  return fallback();
}

/**
 * Look up DEM ground elevation for every coordinate, batching by
 * DEM_API.BATCH_SIZE. Returns an array aligned 1:1 with `coords`, with null
 * wherever a lookup failed. Never throws — a total network outage yields an
 * all-null array of the right length.
 */
export async function fetchGroundElevations(
  coords: DemCoordinate[]
): Promise<(number | null)[]> {
  if (coords.length === 0) return [];
  // Turned off in Settings: behave like an outage so callers keep GPS altitude.
  if (!areOnlineLookupsEnabled()) return new Array<number | null>(coords.length).fill(null);

  const batches = chunk(coords, DEM_API.BATCH_SIZE);
  const results: (number | null)[] = [];
  for (const batch of batches) {
    const elevations = await fetchBatch(batch);
    for (let i = 0; i < batch.length; i++) {
      results.push(elevations[i] ?? null);
    }
  }
  return results;
}
