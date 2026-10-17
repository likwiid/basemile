// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';
import { Modal, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { useHeartRate } from '@/lib/ble';
import { computeZonesFromKarvonen } from '@/lib/zones';
import { insertBaseline, recomputeAllRunZoneDistributions } from '@/lib/storage/db';
import { useProfileStore } from '@/lib/storage/profile';
import { MODAL_BUTTON_CLASS, MODAL_CONTAINER_CLASS, modalContainerStyle } from './modalLayout';

type Phase = 'idle' | 'warmup' | 'hard' | 'sprint' | 'done';

type ActivePhase = Exclude<Phase, 'idle' | 'done'>;

interface PhaseSpec {
  next: ActivePhase | 'done' | null;
  label: string;
  instruction: string;
  durationSec: number;
}

const PHASES: Record<ActivePhase, PhaseSpec> = {
  warmup: {
    next: 'hard',
    label: 'Warmup',
    instruction: '10 minutes easy. Get the legs moving.',
    durationSec: 10 * 60,
  },
  hard: {
    next: 'sprint',
    label: 'Hard Effort',
    instruction: '3 minutes hard. Build to threshold.',
    durationSec: 3 * 60,
  },
  sprint: {
    next: 'done',
    label: 'All-Out Sprint',
    instruction: '30 seconds. Empty the tank.',
    durationSec: 30,
  },
};

interface MaxHRTestModalProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * The Modal renders its children only while shown (and, on iOS, until the
 * dismiss animation ends), so the content and its live HR subscription
 * mount on open and unmount on close instead of re-rendering at 1 Hz while
 * hidden. Each open starts from fresh state.
 */
export function MaxHRTestModal({ visible, onClose }: MaxHRTestModalProps) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <MaxHRTestContent onClose={onClose} />
    </Modal>
  );
}

function MaxHRTestContent({ onClose }: Pick<MaxHRTestModalProps, 'onClose'>) {
  const insets = useSafeAreaInsets();
  const { bpm } = useHeartRate();
  const update = useProfileStore((s) => s.update);
  const profile = useProfileStore((s) => s.profile);

  const [phase, setPhase] = useState<Phase>('idle');
  const [remaining, setRemaining] = useState(0);
  const peakRef = useRef(0);
  const [peak, setPeak] = useState(0);
  const [savedPeak, setSavedPeak] = useState<number | null>(null);
  const reachedSprintEndRef = useRef(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (phase === 'idle' || phase === 'done') return;
    if (bpm !== null && bpm > peakRef.current) {
      peakRef.current = bpm;
      setPeak(bpm);
    }
  }, [bpm, phase]);

  useEffect(() => {
    if (phase === 'idle' || phase === 'done') return;
    tickRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          if (tickRef.current) clearInterval(tickRef.current);
          advancePhase(true);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const start = () => {
    peakRef.current = 0;
    setPeak(0);
    setSavedPeak(null);
    reachedSprintEndRef.current = false;
    setPhase('warmup');
    setRemaining(PHASES.warmup.durationSec);
  };

  const advancePhase = (completedNaturally = false) => {
    if (phase === 'idle' || phase === 'done') return;
    const spec = PHASES[phase];
    const next = spec.next;
    if (next === null || next === 'done') {
      // Only save if the sprint phase actually ran to completion. Manual
      // skipping into done is treated as an aborted test.
      if (phase === 'sprint' && completedNaturally) {
        reachedSprintEndRef.current = true;
        savePeak();
      }
      setPhase('done');
      return;
    }
    setRemaining(PHASES[next].durationSec);
    setPhase(next);
  };

  const savePeak = () => {
    if (!reachedSprintEndRef.current) return;
    const value = peakRef.current;
    if (value <= 0) return;
    insertBaseline({ measured_at: Date.now(), kind: 'max_hr', bpm: value });
    const zones = computeZonesFromKarvonen(value, profile.hrRest, profile.mafCeiling);
    update({
      hrMax: value,
      zones,
    });
    recomputeAllRunZoneDistributions(zones);
    setSavedPeak(value);
  };

  const cancel = () => {
    if (tickRef.current) clearInterval(tickRef.current);
    setPhase('idle');
    setRemaining(0);
    peakRef.current = 0;
    setPeak(0);
    setSavedPeak(null);
    reachedSprintEndRef.current = false;
    onClose();
  };

  const mm = Math.floor(remaining / 60);
  const ss = remaining % 60;
  const active = phase !== 'idle' && phase !== 'done';

  return (
    <View className={MODAL_CONTAINER_CLASS} style={modalContainerStyle(insets)}>
      <View className="gap-2">
        <Text className="text-text-primary text-2xl font-semibold">Max HR Test</Text>
        <Text className="text-text-secondary text-sm leading-5">
          Warmup, then build to a hard 3 minutes, then a 30-second all-out sprint. Stop if dizzy.
        </Text>
      </View>

      <View className="items-center gap-3">
        {active ? (
          <>
            <Text className="text-text-muted text-xs uppercase tracking-widest">
              {PHASES[phase].label}
            </Text>
            <Text className="text-zone-z4 text-7xl font-bold">{bpm ?? '--'}</Text>
            <Text className="text-text-secondary text-xl font-mono">
              {mm}:{String(ss).padStart(2, '0')}
            </Text>
            <Text className="text-text-secondary text-center text-sm leading-5 px-4">
              {PHASES[phase].instruction}
            </Text>
            <Text className="text-text-muted text-sm mt-1">
              Peak so far: {peak > 0 ? `${peak} bpm` : '--'}
            </Text>
          </>
        ) : null}
        {phase === 'done' ? (
          <View className="items-center gap-2">
            <Text className="text-text-muted text-xs uppercase tracking-widest">
              {savedPeak !== null ? 'Saved Max HR' : 'Max HR not saved'}
            </Text>
            <Text className="text-zone-z5 text-5xl font-bold">
              {savedPeak ?? peak}
            </Text>
            <Text className="text-text-secondary text-center text-sm leading-5">
              {savedPeak !== null
                ? 'Zones recalculated.'
                : 'Complete the all-out sprint timer to update zones.'}
            </Text>
          </View>
        ) : null}
        {phase === 'idle' ? (
          <Text className="text-text-secondary text-center text-sm leading-5 px-4">
            Make sure your strap is connected. This takes ~14 minutes.
          </Text>
        ) : null}
      </View>

      <View className="gap-3">
        {phase === 'idle' ? (
          <Button
            title="Start Warmup"
            size="md"
            onPress={start}
            className={MODAL_BUTTON_CLASS}
          />
        ) : null}
        {active ? (
          <>
            <Button
              title="Skip Phase"
              variant="secondary"
              size="md"
              onPress={() => advancePhase(false)}
              className={MODAL_BUTTON_CLASS}
            />
            <Button
              title="Cancel"
              variant="danger"
              size="md"
              onPress={cancel}
              className={MODAL_BUTTON_CLASS}
            />
          </>
        ) : null}
        {phase === 'done' ? (
          <Button title="Done" size="md" onPress={onClose} className={MODAL_BUTTON_CLASS} />
        ) : null}
        {phase === 'idle' ? (
          <Button
            title="Close"
            variant="secondary"
            size="md"
            onPress={onClose}
            className={MODAL_BUTTON_CLASS}
          />
        ) : null}
      </View>
    </View>
  );
}
