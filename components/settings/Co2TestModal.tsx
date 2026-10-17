// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';
import { Modal, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { useHeartRate } from '@/lib/ble';
import { insertCo2 } from '@/lib/storage/db';
import { MODAL_BUTTON_CLASS, MODAL_CONTAINER_CLASS, modalContainerStyle } from './modalLayout';

type Phase = 'idle' | 'inhaling' | 'exhaling' | 'holding' | 'done';

const INHALE_SEC = 5;
const EXHALE_SEC = 5;

interface Co2TestModalProps {
  visible: boolean;
  onClose: () => void;
}

function formatMmSs(totalSec: number): string {
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

function toleranceLabel(holdSec: number): string {
  if (holdSec < 25) return 'Baseline. Keep training nasal breathing.';
  if (holdSec < 40) return 'Improving. Your CO2 tolerance is rising.';
  return 'Strong tolerance. Excellent aerobic capacity.';
}

/**
 * The Modal renders its children only while shown (and, on iOS, until the
 * dismiss animation ends), so the content and its live HR subscription
 * mount on open and unmount on close instead of re-rendering at 1 Hz while
 * hidden. Each open starts from fresh state.
 */
export function Co2TestModal({ visible, onClose }: Co2TestModalProps) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <Co2TestContent visible={visible} onClose={onClose} />
    </Modal>
  );
}

function Co2TestContent({ visible, onClose }: Co2TestModalProps) {
  const insets = useSafeAreaInsets();
  const { bpm } = useHeartRate();

  const [phase, setPhase] = useState<Phase>('idle');
  const [phaseRemaining, setPhaseRemaining] = useState(0);
  const [holdElapsed, setHoldElapsed] = useState(0);
  const [holdResult, setHoldResult] = useState<number | null>(null);

  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdStartRef = useRef<number | null>(null);

  const clearTick = () => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearTick();
    };
  }, []);

  useEffect(() => {
    if (!visible) {
      clearTick();
      setPhase('idle');
      setPhaseRemaining(0);
      setHoldElapsed(0);
      setHoldResult(null);
      holdStartRef.current = null;
    }
  }, [visible]);

  const startInhale = () => {
    setHoldResult(null);
    setHoldElapsed(0);
    setPhase('inhaling');
    setPhaseRemaining(INHALE_SEC);
    clearTick();
    tickRef.current = setInterval(() => {
      setPhaseRemaining((r) => {
        if (r <= 1) {
          startExhale();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
  };

  const startExhale = () => {
    clearTick();
    setPhase('exhaling');
    setPhaseRemaining(EXHALE_SEC);
    tickRef.current = setInterval(() => {
      setPhaseRemaining((r) => {
        if (r <= 1) {
          startHold();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
  };

  const startHold = () => {
    clearTick();
    setPhase('holding');
    setPhaseRemaining(0);
    setHoldElapsed(0);
    holdStartRef.current = Date.now();
    tickRef.current = setInterval(() => {
      if (holdStartRef.current === null) return;
      const elapsed = Math.floor((Date.now() - holdStartRef.current) / 1000);
      setHoldElapsed(elapsed);
    }, 250);
  };

  const stopHold = () => {
    clearTick();
    if (holdStartRef.current === null) return;
    const elapsed = Math.floor((Date.now() - holdStartRef.current) / 1000);
    holdStartRef.current = null;
    setHoldElapsed(elapsed);
    setHoldResult(elapsed);
    setPhase('done');
    insertCo2({ measured_at: Date.now(), hold_sec: elapsed });
  };

  const cancel = () => {
    clearTick();
    holdStartRef.current = null;
    setPhase('idle');
    setPhaseRemaining(0);
    setHoldElapsed(0);
    setHoldResult(null);
    onClose();
  };

  const close = () => {
    clearTick();
    holdStartRef.current = null;
    setPhase('idle');
    setPhaseRemaining(0);
    setHoldElapsed(0);
    setHoldResult(null);
    onClose();
  };

  return (
    <View className={MODAL_CONTAINER_CLASS} style={modalContainerStyle(insets)}>
      <View className="gap-2">
        <Text className="text-text-primary text-2xl font-semibold">CO2 Tolerance</Text>
        <Text className="text-text-secondary text-sm leading-5">
          A single nasal breath-hold after a full exhale.
        </Text>
      </View>

      <View className="items-center gap-3">
        {phase === 'idle' ? (
          <View className="items-center gap-3 px-2">
            <Text className="text-text-muted text-xs uppercase tracking-widest">
              How it works
            </Text>
            <Text className="text-text-primary text-sm leading-6 text-center">
              1. Inhale normally through the nose{'\n'}
              2. Exhale fully through the nose{'\n'}
              3. Hold your breath as long as comfortable{'\n'}
              4. Stop when you feel the first urge to inhale
            </Text>
          </View>
        ) : null}

        {phase === 'inhaling' ? (
          <View className="items-center gap-3">
            <Text className="text-text-muted text-xs uppercase tracking-widest">
              Inhale
            </Text>
            <Text className="text-zone-z2 text-2xl font-semibold text-center px-4">
              Take a normal breath in through your nose
            </Text>
            <Text className="text-text-primary text-6xl font-bold font-mono">
              {phaseRemaining}
            </Text>
          </View>
        ) : null}

        {phase === 'exhaling' ? (
          <View className="items-center gap-3">
            <Text className="text-text-muted text-xs uppercase tracking-widest">
              Exhale
            </Text>
            <Text className="text-zone-z2 text-2xl font-semibold text-center px-4">
              Now exhale fully through your nose
            </Text>
            <Text className="text-text-primary text-6xl font-bold font-mono">
              {phaseRemaining}
            </Text>
            <Text className="text-text-secondary text-sm text-center px-4">
              After the count, hold your breath.
            </Text>
          </View>
        ) : null}

        {phase === 'holding' ? (
          <View className="items-center gap-3">
            <Text className="text-text-muted text-xs uppercase tracking-widest">
              Hold
            </Text>
            <Text className="text-text-primary text-7xl font-bold font-mono">
              {formatMmSs(holdElapsed)}
            </Text>
            <Text className="text-text-secondary text-sm">
              {bpm !== null ? `${bpm} bpm` : 'No strap connected'}
            </Text>
          </View>
        ) : null}

        {phase === 'done' && holdResult !== null ? (
          <View className="items-center gap-3">
            <Text className="text-text-muted text-xs uppercase tracking-widest">
              Hold duration
            </Text>
            <Text className="text-text-primary text-6xl font-bold font-mono">
              {formatMmSs(holdResult)}
            </Text>
            <Text className="text-text-secondary text-sm leading-5 text-center px-4 mt-2">
              {toleranceLabel(holdResult)}
            </Text>
            <Text className="text-text-muted text-xs text-center px-4 mt-2">
              {'<25s = baseline · 25-40s = improving · 40s+ = strong'}
            </Text>
          </View>
        ) : null}
      </View>

      <View className="gap-3">
        {phase === 'idle' ? (
          <Button title="Start" size="md" onPress={startInhale} className={MODAL_BUTTON_CLASS} />
        ) : null}
        {phase === 'holding' ? (
          <Button
            title="Stop"
            variant="danger"
            size="md"
            onPress={stopHold}
            className={MODAL_BUTTON_CLASS}
          />
        ) : null}
        {phase === 'inhaling' || phase === 'exhaling' ? (
          <Button
            title="Cancel"
            variant="secondary"
            size="md"
            onPress={cancel}
            className={MODAL_BUTTON_CLASS}
          />
        ) : null}
        {phase === 'done' ? (
          <>
            <Button
              title="Run Again"
              variant="secondary"
              size="md"
              onPress={startInhale}
              className={MODAL_BUTTON_CLASS}
            />
            <Button title="Done" size="md" onPress={close} className={MODAL_BUTTON_CLASS} />
          </>
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
