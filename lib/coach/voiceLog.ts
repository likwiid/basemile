// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Voice-pipeline black box. Every meaningful event in the speak path is
 * recorded with a timestamp into a ring buffer that is persisted to a file on
 * the device, so a mid-run failure can be diagnosed from real evidence instead
 * of hypotheses. The log never leaves the phone. Logging must never break the
 * pipeline: every entry point is wrapped and fire-and-forget.
 */
import { Directory, File, Paths } from 'expo-file-system';

const MAX_EVENTS = 2000;
const FLUSH_INTERVAL_MS = 120_000;

export interface VoiceLogEvent {
  /** epoch ms */
  t: number;
  /** short event tag, e.g. 'speak.start', 'stt.error' */
  e: string;
  /** small serializable detail payload */
  d?: Record<string, unknown>;
}

let events: VoiceLogEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let sessionId = `s-${Date.now().toString(36)}`;

/** Append an event. Safe to call from anywhere, never throws. */
export function vlog(e: string, d?: Record<string, unknown>): void {
  try {
    events.push({ t: Date.now(), e, ...(d ? { d } : {}) });
    if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS);
  } catch {
    // never let logging break the voice path
  }
}

/** Most recent events, newest last (for on-screen debug). */
export function vlogRecent(count = 50): VoiceLogEvent[] {
  return events.slice(-count);
}

function logFile(): File | null {
  try {
    const dir = new Directory(Paths.document, 'voicelog');
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    return new File(dir, 'voicelog.json');
  } catch {
    return null;
  }
}

/** Persist the buffer to disk (survives crashes/kills). Never throws. */
export function vlogPersist(): void {
  try {
    const file = logFile();
    if (!file) return;
    file.write(JSON.stringify({ sessionId, savedAt: Date.now(), events }));
  } catch {
    // best-effort
  }
}

/** Persist the buffer to disk, tagged with why. Never throws. */
export async function vlogFlush(reason: string): Promise<void> {
  try {
    vlog('vlog.flush', { reason, count: events.length });
    vlogPersist();
  } catch {
    // best-effort
  }
}

/**
 * Start periodic flushing (run start / soak start). Idempotent. Earlier
 * events are kept (the ring buffer caps size): wiping them here used to
 * erase the evidence of whatever went wrong just before a new session.
 */
export function vlogStartSession(label: string): void {
  sessionId = `s-${Date.now().toString(36)}`;
  vlog('session.start', { label });
  if (flushTimer === null) {
    flushTimer = setInterval(() => {
      void vlogFlush('interval');
    }, FLUSH_INTERVAL_MS);
  }
}

/** Stop periodic flushing and do a final flush. */
export function vlogEndSession(label: string): void {
  vlog('session.end', { label });
  if (flushTimer !== null) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  void vlogFlush('end');
}

let errorsCaptured = false;

/**
 * Record JS errors in the black box. A release build writes nothing to
 * logcat, so an error thrown inside a tap handler used to vanish without a
 * trace. Chains to the existing handlers; never throws.
 */
export function vlogCaptureErrors(): void {
  if (errorsCaptured) return;
  errorsCaptured = true;
  try {
    const errorUtils = (globalThis as { ErrorUtils?: GlobalErrorUtils }).ErrorUtils;
    if (errorUtils) {
      const previous = errorUtils.getGlobalHandler();
      errorUtils.setGlobalHandler((error, isFatal) => {
        vlog('js.error', { fatal: isFatal === true, ...describeError(error) });
        vlogPersist();
        if (isFatal) void vlogFlush('fatal');
        previous(error, isFatal);
      });
    }
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      vlog('console.error', { msg: args.map(String).join(' ').slice(0, 400) });
      originalConsoleError(...args);
    };
  } catch {
    // best-effort
  }
}

interface GlobalErrorUtils {
  getGlobalHandler: () => (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => void;
}

function describeError(error: unknown): { msg: string; stack?: string } {
  if (error instanceof Error) {
    return { msg: error.message, stack: error.stack?.split('\n').slice(0, 6).join('\n') };
  }
  return { msg: String(error) };
}
