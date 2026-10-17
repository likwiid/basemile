// SPDX-License-Identifier: GPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Button } from '@/components/ui/Button';
import { vlog } from '@/lib/coach/voiceLog';
import type { RunStatus } from '@/types';

interface RunControlsProps {
  status: RunStatus;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

const CONFIRM_WINDOW_MS = 4000;

/**
 * Two-tap finish: the first tap arms the button ("Tap to finish") for a few
 * seconds, the second finishes. Replaces a native Alert, which on Android can
 * fail to appear right after the Voice Mode modal closes, leaving Stop
 * looking dead until the screen was left and re-entered.
 *
 * Armed-ness lives in a ref so a quick second tap counts even when it lands
 * before the "Tap to finish" re-render.
 */
export function useConfirmStop(onStop: () => void): { armed: boolean; press: () => void } {
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onStopRef = useRef(onStop);
  onStopRef.current = onStop;
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );
  const press = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (armedRef.current) {
      vlog('stop.tap', { armed: true });
      armedRef.current = false;
      setArmed(false);
      onStopRef.current();
      return;
    }
    vlog('stop.tap', { armed: false });
    armedRef.current = true;
    setArmed(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      armedRef.current = false;
      setArmed(false);
    }, CONFIRM_WINDOW_MS);
  }, []);
  return { armed, press };
}

function AnimatedRunControls({
  status,
  onPause,
  onResume,
  onStop,
}: RunControlsProps) {
  const isPaused = status === 'paused';
  const stop = useConfirmStop(onStop);
  // Crossfade between Pause and Resume buttons.
  const resumeOpacity = useSharedValue(isPaused ? 1 : 0);
  const pauseOpacity = useSharedValue(isPaused ? 0 : 1);

  useEffect(() => {
    const target = isPaused ? 1 : 0;
    resumeOpacity.value = withTiming(target, {
      duration: 180,
      easing: Easing.inOut(Easing.quad),
    });
    pauseOpacity.value = withTiming(1 - target, {
      duration: 180,
      easing: Easing.inOut(Easing.quad),
    });
  }, [isPaused, resumeOpacity, pauseOpacity]);

  const resumeStyle = useAnimatedStyle(() => ({
    opacity: resumeOpacity.value,
  }));
  const pauseStyle = useAnimatedStyle(() => ({
    opacity: pauseOpacity.value,
  }));

  return (
    <View className="flex-row gap-3">
      <View className="flex-1" style={{ minHeight: 56 }}>
        {isPaused ? (
          <Animated.View style={resumeStyle}>
            <Button
              title="Resume"
              onPress={onResume}
              variant="primary"
              size="xl"
            />
          </Animated.View>
        ) : (
          <Animated.View style={pauseStyle}>
            <Button
              title="Pause"
              onPress={onPause}
              variant="secondary"
              size="xl"
            />
          </Animated.View>
        )}
      </View>
      <Button
        title={stop.armed ? 'Tap to finish' : 'Stop'}
        onPress={stop.press}
        variant="danger"
        size="xl"
        className="flex-1"
      />
    </View>
  );
}

export function RunControls(props: RunControlsProps) {
  return <AnimatedRunControls {...props} />;
}
