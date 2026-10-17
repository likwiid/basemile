// SPDX-License-Identifier: GPL-3.0-or-later

import type { CoachCue, CoachVerbosity } from '@/types';

import { speakOnDevice, stopDeviceSpeech } from './deviceTts';
import { vlog } from './voiceLog';

/**
 * Speaks coach cues with the phone's own text-to-speech engine
 * (lib/coach/deviceTts). Nothing is sent over the network.
 *
 * Cues are serialized: a plain cue waits for the one ahead of it, an
 * interrupting cue cancels whatever is playing or queued. A cancelled cue
 * resolves as 'cancelled' and is never spoken again, so exactly one voice is
 * ever audible.
 */

export type SpeakOutcome = 'played' | 'cancelled' | 'failed';

interface SpeakCoachTextOptions {
  /** Cut off the current cue and drop anything queued behind it. */
  interrupt?: boolean;
}

// Bumped by every interrupt/stop; a cue only plays while its generation is live.
let generation = 0;
let queue: Promise<unknown> = Promise.resolve();

function cancelSpeech(): void {
  generation += 1;
  queue = Promise.resolve();
  stopDeviceSpeech();
}

export function speakCoachText(
  text: string,
  options: SpeakCoachTextOptions = {}
): Promise<SpeakOutcome> {
  const trimmed = text.trim();
  if (trimmed.length === 0) return Promise.resolve('cancelled');
  if (options.interrupt) cancelSpeech();

  const gen = generation;
  const task = queue.then(() => speakNow(trimmed, gen));
  queue = task.catch(() => undefined);
  return task;
}

async function speakNow(text: string, gen: number): Promise<SpeakOutcome> {
  const isCurrent = (): boolean => gen === generation;
  if (!isCurrent()) return 'cancelled';

  const t0 = Date.now();
  vlog('speak.begin', { words: text.split(/\s+/).length });
  try {
    const outcome = await speakOnDevice(text, isCurrent);
    vlog('speak.device', { outcome, ms: Date.now() - t0 });
    if (outcome === 'finished') return 'played';
    if (outcome === 'cancelled') return 'cancelled';
    return 'failed';
  } catch {
    vlog('speak.threw');
    return 'failed';
  }
}

export async function dispatchCue(cue: CoachCue, verbosity: CoachVerbosity): Promise<void> {
  if (verbosity !== 'voice' || !cue.text) return;
  // Urgent cues (over the ceiling, last rep) cut in instead of queueing.
  await speakCoachText(cue.text, { interrupt: cue.tone === 'urgent' });
}

/** Silence the coach now: stop the current cue and drop the queue. */
export function stopAllSpeech(): void {
  cancelSpeech();
}

/**
 * One-tap recovery for a stuck voice: stops any speech and drops the queue.
 * The next cue starts fresh.
 */
export function resetVoicePipeline(): void {
  cancelSpeech();
}
