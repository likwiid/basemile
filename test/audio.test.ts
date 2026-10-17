// SPDX-License-Identifier: GPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { dispatchCue, resetVoicePipeline, speakCoachText, stopAllSpeech } from '@/lib/coach/audio';

vi.mock('@/lib/coach/voiceLog', () => ({ vlog: vi.fn() }));

interface Utterance {
  text: string;
  options: { onDone?: () => void; onStopped?: () => void; onError?: (e: unknown) => void };
}

// Controllable fake of expo-speech: every utterance waits until the test ends
// it with onDone / onError, and stop() reports the current one as stopped like
// the platform engine does.
const speech = vi.hoisted(() => ({ utterances: [] as Utterance[], stops: 0 }));

vi.mock('expo-speech', () => ({
  speak: vi.fn((text: string, options: Utterance['options']) => {
    speech.utterances.push({ text, options });
  }),
  stop: vi.fn(async () => {
    speech.stops += 1;
    speech.utterances.at(-1)?.options.onStopped?.();
  }),
}));

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

function spoken(): string[] {
  return speech.utterances.map((u) => u.text);
}

async function finish(text: string): Promise<void> {
  await flush();
  const entry = speech.utterances.find((u) => u.text === text);
  if (!entry) throw new Error(`never spoke ${text}`);
  entry.options.onDone?.();
  await flush();
}

describe('speakCoachText (device voice)', () => {
  beforeEach(() => {
    stopAllSpeech();
    speech.utterances = [];
    speech.stops = 0;
  });

  it('speaks through the device engine and makes no network request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = speakCoachText('Hold this effort.');
    await finish('Hold this effort.');

    await expect(result).resolves.toBe('played');
    expect(spoken()).toEqual(['Hold this effort.']);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('ignores empty text', async () => {
    await expect(speakCoachText('   ')).resolves.toBe('cancelled');
    expect(spoken()).toEqual([]);
  });

  it('resolves an interrupted cue as cancelled and never re-speaks it', async () => {
    const first = speakCoachText('Old cue.');
    await flush();
    const second = speakCoachText('New cue.', { interrupt: true });
    await expect(first).resolves.toBe('cancelled');

    await finish('New cue.');
    await expect(second).resolves.toBe('played');
    expect(speech.stops).toBeGreaterThan(0);
    expect(spoken()).toEqual(['Old cue.', 'New cue.']);
  });

  it('queues a plain cue behind the one speaking instead of talking over it', async () => {
    const first = speakCoachText('First.');
    const second = speakCoachText('Second.');
    await flush();
    expect(spoken()).toEqual(['First.']);

    await finish('First.');
    await expect(first).resolves.toBe('played');
    await finish('Second.');
    await expect(second).resolves.toBe('played');
    expect(spoken()).toEqual(['First.', 'Second.']);
  });

  it('flushes queued cues when an interrupt arrives', async () => {
    const playing = speakCoachText('Playing.');
    const queued = speakCoachText('Queued.');
    await flush();
    const urgent = speakCoachText('Urgent.', { interrupt: true });

    await expect(playing).resolves.toBe('cancelled');
    await expect(queued).resolves.toBe('cancelled');
    await finish('Urgent.');
    await expect(urgent).resolves.toBe('played');
    expect(spoken()).not.toContain('Queued.');
  });

  it('reports an engine error as failed', async () => {
    const result = speakCoachText('Broken engine.');
    await flush();
    speech.utterances[0]!.options.onError?.(new Error('engine down'));
    await expect(result).resolves.toBe('failed');
  });

  it('drops everything on a voice reset', async () => {
    const playing = speakCoachText('Stuck.');
    const queued = speakCoachText('Behind it.');
    await flush();
    resetVoicePipeline();
    await expect(playing).resolves.toBe('cancelled');
    await expect(queued).resolves.toBe('cancelled');
    expect(spoken()).toEqual(['Stuck.']);
  });
});

describe('dispatchCue', () => {
  beforeEach(() => {
    stopAllSpeech();
    speech.utterances = [];
    speech.stops = 0;
  });

  it('stays quiet when the coach is silenced', async () => {
    await dispatchCue({ kind: 'zone_exceeded', text: 'Ease off.', tone: 'urgent', timestamp: 0 }, 'silent');
    expect(spoken()).toEqual([]);
  });

  it('lets an urgent cue cut in over a steady one', async () => {
    const steady = dispatchCue(
      { kind: 'periodic_checkin', text: 'Ten minutes in.', tone: 'steady', timestamp: 0 },
      'voice'
    );
    await flush();
    const urgent = dispatchCue(
      { kind: 'zone_exceeded', text: 'Slow down now.', tone: 'urgent', timestamp: 0 },
      'voice'
    );
    await steady;
    await finish('Slow down now.');
    await urgent;
    expect(spoken()).toEqual(['Ten minutes in.', 'Slow down now.']);
  });
});
