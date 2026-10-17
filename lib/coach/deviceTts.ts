// SPDX-License-Identifier: GPL-3.0-or-later

import * as Speech from 'expo-speech';

import { vlog } from './voiceLog';

/**
 * On-device text-to-speech, the coach voice. Uses the platform engine through
 * expo-speech, so it works offline and sends nothing anywhere.
 */

export type DeviceSpeakOutcome = 'finished' | 'cancelled' | 'failed';

// Generous cap: cues are short, but a stuck engine must not block the queue.
const SPEAK_TIMEOUT_MS = 20_000;

let active: { cancel: () => void } | null = null;

/** Speak `text` and resolve when the engine reports it done, stopped or failed. */
export function speakOnDevice(
  text: string,
  isCurrent: () => boolean = () => true
): Promise<DeviceSpeakOutcome> {
  if (!isCurrent()) return Promise.resolve('cancelled');
  if (active) stopDeviceSpeech();

  return new Promise<DeviceSpeakOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: DeviceSpeakOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (active === handle) active = null;
      resolve(outcome);
    };
    const handle = { cancel: () => finish('cancelled') };
    active = handle;

    const timer = setTimeout(() => {
      vlog('tts.device.cap');
      finish('failed');
    }, SPEAK_TIMEOUT_MS);

    try {
      Speech.speak(text, {
        language: 'en-US',
        onDone: () => finish('finished'),
        onStopped: () => finish('cancelled'),
        onError: (error) => {
          vlog('tts.device.error', { msg: String(error) });
          finish('failed');
        },
      });
    } catch (error) {
      vlog('tts.device.error', { msg: String(error) });
      finish('failed');
    }
  });
}

/** Stop whatever the device engine is saying. Never throws. */
export function stopDeviceSpeech(): void {
  const current = active;
  active = null;
  current?.cancel();
  try {
    void Speech.stop();
  } catch {
    // no-op
  }
}
