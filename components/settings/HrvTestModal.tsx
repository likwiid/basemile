// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';
import { Modal, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { useHeartRate } from '@/lib/ble';
import { cleanRrIntervals, computeRmssd } from '@/lib/metrics/hrv';
import { insertHrv } from '@/lib/storage/db';
import { MODAL_BUTTON_CLASS, MODAL_CONTAINER_CLASS, modalContainerStyle } from './modalLayout';

const TEST_DURATION_SEC = 5 * 60;

interface HrvTestModalProps {
  visible: boolean;
  onClose: () => void;
}

interface HrvSummary {
  rmssd: number;
  meanHr: number;
  rrCount: number;
}

/**
 * The Modal renders its children only while shown (and, on iOS, until the
 * dismiss animation ends), so the content and its live HR subscription
 * mount on open and unmount on close instead of re-rendering at 1 Hz while
 * hidden. Each open starts from fresh state.
 */
export function HrvTestModal({ visible, onClose }: HrvTestModalProps) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <HrvTestContent onClose={onClose} />
    </Modal>
  );
}

function HrvTestContent({ onClose }: Pick<HrvTestModalProps, 'onClose'>) {
  const insets = useSafeAreaInsets();
  const { bpm, sample } = useHeartRate();

  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState(TEST_DURATION_SEC);
  const [summary, setSummary] = useState<HrvSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rrRef = useRef<number[]>([]);
  const bpmRef = useRef<number[]>([]);
  const lastSampleTsRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!running) return;
    if (sample === null) return;
    if (lastSampleTsRef.current === sample.timestamp) return;
    lastSampleTsRef.current = sample.timestamp;
    if (sample.rr && sample.rr.length > 0) {
      for (const rr of sample.rr) {
        rrRef.current.push(rr);
      }
    }
    if (Number.isFinite(sample.bpm) && sample.bpm > 0) {
      bpmRef.current.push(sample.bpm);
    }
  }, [sample, running]);

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
  }, [running]);

  const start = () => {
    rrRef.current = [];
    bpmRef.current = [];
    lastSampleTsRef.current = null;
    setSummary(null);
    setError(null);
    setRemaining(TEST_DURATION_SEC);
    setRunning(true);
  };

  const finish = () => {
    setRunning(false);
    const cleaned = cleanRrIntervals(rrRef.current);
    if (cleaned.length < 2) {
      setError('No RR data captured. Pair your strap and try again.');
      return;
    }
    const rmssd = computeRmssd(cleaned);
    const meanHr =
      bpmRef.current.length > 0
        ? Math.round(bpmRef.current.reduce((a, b) => a + b, 0) / bpmRef.current.length)
        : 0;
    const measuredAt = Date.now();
    insertHrv({
      measured_at: measuredAt,
      rmssd_ms: rmssd,
      mean_hr: meanHr,
      rr_count: cleaned.length,
    });
    setSummary({ rmssd, meanHr, rrCount: cleaned.length });
  };

  const cancel = () => {
    if (tickRef.current) clearInterval(tickRef.current);
    setRunning(false);
    setRemaining(TEST_DURATION_SEC);
    rrRef.current = [];
    bpmRef.current = [];
    lastSampleTsRef.current = null;
    setSummary(null);
    setError(null);
    onClose();
  };

  const mm = Math.floor(remaining / 60);
  const ss = remaining % 60;

  return (
    <View className={MODAL_CONTAINER_CLASS} style={modalContainerStyle(insets)}>
      <View className="gap-2">
        <Text className="text-text-primary text-2xl font-semibold">HRV Test</Text>
        <Text className="text-text-secondary text-sm leading-5">
          Lie still. Breathe slowly and naturally for 5 minutes.
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
        {summary !== null ? (
          <View className="items-center mt-3">
            <Text className="text-text-muted text-xs uppercase tracking-widest">
              Result
            </Text>
            <Text className="text-text-primary text-2xl font-bold mt-1">
              RMSSD: {summary.rmssd.toFixed(1)} ms
            </Text>
            <Text className="text-text-secondary text-sm mt-1">
              {summary.meanHr} bpm avg · {summary.rrCount} RR
            </Text>
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
        {!running && summary === null && error === null ? (
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
        {summary !== null ? (
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
        {!running && summary === null && error === null ? (
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
