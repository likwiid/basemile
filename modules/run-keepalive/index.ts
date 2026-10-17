// SPDX-License-Identifier: GPL-3.0-or-later

import { AppRegistry, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

/** Must match RunKeepAliveModule.TASK_KEY on the native side. */
const TASK_KEY = 'BaseMileRunKeepAlive';

interface RunKeepAliveNative {
  start(title: string, body: string): boolean;
  stop(): void;
}

const native =
  Platform.OS === 'android' ? requireOptionalNativeModule<RunKeepAliveNative>('RunKeepAlive') : null;

let releaseTask: (() => void) | null = null;

// The native side opens this task so React Native keeps JS timers running
// while the screen is off. It stays pending until the run ends.
if (native) {
  AppRegistry.registerHeadlessTask(TASK_KEY, () => () =>
    new Promise<void>((resolve) => {
      releaseTask = resolve;
    }),
  );
}

/** Keep the run (GPS, heart rate, voice cues) alive in the background. */
export function startRunKeepAlive(title: string, body: string): boolean {
  if (!native) return false;
  return native.start(title, body);
}

export function stopRunKeepAlive(): void {
  releaseTask?.();
  releaseTask = null;
  native?.stop();
}
