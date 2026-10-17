// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';
import { Modal, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { useHeartRate } from '@/lib/ble';
import { insertBaseline, recomputeAllRunZoneDistributions } from '@/lib/storage/db';
import { useProfileStore } from '@/lib/storage/profile';
import { computeZonesFromKarvonen } from '@/lib/zones';
import { MODAL_BUTTON_CLASS, MODAL_CONTAINER_CLASS, modalContainerStyle } from './modalLayout';

const TEST_DURATION_SEC = 180;
const AVG_WINDOW_SEC = 60;

interface BaselineTestModalProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * The Modal renders its children only while shown (and, on iOS, until the
 * dismiss animation ends), so the content and its live HR subscription
 * mount on open and unmount on close instead of re-rendering at 1 Hz while
 * hidden. Each open starts from fresh state.
 */
export function BaselineTestModal({ visible, onClose }: BaselineTestModalProps) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <BaselineTestContent onClose={onClose} />
    </Modal>
  );
}

function BaselineTestContent({ onClose }: Pick<BaselineTestModalProps, 'onClose'>) {
  const insets = useSafeAreaInsets();
  const { bpm } = useHeartRate();
  const update = useProfileStore((s) => s.update);
  const profile = useProfileStore((s) => s.profile);

  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState(TEST_DURATION_SEC);
  const [finalBpm, setFinalBpm] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const samplesRef = useRef<{ ts: number; bpm: number }[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!running) return;
    if (bpm !== null) {
      samplesRef.current.push({ ts: Date.now(), bpm });
    }
  }, [bpm, running]);

  useEffect(() => {
    if (!running) return;
    tickRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          if (tickRef.current) clearInterval(tickRef.current);
          finish();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const start = () => {
    samplesRef.current = [];
    setFinalBpm(null);
    setError(null);
    setRemaining(TEST_DURATION_SEC);
    setRunning(true);
  };

  const finish = () => {
    setRunning(false);
    const cutoff = Date.now() - AVG_WINDOW_SEC * 1000;
    const tail = samplesRef.current.filter((s) => s.ts >= cutoff);
    if (tail.length === 0) {
      setError('No HR data captured. Pair your strap first.');
      return;
    }
    const avg = Math.round(tail.reduce((a, s) => a + s.bpm, 0) / tail.length);
    setFinalBpm(avg);
    insertBaseline({ measured_at: Date.now(), kind: 'resting_hr', bpm: avg });
    const zones = computeZonesFromKarvonen(profile.hrMax, avg, profile.mafCeiling);
    update({ hrRest: avg, zones });
    recomputeAllRunZoneDistributions(zones);
  };

  const cancel = () => {
    if (tickRef.current) clearInterval(tickRef.current);
    setRunning(false);
    setRemaining(TEST_DURATION_SEC);
    samplesRef.current = [];
    setFinalBpm(null);
    setError(null);
    onClose();
  };

  const mm = Math.floor(remaining / 60);
  const ss = remaining % 60;

  return (
    <View className={MODAL_CONTAINER_CLASS} style={modalContainerStyle(insets)}>
      <View className="gap-2">
        <Text className="text-text-primary text-2xl font-semibold">Resting HR Test</Text>
        <Text className="text-text-secondary text-sm leading-5">
          {"Lie still. Don't move. Breathe normally."}
        </Text>
      </View>

      <View className="items-center gap-3">
        <Text className="text-text-muted text-xs uppercase tracking-widest">
          Live BPM
        </Text>
        <Text className="text-zone-z2 text-7xl font-bold">{bpm ?? '--'}</Text>
        <Text className="text-text-secondary text-xl font-mono">
          {mm}:{String(ss).padStart(2, '0')} remaining
        </Text>
        {finalBpm !== null ? (
          <View className="items-center mt-3">
            <Text className="text-text-muted text-xs uppercase tracking-widest">
              Saved baseline
            </Text>
            <Text className="text-text-primary text-4xl font-bold">{finalBpm} bpm</Text>
          </View>
        ) : null}
        {error ? (
          <View className="items-center mt-3 px-4">
            <Text className="text-zone-z5 text-sm font-semibold mb-1 uppercase tracking-widest">
              Test failed
            </Text>
            <Text className="text-text-primary text-base text-center">{error}</Text>
          </View>
        ) : null}
      </View>

      <View className="gap-3">
        {!running && finalBpm === null && error === null ? (
          <Button title="Start Test" size="md" onPress={start} className={MODAL_BUTTON_CLASS} />
        ) : null}
        {running ? (
          <Button
            title="Cancel"
            variant="secondary"
            size="md"
            onPress={cancel}
            className={MODAL_BUTTON_CLASS}
          />
        ) : null}
        {finalBpm !== null ? (
          <Button title="Done" size="md" onPress={onClose} className={MODAL_BUTTON_CLASS} />
        ) : null}
        {error ? (
          <Button
            title="Close"
            variant="secondary"
            size="md"
            onPress={cancel}
            className={MODAL_BUTTON_CLASS}
          />
        ) : null}
        {!running && finalBpm === null && error === null ? (
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
