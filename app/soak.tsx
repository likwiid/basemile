// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Voice soak harness: a self-driving endurance test for the whole speak
 * pipeline. Launched via deep link (no UI entry point):
 *
 *   adb shell am start -a android.intent.action.VIEW \
 *     -d "basemile://soak?min=45" com.likwiid.basemile
 *
 * For N minutes it reproduces a real voice-mode run: a band-style cue every
 * 30 s and a fresh psych line every 90 s. Everything logs to the voice black
 * box on the device, so a silent failure shows up as failed outcomes with
 * timestamps.
 */
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Screen } from '@/components/ui/Screen';
import { speakCoachText } from '@/lib/coach/audio';
import { PSYCH_CUE_LINES } from '@/lib/coach/psychCues';
import {
  vlog,
  vlogEndSession,
  vlogFlush,
  vlogRecent,
  vlogStartSession,
} from '@/lib/coach/voiceLog';

const BAND_TEXTS = [
  'Heart rate one forty six. On target. Hold this effort.',
  'One forty two. Right in the band. Keep it rolling.',
  'One forty eight. Top of the band. Stay smooth.',
  'One forty four. On target. Relax and hold.',
];

const BAND_EVERY_MS = 30_000;
const PSYCH_EVERY_MS = 90_000;

interface Tally {
  attempts: number;
  played: number;
  failed: number;
}

function tallyFromLog(): Tally {
  const t: Tally = { attempts: 0, played: 0, failed: 0 };
  for (const ev of vlogRecent(2000)) {
    if (ev.e === 'speak.begin') t.attempts += 1;
    else if (ev.e === 'speak.device' && ev.d?.outcome === 'finished') t.played += 1;
    else if (ev.e === 'speak.device' && ev.d?.outcome === 'failed') t.failed += 1;
    else if (ev.e === 'speak.threw') t.failed += 1;
  }
  return t;
}

export default function SoakScreen() {
  const { min } = useLocalSearchParams<{ min?: string }>();
  const router = useRouter();
  const totalMin = Math.min(120, Math.max(1, Number.parseInt(min ?? '45', 10) || 45));

  const [running, setRunning] = useState(true);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [tally, setTally] = useState<Tally>(tallyFromLog);
  const speakingRef = useRef(false);
  const bandIdxRef = useRef(0);
  const psychIdxRef = useRef(0);
  const runningRef = useRef(true);
  runningRef.current = running;

  const say = useCallback(async (text: string) => {
    if (speakingRef.current) {
      vlog('soak.skip-busy');
      return;
    }
    speakingRef.current = true;
    try {
      await Promise.race([
        speakCoachText(text, { interrupt: true }),
        new Promise<void>((resolve) => setTimeout(resolve, 30_000)),
      ]);
    } finally {
      speakingRef.current = false;
    }
  }, []);

  useEffect(() => {
    vlogStartSession(`soak-${totalMin}min`);
    void activateKeepAwakeAsync('soak');
    void say('Soak test started. I will keep talking so you do not have to.');

    const startedAt = Date.now();
    const tick = setInterval(() => {
      const sec = Math.floor((Date.now() - startedAt) / 1000);
      setElapsedSec(sec);
      setTally(tallyFromLog());
      if (sec >= totalMin * 60 && runningRef.current) {
        runningRef.current = false;
        setRunning(false);
        vlog('soak.complete', { sec });
        void say('Soak complete. Every cue you heard was a pass.').then(() =>
          vlogEndSession('soak-complete')
        );
      }
    }, 1000);

    const band = setInterval(() => {
      if (!runningRef.current) return;
      const text = BAND_TEXTS[bandIdxRef.current % BAND_TEXTS.length]!;
      bandIdxRef.current += 1;
      vlog('soak.band', { i: bandIdxRef.current });
      void say(text);
    }, BAND_EVERY_MS);

    const psych = setInterval(() => {
      if (!runningRef.current) return;
      const cue = PSYCH_CUE_LINES[psychIdxRef.current % PSYCH_CUE_LINES.length]!;
      psychIdxRef.current += 1;
      vlog('soak.psych', { i: psychIdxRef.current, id: cue.id });
      void say(cue.text);
    }, PSYCH_EVERY_MS);

    return () => {
      clearInterval(tick);
      clearInterval(band);
      clearInterval(psych);
      deactivateKeepAwake('soak');
      vlogEndSession('soak-unmount');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mins = Math.floor(elapsedSec / 60);
  const secs = elapsedSec % 60;

  return (
    <Screen>
      <View className="flex-1 px-4 pt-14 gap-3">
        <Text className="text-text-primary text-2xl font-bold">
          Voice soak {running ? 'running' : 'DONE'}
        </Text>
        <Text className="text-text-secondary text-base">
          {mins}:{String(secs).padStart(2, '0')} / {totalMin}:00
        </Text>

        <View className="bg-bg-elevated rounded-xl p-3 gap-1">
          <Text className="text-text-primary text-sm">attempts: {tally.attempts}</Text>
          <Text className="text-zone-z2 text-sm">played: {tally.played}</Text>
          <Text className="text-zone-z5 text-sm">failed: {tally.failed}</Text>
        </View>

        <View className="bg-bg-elevated rounded-xl p-3 gap-0.5">
          {vlogRecent(10)
            .slice()
            .reverse()
            .map((ev, i) => (
              <Text key={i} className="text-text-muted text-[11px]" numberOfLines={1}>
                {new Date(ev.t).toISOString().slice(11, 19)} {ev.e}{' '}
                {ev.d ? JSON.stringify(ev.d) : ''}
              </Text>
            ))}
        </View>

        <View className="flex-row gap-3 mt-2">
          <Pressable
            onPress={() => void vlogFlush('manual')}
            className="px-4 h-11 rounded-lg bg-bg-elevated border border-bg-border justify-center"
          >
            <Text className="text-text-primary text-sm">Flush log</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              runningRef.current = false;
              setRunning(false);
              vlogEndSession('soak-stopped');
              router.back();
            }}
            className="px-4 h-11 rounded-lg bg-zone-z5/20 border border-zone-z5/50 justify-center"
          >
            <Text className="text-zone-z5 text-sm">Stop</Text>
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}
