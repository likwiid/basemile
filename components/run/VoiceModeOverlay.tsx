// SPDX-License-Identifier: GPL-3.0-or-later

import { Ionicons } from '@expo/vector-icons';
import { memo, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Polyline, Rect, Stop } from 'react-native-svg';

import { useConfirmStop } from '@/components/run/RunControls';
import {
  classifyBand,
  OVER_CEILING_URGENT_BPM,
  type BandState,
  type SessionPhase,
  type TargetBand,
} from '@/lib/coach/voiceMode';
import { formatDistance, formatDuration, formatPace } from '@/lib/time';
import type { ZoneNumber } from '@/types';

const STATE_COLOR: Record<BandState, string> = {
  in: '#10b981',
  below: '#f59e0b',
  above: '#ef4444',
  no_signal: '#6b7280',
};

/** Spec §8: pure black base, off-white text. */
const OFF_WHITE = '#f5f5f4';
const MUTED_TEXT = '#737373';
const SECONDARY_TEXT = '#a8a8a8';
const COACH_NAME = 'Coach';

/** BandField wash levels: ~12% at rest, lifted to ~20% when urgently over ceiling. */
const WASH_BASE = 0.12;
const WASH_URGENT = 0.2;

const GAUGE_TRACK_H = 16;
const GAUGE_MARKER = 18;
/** Rolling HR window kept for the gauge sparkline (60 s) and trend (last 30 s). */
const SPARK_WINDOW_MS = 60_000;
const TREND_WINDOW_MS = 30_000;
/** HR slope (bpm per 30 s) beyond which the trend chevron tips up/down. */
const TREND_THRESHOLD_BPM = 3;

/** Coach line height (the last spoken cue). */
const COACH_SURFACE_H = 84;
/** Dock buttons: big, thumb-reachable targets for a running hand. */
const DOCK_BUTTON_SIZE = 88;
const DOCK_GAP_TWO = 48;
const DOCK_GAP_THREE = 24;

function noop(): void {}

type VoiceActivity = 'idle' | 'speaking';
type HrTrend = 'up' | 'flat' | 'down';
type HrSample = { t: number; bpm: number };

export interface VoiceModeOverlayProps {
  visible: boolean;
  band: TargetBand;
  bpm: number | null;
  zone: ZoneNumber | null;
  elapsedSec: number;
  distanceM: number;
  paceSecPerKm: number | null;
  paused: boolean;
  lastSpoken: string | null;
  muted: boolean;
  isSpeaking: boolean;
  onExit: () => void;
  onToggleMute: () => void;
  onPause: () => void;
  onResume: () => void;
  /** Optional: end the run from the overlay (two-tap confirm). */
  onStop?: () => void;
  /** Optional: current cadence (spm) for the Pace ⇄ Cadence rail toggle. */
  cadenceSpm?: number | null;
  /** Optional: hard-reset the voice pipeline (stuck/silent audio recovery). */
  onResetVoice?: () => void;
  /** Optional override for the 30 s HR trend chevron; computed internally when omitted. */
  hrTrend?: HrTrend;
  /** Session phase; warm-up/recovery/done neutralise the band verdict. */
  phase?: SessionPhase;
}

export function VoiceModeOverlay(props: VoiceModeOverlayProps) {
  const insets = useSafeAreaInsets();
  const { band, bpm } = props;
  const phase = props.phase ?? 'steady';
  const offBand = phase === 'warmup' || phase === 'recover' || phase === 'done';
  const rawState = classifyBand(bpm, band);
  const state: BandState = offBand && rawState !== 'no_signal' ? 'in' : rawState;
  const color = STATE_COLOR[state];
  const urgent =
    state === 'above' && bpm !== null && bpm - band.ceiling > OVER_CEILING_URGENT_BPM;

  const activity: VoiceActivity = props.isSpeaking ? 'speaking' : 'idle';

  const { trend, samples } = useHrSamples(bpm, props.elapsedSec, props.hrTrend);
  const spokenAt = useSpokenAt(props.lastSpoken);
  const [showCadence, setShowCadence] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const stop = useConfirmStop(props.onStop ?? noop);

  const agoLabel = spokenAt === null ? null : formatAgo(Date.now() - spokenAt);
  const paceValue = props.paceSecPerKm ? formatPace(props.paceSecPerKm) : '--';
  const cadenceValue = props.cadenceSpm != null ? String(Math.round(props.cadenceSpm)) : '--';

  return (
    <Modal
      visible={props.visible}
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={props.onExit}
    >
      <View className="flex-1 bg-black">
        <BandField state={state} urgent={urgent} />

        <View
          className="flex-1 px-5"
          style={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 12 }}
        >
          {/* Zone 1 — status strip: microlabel · CoachChip · overflow + Exit */}
          <View className="flex-row items-center">
            <View className="flex-1">
              <Text
                className="text-[10px] font-bold uppercase"
                style={{ color: MUTED_TEXT, letterSpacing: 2 }}
              >
                Voice Mode{props.zone ? ` · Z${props.zone}` : ''}
              </Text>
            </View>
            <CoachChip activity={activity} />
            <View className="flex-1 flex-row items-center justify-end gap-2">
              <Pressable
                onPress={() => setMoreOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="More voice options"
                hitSlop={8}
                className="w-10 h-10 rounded-full items-center justify-center bg-bg-elevated"
              >
                <Ionicons name="ellipsis-horizontal" size={18} color={SECONDARY_TEXT} />
              </Pressable>
              <Pressable
                onPress={props.onExit}
                accessibilityRole="button"
                accessibilityLabel="Exit voice mode"
                hitSlop={8}
                className="flex-row items-center gap-1 px-3.5 h-10 rounded-full bg-bg-elevated"
              >
                <Ionicons name="close" size={16} color="#a3a3a3" />
                <Text className="text-text-secondary text-sm font-semibold">Exit</Text>
              </Pressable>
            </View>
          </View>

          {/* Zone 2 — hero cluster: HR + trend chevron, directive word, band gauge */}
          <View className="flex-1 items-center justify-center">
            <View className="items-center self-stretch">
              <View
                className="items-center justify-center self-stretch"
                accessibilityLabel={
                  bpm === null
                    ? 'No heart rate signal'
                    : `Heart rate ${bpm} beats per minute, trending ${trend}`
                }
                style={{ height: 150 }}
              >
                <PulseRing active={activity === 'speaking'} color={color} />
                <View className="flex-row items-center justify-center">
                  <Text
                    style={{
                      color,
                      fontSize: 112,
                      lineHeight: 118,
                      fontWeight: '800',
                      letterSpacing: -2,
                      fontVariant: ['tabular-nums'],
                    }}
                  >
                    {bpm ?? '--'}
                  </Text>
                  {bpm !== null ? <TrendChevron trend={trend} color={color} /> : null}
                </View>
              </View>
              <Text
                style={{ color, fontSize: 34, fontWeight: '800', letterSpacing: 3 }}
                className="mt-1"
              >
                {offBand && state !== 'no_signal' ? phaseWord(phase) : heroDirective(state, urgent)}
              </Text>
            </View>

            <BandGauge band={band} bpm={bpm} color={color} samples={samples} />
          </View>

          {/* Zone 3 — stat rail: Time · Distance · Pace (tap ⇄ Cadence) */}
          <View className="flex-row justify-around py-3 border-y border-bg-border/50">
            <RailStat label="Time" value={formatDuration(props.elapsedSec)} />
            <RailStat label="Distance" value={formatDistance(props.distanceM)} />
            <Pressable
              onPress={() => setShowCadence((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={showCadence ? 'Show pace' : 'Show cadence'}
              hitSlop={10}
            >
              <RailStat
                label={showCadence ? 'Cadence' : 'Pace'}
                value={showCadence ? cadenceValue : paceValue}
              />
            </Pressable>
          </View>

          {/* Zone 4 — coach surface: the last line the coach spoke */}
          <View className="mt-2 justify-center px-1" style={{ height: COACH_SURFACE_H }}>
            {props.lastSpoken ? (
              <>
                <Text style={{ color: OFF_WHITE, fontSize: 15, lineHeight: 20 }} numberOfLines={2}>
                  {props.lastSpoken}
                </Text>
                {agoLabel ? (
                  <Text className="text-[11px] mt-1" style={{ color: MUTED_TEXT }}>
                    {agoLabel}
                  </Text>
                ) : null}
              </>
            ) : (
              <Text style={{ color: MUTED_TEXT, fontSize: 13, lineHeight: 18 }} numberOfLines={2}>
                Just run. The coach calls out your heart rate.
              </Text>
            )}
          </View>

          {/* Zone 5 — control dock: Mute · Pause/Resume · Finish, big and centered for the thumb */}
          <View
            className="flex-row items-start justify-center pt-2"
            style={{ gap: props.onStop ? DOCK_GAP_THREE : DOCK_GAP_TWO }}
          >
            <DockButton
              icon={props.muted ? 'volume-mute' : 'volume-high'}
              label={props.muted ? 'Unmute coach voice' : 'Mute coach voice'}
              caption={props.muted ? 'Unmute' : 'Mute'}
              active={props.muted}
              tint="#f59e0b"
              onPress={props.onToggleMute}
            />
            <DockButton
              icon={props.paused ? 'play' : 'pause'}
              label={props.paused ? 'Resume run' : 'Pause run'}
              caption={props.paused ? 'Resume' : 'Pause'}
              active={props.paused}
              tint="#10b981"
              onPress={props.paused ? props.onResume : props.onPause}
            />
            {props.onStop ? (
              <DockButton
                icon="stop"
                label={stop.armed ? 'Tap again to finish the run' : 'Finish run'}
                caption={stop.armed ? 'Tap again' : 'Finish'}
                active={stop.armed}
                tint="#ef4444"
                onPress={stop.press}
              />
            ) : null}
          </View>
        </View>

        {/* "⋯" sheet — demoted controls: voice reset */}
        {moreOpen ? (
          <View style={StyleSheet.absoluteFillObject}>
            <Pressable
              className="flex-1"
              style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
              onPress={() => setMoreOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Close voice options"
            />
            <View
              className="rounded-t-3xl border-t border-bg-border px-5 pt-3"
              style={{ backgroundColor: '#0d0d0d', paddingBottom: insets.bottom + 16 }}
            >
              <View
                className="self-center w-9 h-1 rounded-full mb-3"
                style={{ backgroundColor: '#3f3f46' }}
              />
              {props.onResetVoice ? (
                <SheetRow
                  icon="refresh"
                  title="Reset voice"
                  value="Fix silent audio"
                  active={false}
                  onPress={() => {
                    setMoreOpen(false);
                    props.onResetVoice?.();
                  }}
                />
              ) : null}
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function phaseWord(phase: SessionPhase): string {
  switch (phase) {
    case 'warmup':
      return 'WARM-UP';
    case 'recover':
      return 'RECOVER';
    case 'done':
      return 'DONE';
    case 'work':
    case 'steady':
      return 'KEEP';
  }
}

/** UI directive per spec §8 — KEEP / LIFT / EASE / SETTLE, the only word on screen. */
function heroDirective(state: BandState, urgent: boolean): string {
  switch (state) {
    case 'in':
      return 'KEEP';
    case 'below':
      return 'LIFT';
    case 'above':
      return urgent ? 'SETTLE' : 'EASE';
    case 'no_signal':
    default:
      return 'NO SIGNAL';
  }
}


function formatAgo(ms: number): string {
  if (ms < 45_000) return 'just now';
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return `${minutes}m ago`;
}

/**
 * Timestamp of the most recent coach line. The initial value is skipped — a
 * line that predates the overlay has an unknown age, so no label is shown.
 */
function useSpokenAt(lastSpoken: string | null): number | null {
  const [spokenAt, setSpokenAt] = useState<number | null>(null);
  const seededRef = useRef(false);
  useEffect(() => {
    if (!seededRef.current) {
      seededRef.current = true;
      return;
    }
    setSpokenAt(lastSpoken === null ? null : Date.now());
  }, [lastSpoken]);
  return spokenAt;
}

/**
 * Rolling HR sample buffer fed by the bpm prop at ~1 Hz (elapsedSec dep keeps
 * sampling even when the bpm value itself is unchanged). Yields the 30 s trend
 * for the chevron and the 60 s series for the gauge sparkline.
 */
function useHrSamples(
  bpm: number | null,
  elapsedSec: number,
  override?: HrTrend
): { trend: HrTrend; samples: readonly HrSample[] } {
  const samplesRef = useRef<HrSample[]>([]);
  const [trend, setTrend] = useState<HrTrend>('flat');

  useEffect(() => {
    // elapsedSec ticks once a second and re-samples the (possibly unchanged) bpm.
    void elapsedSec;
    const now = Date.now();
    const samples = samplesRef.current;
    if (bpm !== null && Number.isFinite(bpm)) samples.push({ t: now, bpm });
    while (samples.length > 0) {
      const head = samples[0];
      if (head === undefined || now - head.t <= SPARK_WINDOW_MS) break;
      samples.shift();
    }

    const recent = samples.filter((s) => now - s.t <= TREND_WINDOW_MS);
    const first = recent[0];
    const last = recent[recent.length - 1];
    if (bpm === null || recent.length < 4 || first === undefined || last === undefined) {
      setTrend('flat');
      return;
    }
    const span = last.t - first.t;
    if (span < 15_000) {
      setTrend('flat');
      return;
    }
    const third = Math.max(1, Math.ceil(recent.length / 3));
    const mean = (xs: HrSample[]) => xs.reduce((acc, s) => acc + s.bpm, 0) / xs.length;
    const delta = mean(recent.slice(-third)) - mean(recent.slice(0, third));
    const per30s = delta * (TREND_WINDOW_MS / span);
    setTrend(
      per30s >= TREND_THRESHOLD_BPM ? 'up' : per30s <= -TREND_THRESHOLD_BPM ? 'down' : 'flat'
    );
  }, [bpm, elapsedSec]);

  return { trend: override ?? trend, samples: samplesRef.current };
}

const TrendChevron = memo(function TrendChevron({ trend, color }: { trend: HrTrend; color: string }) {
  const icon: keyof typeof Ionicons.glyphMap =
    trend === 'up' ? 'arrow-up' : trend === 'down' ? 'arrow-down' : 'arrow-forward';
  return (
    <Ionicons
      name={icon}
      size={32}
      color={color}
      style={{ marginLeft: 6, opacity: 0.9 }}
      accessibilityLabel={`Heart rate trend ${trend}`}
    />
  );
});

/**
 * Layer 0 — full-screen band-state wash rising from the bottom, fading out by
 * mid-screen. Crossfades 600 ms between states; `above` breathes on a 4 s
 * cycle; urgent lifts the wash from ~12% to ~20%. Memoized: its four
 * full-screen SVG gradients only change with the band state, not at 1 Hz.
 */
const BandField = memo(function BandField({ state, urgent }: { state: BandState; urgent: boolean }) {
  const reduceMotion = useReducedMotion();
  const wash = useSharedValue(WASH_BASE);

  useEffect(() => {
    cancelAnimation(wash);
    const base = urgent ? WASH_URGENT : WASH_BASE;
    if (state === 'above' && !reduceMotion) {
      wash.value = withSequence(
        withTiming(base, { duration: 600, easing: Easing.inOut(Easing.ease) }),
        withRepeat(
          withSequence(
            withTiming(base * 0.55, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
            withTiming(base, { duration: 2000, easing: Easing.inOut(Easing.ease) })
          ),
          -1,
          false
        )
      );
    } else {
      wash.value = withTiming(base, { duration: 600, easing: Easing.inOut(Easing.ease) });
    }
    return () => cancelAnimation(wash);
  }, [state, urgent, reduceMotion, wash]);

  const style = useAnimatedStyle(() => ({ opacity: wash.value }));

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, style]}>
      {(Object.keys(STATE_COLOR) as BandState[]).map((s) => (
        <FieldLayer key={s} id={s} color={STATE_COLOR[s]} active={s === state} />
      ))}
    </Animated.View>
  );
});

const FieldLayer = memo(function FieldLayer({ id, color, active }: { id: string; color: string; active: boolean }) {
  const opacity = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    opacity.value = withTiming(active ? 1 : 0, {
      duration: 600,
      easing: Easing.inOut(Easing.ease),
    });
  }, [active, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const gradientId = `vm-field-${id}`;

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, style]}>
      <Svg width="100%" height="100%" viewBox="0 0 1 1" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.45" stopColor={color} stopOpacity="0" />
            <Stop offset="1" stopColor={color} stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="1" height="1" fill={`url(#${gradientId})`} />
      </Svg>
    </Animated.View>
  );
});

/** Zone 1 CoachChip — the single authoritative speaking indicator. */
const CoachChip = memo(function CoachChip({ activity }: { activity: VoiceActivity }) {
  const tint = activity === 'speaking' ? '#10b981' : '#52525b';
  return (
    <View
      accessibilityLabel={`Coach ${activity === 'idle' ? 'ready' : activity}`}
      className="flex-row items-center rounded-full border px-3.5"
      style={{ height: 36, gap: 8, backgroundColor: '#0d0d0d', borderColor: '#242424' }}
    >
      <Text style={{ color: OFF_WHITE, fontSize: 13, fontWeight: '600' }}>{COACH_NAME}</Text>
      {activity === 'speaking' ? (
        <Waveform color={tint} />
      ) : (
        <StatusDot color={tint} />
      )}
    </View>
  );
});

const PulseRing = memo(function PulseRing({ active, color }: { active: boolean; color: string }) {
  const reduceMotion = useReducedMotion();
  const p = useSharedValue(0);
  useEffect(() => {
    if (active && !reduceMotion) {
      p.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.ease) }), -1, false);
    } else {
      cancelAnimation(p);
      p.value = withTiming(0, { duration: 200 });
    }
    return () => cancelAnimation(p);
  }, [active, reduceMotion, p]);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + p.value * 0.3 }],
    opacity: 0.5 * (1 - p.value),
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          alignSelf: 'center',
          width: 200,
          height: 200,
          borderRadius: 100,
          borderWidth: 3,
          borderColor: color,
        },
        style,
      ]}
    />
  );
});

function StatusDot({ color }: { color: string }) {
  return <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />;
}

function Waveform({ color }: { color: string }) {
  return (
    <View className="flex-row items-center" style={{ gap: 3, height: 18 }}>
      {[0, 1, 2, 3].map((i) => (
        <WaveBar key={i} color={color} delay={i * 120} />
      ))}
    </View>
  );
}

function WaveBar({ color, delay }: { color: string; delay: number }) {
  const reduceMotion = useReducedMotion();
  const h = useSharedValue(0.35);
  useEffect(() => {
    if (reduceMotion) {
      h.value = 0.7;
      return;
    }
    h.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 320, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.35, { duration: 320, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        true
      )
    );
    return () => cancelAnimation(h);
  }, [delay, reduceMotion, h]);
  const style = useAnimatedStyle(() => ({ height: 4 + h.value * 14 }));
  return <Animated.View style={[{ width: 4, borderRadius: 2, backgroundColor: color }, style]} />;
}

/**
 * BandGauge v2 — 16 pt track, band region filled at 33% state color, 18 pt
 * marker with black ring, ghosted 60 s HR sparkline inside the track.
 */
function BandGauge({
  band,
  bpm,
  color,
  samples,
}: {
  band: TargetBand;
  bpm: number | null;
  color: string;
  samples: readonly HrSample[];
}) {
  const [trackW, setTrackW] = useState(0);
  const lo = band.floor - 12;
  const hi = band.ceiling + 12;
  const span = Math.max(1, hi - lo);
  const frac = (v: number) => Math.min(1, Math.max(0, (v - lo) / span));
  const bandLeft = frac(band.floor) * 100;
  const bandWidth = (frac(band.ceiling) - frac(band.floor)) * 100;
  const markerX = bpm === null || trackW === 0 ? null : frac(bpm) * trackW;

  const now = Date.now();
  const sparkPoints =
    trackW > 0 && samples.length >= 2
      ? samples
          .map((s) => {
            const x = Math.min(
              trackW,
              Math.max(0, ((s.t - (now - SPARK_WINDOW_MS)) / SPARK_WINDOW_MS) * trackW)
            );
            const y = GAUGE_TRACK_H - 2 - frac(s.bpm) * (GAUGE_TRACK_H - 4);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(' ')
      : null;

  return (
    <View className="w-full mt-7 px-2">
      <View
        onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
        style={{
          height: GAUGE_TRACK_H,
          borderRadius: GAUGE_TRACK_H / 2,
          backgroundColor: '#17171a',
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            position: 'absolute',
            left: `${bandLeft}%`,
            width: `${bandWidth}%`,
            top: 0,
            bottom: 0,
            backgroundColor: `${color}54`,
          }}
        />
        {sparkPoints ? (
          <Svg width={trackW} height={GAUGE_TRACK_H} style={StyleSheet.absoluteFillObject}>
            <Polyline
              points={sparkPoints}
              fill="none"
              stroke={OFF_WHITE}
              strokeOpacity={0.2}
              strokeWidth={1.5}
            />
          </Svg>
        ) : null}
      </View>
      {markerX !== null ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 8 + markerX - GAUGE_MARKER / 2,
            top: (GAUGE_TRACK_H - GAUGE_MARKER) / 2,
            width: GAUGE_MARKER,
            height: GAUGE_MARKER,
            borderRadius: GAUGE_MARKER / 2,
            backgroundColor: color,
            borderWidth: 2,
            borderColor: '#000',
          }}
        />
      ) : null}
      <View className="flex-row justify-between mt-1.5">
        <Text className="text-text-muted text-[10px]">{lo}</Text>
        <Text className="text-text-muted text-[10px]">
          {band.floor}-{band.ceiling}
        </Text>
        <Text className="text-text-muted text-[10px]">{hi}</Text>
      </View>
    </View>
  );
}

const RailStat = memo(function RailStat({ label, value }: { label: string; value: string }) {
  return (
    <View className="items-center">
      <Text
        style={{ color: OFF_WHITE, fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] }}
      >
        {value}
      </Text>
      <Text
        className="text-[10px] uppercase mt-0.5"
        style={{ color: MUTED_TEXT, letterSpacing: 1.2 }}
      >
        {label}
      </Text>
    </View>
  );
});

const DockButton = memo(function DockButton({
  icon,
  label,
  caption,
  active,
  tint,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  caption: string;
  active: boolean;
  tint: string;
  onPress: () => void;
}) {
  return (
    <View className="items-center" style={{ gap: 6 }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: active }}
        hitSlop={10}
        className="items-center justify-center active:opacity-80"
        style={{
          width: DOCK_BUTTON_SIZE,
          height: DOCK_BUTTON_SIZE,
          borderRadius: DOCK_BUTTON_SIZE / 2,
          borderWidth: 1.5,
          borderColor: active ? `${tint}88` : '#2e2e33',
          backgroundColor: active ? `${tint}26` : '#0d0d0d',
        }}
      >
        <Ionicons name={icon} size={34} color={active ? tint : OFF_WHITE} />
      </Pressable>
      <Text
        className="text-[11px] font-semibold uppercase"
        style={{ color: active ? tint : MUTED_TEXT, letterSpacing: 1.2 }}
      >
        {caption}
      </Text>
    </View>
  );
});

function SheetRow({
  icon,
  title,
  value,
  active,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  value: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ selected: active }}
      className="flex-row items-center py-2 active:opacity-80"
      style={{ minHeight: 56, gap: 12 }}
    >
      <View
        className="items-center justify-center"
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: active ? '#10b9811f' : '#161616',
        }}
      >
        <Ionicons name={icon} size={18} color={active ? '#10b981' : SECONDARY_TEXT} />
      </View>
      <Text className="flex-1 text-[15px] font-semibold" style={{ color: OFF_WHITE }}>
        {title}
      </Text>
      <Text
        className="text-[13px] font-semibold"
        style={{ color: active ? '#10b981' : MUTED_TEXT }}
        numberOfLines={1}
      >
        {value}
      </Text>
    </Pressable>
  );
}
