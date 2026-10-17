// SPDX-License-Identifier: GPL-3.0-or-later

import type { HRSample } from '@/types';

/**
 * GATT Heart Rate Measurement (0x2A37) parser.
 *
 * Spec:
 *   byte 0: flags
 *     bit 0: HR value format (0 = uint8, 1 = uint16 little-endian)
 *     bit 1: sensor contact supported
 *     bit 2: sensor contact detected
 *     bit 3: energy expended present (uint16 LE, kJ)
 *     bit 4: RR-interval(s) present (uint16 LE each, units of 1/1024 s)
 */

const RR_UNIT_TO_MS = 1000 / 1024;

export function bytesFromBase64(b64: string): Uint8Array {
  // RN provides global.atob; fall back to a manual decoder so this stays npm-free.
  const decoder: ((s: string) => string) | undefined =
    typeof globalThis.atob === 'function' ? globalThis.atob.bind(globalThis) : undefined;

  if (decoder) {
    const bin = decoder(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) {
      out[i] = bin.charCodeAt(i) & 0xff;
    }
    return out;
  }

  return manualBase64Decode(b64);
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function manualBase64Decode(b64: string): Uint8Array {
  const cleaned = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  const padding = cleaned.endsWith('==') ? 2 : cleaned.endsWith('=') ? 1 : 0;
  const len = (cleaned.length / 4) * 3 - padding;
  const out = new Uint8Array(len);

  let p = 0;
  for (let i = 0; i < cleaned.length; i += 4) {
    const c0 = BASE64_CHARS.indexOf(cleaned.charAt(i));
    const c1 = BASE64_CHARS.indexOf(cleaned.charAt(i + 1));
    const c2 = BASE64_CHARS.indexOf(cleaned.charAt(i + 2));
    const c3 = BASE64_CHARS.indexOf(cleaned.charAt(i + 3));
    if (c0 < 0 || c1 < 0) return new Uint8Array(0);

    const b0 = (c0 << 2) | (c1 >> 4);
    if (p < len) out[p++] = b0;
    if (c2 >= 0 && p < len) {
      const b1 = ((c1 & 0x0f) << 4) | (c2 >> 2);
      out[p++] = b1;
    }
    if (c3 >= 0 && p < len) {
      const b2 = ((c2 & 0x03) << 6) | c3;
      out[p++] = b2;
    }
  }
  return out;
}

export function parseHRMeasurement(
  input: string | Uint8Array,
  atTimestamp?: number,
): HRSample | null {
  const bytes = typeof input === 'string' ? bytesFromBase64(input) : input;
  if (bytes.length < 2) return null;

  const flags = bytes[0];
  if (flags === undefined) return null;

  const hr16 = (flags & 0x01) === 0x01;
  const hasEnergy = (flags & 0x08) === 0x08;
  const hasRR = (flags & 0x10) === 0x10;

  let offset = 1;
  let bpm: number;

  if (hr16) {
    if (bytes.length < offset + 2) return null;
    const lo = bytes[offset];
    const hi = bytes[offset + 1];
    if (lo === undefined || hi === undefined) return null;
    bpm = lo | (hi << 8);
    offset += 2;
  } else {
    const v = bytes[offset];
    if (v === undefined) return null;
    bpm = v;
    offset += 1;
  }

  if (!Number.isFinite(bpm) || bpm <= 0 || bpm > 300) return null;

  let energy: number | undefined;
  if (hasEnergy) {
    if (bytes.length < offset + 2) return null;
    const lo = bytes[offset];
    const hi = bytes[offset + 1];
    if (lo === undefined || hi === undefined) return null;
    energy = lo | (hi << 8);
    offset += 2;
  }

  let rr: number[] | undefined;
  if (hasRR) {
    const list: number[] = [];
    while (offset + 2 <= bytes.length) {
      const lo = bytes[offset];
      const hi = bytes[offset + 1];
      if (lo === undefined || hi === undefined) break;
      const raw = lo | (hi << 8);
      list.push(raw * RR_UNIT_TO_MS);
      offset += 2;
    }
    if (list.length > 0) rr = list;
  }

  const sample: HRSample = {
    bpm,
    timestamp: atTimestamp ?? Date.now(),
  };
  if (rr !== undefined) sample.rr = rr;
  if (energy !== undefined) sample.energy = energy;
  return sample;
}
