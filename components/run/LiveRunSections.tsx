// SPDX-License-Identifier: GPL-3.0-or-later

import { memo, type RefObject } from 'react';
import { View } from 'react-native';

import {
  evaluateLiveGuardrails,
  type LiveGuardrail,
  type LiveGuardrailSample,
} from '@/lib/coach/guardrails';
import { sessionPhaseAt } from '@/lib/coach/voiceMode';
import { useZones } from '@/lib/hooks/useZones';
import { useActiveRunStore } from '@/lib/run/store';
import { useLiveCadenceStore } from '@/lib/sensors/cadence';
import type { CoachCue, CoachVerbosity } from '@/types';

import { HRDisplay } from './HRDisplay';
import { IntervalProgress } from './IntervalProgress';
import { LiveCoachPanel, type CoachDisplayCue } from './LiveCoachPanel';
import { useElapsedSec } from './liveRunHooks';
import { StatRow } from './StatRow';
import {
  VoiceModeOverlay,
  type VoiceModeOverlayProps,
} from './VoiceModeOverlay';
import { ZoneBar } from './ZoneBar';

/**
 * Leaf sections of the live run screen. Each one subscribes to exactly the
 * fast-changing store slices it paints (current HR, distance/pace, the shared
 * 1 Hz clock), so a new HR sample or GPS fix repaints a few small views
 * instead of re-rendering the whole run screen.
 */

/** Big HR number + zone bar. Repaints on current_bpm only. */
export const LiveHeartRate = memo(function LiveHeartRate() {
  const bpm = useActiveRunStore((s) => s.current_bpm);
  const zonesView = useZones();
  return (
    <View className="gap-2">
      <HRDisplay
        bpm={bpm}
        zone={zonesView.classify(bpm)}
        hint={zonesView.boundaryHint(bpm)}
      />
      <ZoneBar zones={zonesView.zones} bpm={bpm} />
    </View>
  );
});

interface LiveCoachSectionProps {
  lastCoachCue: CoachCue | null;
  /** Rolling guardrail window, owned by the run screen's HR handler. */
  guardrailSamplesRef: RefObject<LiveGuardrailSample[]>;
  strapConnected: boolean;
  verbosity: CoachVerbosity;
  onVerbosityChange: (value: CoachVerbosity) => void;
}

/** Coach panel with the live guardrail fallback, refreshed at 1 Hz. */
export const LiveCoachSection = memo(function LiveCoachSection({
  lastCoachCue,
  guardrailSamplesRef,
  strapConnected,
  verbosity,
  onVerbosityChange,
}: LiveCoachSectionProps) {
  const status = useActiveRunStore((s) => s.status);
  const session = useActiveRunStore((s) => s.session);
  // Repaint as soon as a sample lands in the guardrail window, not only on
  // the next clock tick.
  useActiveRunStore((s) => s.hr_count);
  const elapsedSec = useElapsedSec();
  const zonesView = useZones();

  const elapsedMs = elapsedSec * 1000;
  const sessionPhase = sessionPhaseAt(session, elapsedMs);
  // No above/below verdicts while warming up or recovering between reps.
  const liveGuardrail =
    sessionPhase === 'warmup' || sessionPhase === 'recover' || sessionPhase === 'done'
      ? null
      : evaluateLiveGuardrails({
          samples: guardrailSamplesRef.current ?? [],
          zones: zonesView.zones,
          elapsedMs,
          targetZone: session?.target_zone ?? 2,
        })[0] ?? null;
  const fallbackCue = liveGuardrail ? displayCueFromGuardrail(liveGuardrail) : null;
  const visibleCoachCue =
    lastCoachCue && Date.now() - lastCoachCue.timestamp <= 90_000
      ? lastCoachCue
      : null;

  return (
    <LiveCoachPanel
      cue={visibleCoachCue}
      fallback={fallbackCue}
      status={status}
      strapConnected={strapConnected}
      verbosity={verbosity}
      onVerbosityChange={onVerbosityChange}
      compact
    />
  );
});

/** Interval rep/recovery progress for interval sessions, refreshed at 1 Hz. */
export const LiveIntervalSection = memo(function LiveIntervalSection() {
  const session = useActiveRunStore((s) => s.session);
  const elapsedSec = useElapsedSec();
  if (!session?.intervals) return null;
  return (
    <IntervalProgress
      intervals={session.intervals}
      runElapsedMs={elapsedSec * 1000}
      warmupMs={session.warmup_sec !== undefined ? session.warmup_sec * 1000 : undefined}
    />
  );
});

interface LiveStatsSectionProps {
  cadenceTarget: number;
  cadenceTargetLabel?: string;
}

/** Pace / distance / cadence / time. Repaints on GPS pushes and the 1 Hz clock. */
export const LiveStatsSection = memo(function LiveStatsSection({
  cadenceTarget,
  cadenceTargetLabel,
}: LiveStatsSectionProps) {
  const distanceM = useActiveRunStore((s) => s.distance_m);
  const paceSecPerKm = useActiveRunStore((s) => s.current_pace_sec_per_km);
  const cadenceSpm = useLiveCadenceStore((s) => s.spm);
  const elapsedSec = useElapsedSec();
  return (
    <StatRow
      elapsedSec={elapsedSec}
      distanceM={distanceM}
      paceSecPerKm={paceSecPerKm}
      cadenceSpm={cadenceSpm}
      cadenceTarget={cadenceTarget}
      cadenceTargetLabel={cadenceTargetLabel}
    />
  );
});

export type LiveVoiceModeOverlayProps = Omit<
  VoiceModeOverlayProps,
  'bpm' | 'zone' | 'elapsedSec' | 'distanceM' | 'paceSecPerKm' | 'phase' | 'cadenceSpm'
>;

/**
 * Feeds the Voice Mode overlay its live values (HR, zone, time, distance,
 * pace, session phase) straight from the store + 1 Hz clock, so its repaints
 * stay inside the overlay.
 */
export const LiveVoiceModeOverlay = memo(function LiveVoiceModeOverlay(
  props: LiveVoiceModeOverlayProps
) {
  // Hidden most of the run: mount the live subscriptions only while shown,
  // so the closed overlay stops repainting every second.
  if (!props.visible) return null;
  return <LiveVoiceModeOverlayContent {...props} />;
});

function LiveVoiceModeOverlayContent(props: LiveVoiceModeOverlayProps) {
  const bpm = useActiveRunStore((s) => s.current_bpm);
  const distanceM = useActiveRunStore((s) => s.distance_m);
  const paceSecPerKm = useActiveRunStore((s) => s.current_pace_sec_per_km);
  const session = useActiveRunStore((s) => s.session);
  const cadenceSpm = useLiveCadenceStore((s) => s.spm);
  const elapsedSec = useElapsedSec();
  const zonesView = useZones();
  return (
    <VoiceModeOverlay
      {...props}
      cadenceSpm={cadenceSpm}
      bpm={bpm}
      zone={zonesView.classify(bpm)}
      elapsedSec={elapsedSec}
      distanceM={distanceM}
      paceSecPerKm={paceSecPerKm}
      phase={sessionPhaseAt(session, elapsedSec * 1000)}
    />
  );
}

function displayCueFromGuardrail(guardrail: LiveGuardrail): CoachDisplayCue {
  switch (guardrail.kind) {
    case 'walk_recovery':
      return {
        action: 'Rest',
        detail: guardrail.message,
        intent: 'urgent',
      };
    case 'early_too_fast':
    case 'drift':
      return {
        action: 'Slow down',
        detail: guardrail.message,
        intent: 'slower',
      };
    case 'maf_buffer':
      return {
        action: 'Ease back',
        detail: guardrail.message,
        intent: 'slower',
      };
    case 'zone_eta':
      return {
        action: 'Hold steady',
        detail: guardrail.message,
        intent: 'steady',
      };
  }
}
