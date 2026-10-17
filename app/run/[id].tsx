// SPDX-License-Identifier: GPL-3.0-or-later

import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, Text, View } from 'react-native';

import { DecouplingCard } from '@/components/history/DecouplingCard';
import { ElevationProfileChart } from '@/components/history/ElevationProfileChart';
import { ElevationSummaryCard } from '@/components/history/ElevationSummaryCard';
import { HRTimeChart } from '@/components/history/HRTimeChart';
import { RunMap } from '@/components/history/RunMap';
import { SplitsTable } from '@/components/history/SplitsTable';
import { TerrainRunChart } from '@/components/history/TerrainRunChart';
import { ZoneDistributionBar } from '@/components/history/ZoneDistributionBar';
import { ZonePieChart } from '@/components/history/ZonePieChart';
import {
  isEmptyRunNotes,
  NotesEditor,
  NotesSummary,
  parseRunNotes,
  serializeRunNotes,
} from '@/components/run/NotesEditor';
import { MafPaceMiniTrend } from '@/components/run/MafPaceMiniTrend';
import { RunContextEditor } from '@/components/run/RunContextEditor';
import { RunInsights } from '@/components/run/RunInsights';
import { correctRunElevation } from '@/lib/elevation/correct';
import { gpxFilename, runToGpx } from '@/lib/export/gpx';
import { buildRunExport, runExportFilename } from '@/lib/export/runExport';
import { shareTextFile } from '@/lib/export/share';
import { resolveDecoupling } from '@/lib/run/recomputeDecoupling';
import { runTypeLabel } from '@/lib/run/runTypes';
import { computeElevationStats, elevationPerSplit } from '@/lib/metrics/elevation';
import { INJURY_RISK_LOOKBACK_MS, injuryRiskWarnings } from '@/lib/metrics/injuryRisk';
import { summarizeTerrainForDisplay } from '@/lib/metrics/terrain';
import { aggregateZoneDistribution } from '@/lib/metrics/zones';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Pill';
import { Screen } from '@/components/ui/Screen';
import {
  deleteRun,
  getCadenceSamples,
  getGpsPoints,
  getHRSamples,
  getRoute,
  getRun,
  getRunsBefore,
  getRunsSince,
  updateRunContext,
} from '@/lib/storage/db';
import { updateRunNotes } from '@/lib/storage/notes';
import { useProfileStore } from '@/lib/storage/profile';
import { formatDistance, formatDuration, formatPace } from '@/lib/time';
import { OpenMeteoCredit } from '@/components/ui/OpenMeteoCredit';
import { weatherLabel } from '@/lib/run/weather';
import { runAfterTransition, type TransitionEvents } from '@/lib/run/afterTransition';
import {
  normalizeRunId,
  preserveUnchanged,
  shouldRenderRouteMap,
  validRoutePoints,
} from '@/lib/run/detail';
import type {
  CadenceSampleRecord,
  CompletedRun,
  ElevationStats,
  GpsPointRecord,
  HRSampleRecord,
  RunContext,
  RunNotes,
} from '@/types';

// The run report and MAF trend derive everything from their props; memoising
// them here keeps editor keystrokes from re-running runReport on every render.
const MemoRunInsights = memo(RunInsights);
const MemoMafPaceMiniTrend = memo(MafPaceMiniTrend);

function formatLongDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

const PREVIOUS_RUNS_SHOWN = 3;

interface RunDetailData {
  run: CompletedRun | null;
  hr: HRSampleRecord[];
  gps: GpsPointRecord[];
  cadence: CadenceSampleRecord[];
  previousRuns: CompletedRun[];
  /** Every run injuryRiskWarnings can look at for this run (see INJURY_RISK_LOOKBACK_MS). */
  riskRuns: CompletedRun[];
}

/** All the SQLite reads the detail screen needs, done once per run id. */
function loadRunDetail(runId: string): RunDetailData {
  const run = getRun(runId);
  if (!run) return { run, hr: [], gps: [], cadence: [], previousRuns: [], riskRuns: [] };
  return {
    run,
    hr: getHRSamples(runId),
    gps: validRoutePoints(getGpsPoints(runId)),
    cadence: getCadenceSamples(runId),
    previousRuns: getRunsBefore(run.started_at, PREVIOUS_RUNS_SHOWN),
    riskRuns: getRunsSince(run.ended_at - INJURY_RISK_LOOKBACK_MS),
  };
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export default function RunDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const runId = normalizeRunId(id);
  const router = useRouter();
  const navigation = useNavigation();
  const profile = useProfileStore((s) => s.profile);

  const [run, setRun] = useState<CompletedRun | null>(null);
  const [hr, setHR] = useState<HRSampleRecord[]>([]);
  const [gps, setGPS] = useState<GpsPointRecord[]>([]);
  const [cadence, setCadence] = useState<CadenceSampleRecord[]>([]);
  const [previousRuns, setPreviousRuns] = useState<CompletedRun[]>([]);
  const [notesEditing, setNotesEditing] = useState(false);
  const [notesDraft, setNotesDraft] = useState<RunNotes>({});
  const [contextEditing, setContextEditing] = useState(false);
  const [contextDraft, setContextDraft] = useState<RunContext>({});
  const [preRunExpanded, setPreRunExpanded] = useState(false);
  const [elevation, setElevation] = useState<ElevationStats | null>(null);
  const [refiningElevation, setRefiningElevation] = useState(false);
  const [riskRuns, setRiskRuns] = useState<CompletedRun[]>([]);
  const [loadedRunId, setLoadedRunId] = useState<string | null>(null);

  // Load once per run id. Nothing can edit this run while the screen sits
  // under another one (it pushes no screens; edits happen inline and re-read
  // the run), so refocusing does not reload. The synchronous SQLite reads and
  // derivations wait for the push transition to end so it starts from a light
  // placeholder instead of blocking on the JS thread.
  useEffect(() => {
    setRun(null);
    setHR([]);
    setGPS([]);
    setCadence([]);
    setPreviousRuns([]);
    setRiskRuns([]);
    setNotesEditing(false);
    setNotesDraft({});
    setContextEditing(false);
    setContextDraft({});
    setPreRunExpanded(false);
    setElevation(null);
    setRefiningElevation(false);
    setLoadedRunId(null);
    if (!runId) return;

    let isActive = true;
    // `transitionEnd` is a native-stack event the generic navigation type
    // does not list.
    const transitionEvents: TransitionEvents = {
      addListener: (event, callback) => navigation.addListener(event as never, callback),
    };
    const cancelLoad = runAfterTransition(transitionEvents, () => {
      if (!isActive) return;
      const detail = loadRunDetail(runId);
      setRun(detail.run);
      setHR(detail.hr);
      setGPS(detail.gps);
      setCadence(detail.cadence);
      setPreviousRuns(detail.previousRuns);
      setRiskRuns(detail.riskRuns);
      setLoadedRunId(runId);
      if (!detail.run || detail.gps.length < 2) return;

      // Always-cloud-corrected elevation, attempted once per load: show the
      // stored or instant GPS-only estimate, then (unless the stored summary
      // is already DEM-corrected) fire the cloud correction and swap in the
      // corrected stats when it resolves. `isActive` guards against setState
      // after unmount or after the run id changes mid-flight.
      const stored = detail.run.elevation;
      if (stored && stored.corrected) {
        setElevation(stored);
        return;
      }
      setElevation(stored ?? computeElevationStats(detail.gps));
      setRefiningElevation(true);
      correctRunElevation(runId)
        .then((corrected) => {
          if (!isActive || !corrected) return;
          setElevation(corrected);
          // Reload the persisted run so the corrected elevation AND the
          // chained recomputes (GAP, per-split GAP, profile fit) all render.
          setRun((r) =>
            r ? preserveUnchanged(r, getRun(r.id) ?? { ...r, elevation: corrected }) : r
          );
          // Refresh the GPS array so the elevation profile chart plots the
          // backfilled DEM ground elevation instead of stale raw GPS altitude.
          setGPS(validRoutePoints(getGpsPoints(runId)));
        })
        .catch(() => {
          // correctRunElevation degrades gracefully; nothing actionable here.
        })
        .finally(() => {
          if (isActive) setRefiningElevation(false);
        });
    });

    return () => {
      isActive = false;
      cancelLoad();
    };
  }, [navigation, runId]);

  const onEditNotes = useCallback(() => {
    setNotesDraft(parseRunNotes(run?.notes) ?? {});
    setNotesEditing(true);
  }, [run?.notes]);

  const onCancelNotes = useCallback(() => {
    setNotesEditing(false);
    setNotesDraft({});
  }, []);

  const onSaveNotes = useCallback(() => {
    if (!runId) return;
    const serialized = serializeRunNotes(notesDraft);
    if (serialized !== null) {
      updateRunNotes(runId, serialized);
    } else if (run?.notes) {
      updateRunNotes(runId, null);
    }
    setRun((prev) => preserveUnchanged(prev, getRun(runId)));
    setNotesEditing(false);
    setNotesDraft({});
  }, [notesDraft, run?.notes, runId]);

  const onEditContext = useCallback(() => {
    setContextDraft(run?.context ?? {});
    setContextEditing(true);
  }, [run?.context]);

  const onSaveContext = useCallback(() => {
    if (!runId) return;
    updateRunContext(runId, normalizeRunContext(contextDraft) ?? null);
    setRun((prev) => preserveUnchanged(prev, getRun(runId)));
    setContextEditing(false);
  }, [contextDraft, runId]);

  const onCancelContext = useCallback(() => {
    setContextDraft({});
    setContextEditing(false);
  }, []);

  const onExportGpx = useCallback(async () => {
    if (!run || gps.length < 2) return;
    try {
      await shareTextFile({
        filename: gpxFilename(run),
        contents: runToGpx(run, gps),
        mimeType: 'application/gpx+xml',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not export GPX.';
      Alert.alert('Export failed', message);
    }
  }, [gps, run]);

  const onExportJson = useCallback(async () => {
    if (!runId) return;
    try {
      const payload = buildRunExport({
        run_id: runId,
        getRun,
        getGpsPoints,
        getHRSamples,
        getCadenceSamples,
        getRoute,
      });
      if (!payload) {
        Alert.alert('Export failed', 'Run not found.');
        return;
      }
      await shareTextFile({
        filename: runExportFilename(payload.run),
        contents: JSON.stringify(payload, null, 2),
        mimeType: 'application/json',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not export JSON.';
      Alert.alert('Export failed', message);
    }
  }, [runId]);

  const onDelete = useCallback(() => {
    if (!runId) return;
    Alert.alert('Delete run?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteRun(runId);
          router.back();
        },
      },
    ]);
  }, [router, runId]);

  // Everything below derives from the loaded run + samples. It used to be
  // recomputed (with four DB reads) on every render, i.e. on every keystroke
  // in the notes/context editors, so it is memoised on its inputs. Re-reads
  // of `run` go through preserveUnchanged, so memos keyed on single fields
  // only recompute when that field actually changed (a notes save does not
  // re-aggregate zones or re-run the risk rules).
  const runPauses = run?.pause_intervals;
  const runSplits = run?.splits;
  const runContext = run?.context;
  const runEndedAt = run?.ended_at;
  const runRouteId = run?.route_id;
  const currentZones = useMemo(
    () => (hr.length > 1 ? aggregateZoneDistribution(hr, profile.zones, runPauses ?? []) : null),
    [hr, profile.zones, runPauses]
  );
  const runWithCurrentZones = useMemo<CompletedRun | null>(
    () =>
      run ? { ...run, zone_distribution: currentZones ?? run.zone_distribution } : null,
    [run, currentZones]
  );
  const riskWarnings = useMemo(
    () =>
      runId && runEndedAt !== undefined
        ? injuryRiskWarnings({
            // riskRuns was read at load; only this run's context can have
            // been edited since, so splice the live value in.
            runs: riskRuns.map((r) => (r.id === runId ? { ...r, context: runContext } : r)),
            // Anchor the rolling windows at THIS run — a two-month-old detail page
            // must not show warnings about the current week's mileage.
            now: runEndedAt,
          })
        : [],
    [riskRuns, runId, runContext, runEndedAt]
  );
  const route = useMemo(() => (runRouteId ? getRoute(runRouteId) : null), [runRouteId]);
  const terrainSummary = useMemo(() => summarizeTerrainForDisplay(gps, hr), [gps, hr]);
  // Merge per-km elevation gain/loss into the splits for the table. Uses the
  // (possibly DEM-corrected) GPS track so the elevation column tracks the
  // refined summary above.
  const splitsWithElevation = useMemo(
    () => (runSplits ? enrichSplitsWithElevation(runSplits, gps) : []),
    [runSplits, gps]
  );
  const savedNotes = useMemo(() => parseRunNotes(run?.notes), [run?.notes]);
  const decoupling = useMemo(
    () => (run && hr.length > 0 && gps.length > 0 ? resolveDecoupling(run, hr, gps) : null),
    [run, hr, gps]
  );

  if (runId && loadedRunId !== runId) {
    return (
      <Screen noBottomInset={false}>
        <View className="flex-row items-center justify-between mb-2">
          <Pressable
            onPress={() => router.back()}
            className="h-14 w-14 -ml-3 items-center justify-center"
          >
            <Text className="text-text-primary text-2xl">‹</Text>
          </Pressable>
        </View>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="small" color="#737373" />
        </View>
      </Screen>
    );
  }

  if (!run) {
    return (
      <Screen noBottomInset={false}>
        <View className="flex-1 items-center justify-center">
          <Text className="text-text-secondary">Run not found</Text>
          <View className="h-4" />
          <Button title="Back" onPress={() => router.back()} variant="secondary" />
        </View>
      </Screen>
    );
  }

  const currentZoneDistribution = runWithCurrentZones?.zone_distribution ?? run.zone_distribution;
  const canRenderRouteMap = shouldRenderRouteMap({
    platformOS: Platform.OS,
    gpsPointCount: gps.length,
  });

  return (
    <Screen scroll noBottomInset={false}>

      <View className="flex-row items-center justify-between mb-2">
        <Pressable
          onPress={() => router.back()}
          className="h-14 w-14 -ml-3 items-center justify-center"
        >
          <Text className="text-text-primary text-2xl">‹</Text>
        </Pressable>
        <Text className="text-text-secondary text-xs">{formatTime(run.started_at)}</Text>
      </View>

      <View className="mb-4">
        <Text className="text-text-primary text-2xl font-bold">
          {runTypeLabel(run.type)}
        </Text>
        <Text className="text-text-secondary text-sm mt-1">
          {formatLongDate(run.started_at)}
        </Text>
        <View className="flex-row mt-3" style={{ gap: 8 }}>
          <Pill label={runTypeLabel(run.type)} />
          {run.maf_pace_sec_per_km !== null ? <Pill label="MAF" /> : null}
          {route ? <Pill label={route.name} /> : null}
        </View>
      </View>

      <Card className="mb-4 p-3">
        <View className="flex-row flex-wrap" style={{ rowGap: 12 }}>
          <DetailMetric
            className="w-1/2"
            label="Duration"
            value={formatDuration(run.duration_sec)}
          />
          <DetailMetric
            className="w-1/2"
            label="Distance"
            value={formatDistance(run.distance_m)}
          />
          <DetailMetric
            className="w-1/2"
            label="Avg Pace"
            value={formatPace(run.avg_pace_sec_per_km)}
          />
          <DetailMetric
            className="w-1/2"
            label="GAP"
            value={run.avg_gap_sec_per_km ? formatPace(run.avg_gap_sec_per_km) : '--:--'}
            sublabel={formatGapDelta(run)}
            valueClassName="text-zone-z2"
          />
          <DetailMetric
            className="w-1/2"
            label="MAF Pace"
            value={
              run.maf_pace_sec_per_km !== null ? formatPace(run.maf_pace_sec_per_km) : '--:--'
            }
            valueClassName="text-zone-z2"
          />
          <DetailMetric
            className="w-1/2"
            label="MAF GAP"
            value={
              run.maf_gap_pace_sec_per_km !== null && run.maf_gap_pace_sec_per_km !== undefined
                ? formatPace(run.maf_gap_pace_sec_per_km)
                : '--:--'
            }
            valueClassName="text-zone-z2"
          />
          <DetailMetric
            className="w-1/2"
            label="Avg HR"
            value={run.avg_hr > 0 ? `${run.avg_hr}` : '--'}
            sublabel="bpm"
          />
          <DetailMetric
            className="w-1/2"
            label="Max HR"
            value={run.max_hr > 0 ? `${run.max_hr}` : '--'}
            sublabel="bpm"
          />
          <DetailMetric
            className="w-1/2"
            label="Elev"
            value={`+${Math.round(elevation?.total_gain_m ?? run.ascent_m ?? 0)}m`}
            sublabel={`-${Math.round(elevation?.total_loss_m ?? run.descent_m ?? 0)}m`}
          />
          <DetailMetric
            className="w-1/2"
            label="Weather"
            value={weatherLabel(run.weather)}
          />
        </View>
        {run.weather?.source === 'open-meteo' ? <OpenMeteoCredit className="mt-2" /> : null}
      </Card>

      <View className="mb-4">
        <MemoRunInsights run={runWithCurrentZones ?? run} zones={profile.zones} samples={hr} />
      </View>

      {riskWarnings.length > 0 ? (
        <View className="mb-4">
          <Text className="text-text-muted text-xs uppercase tracking-wider mb-2">
            Injury risk
          </Text>
          <View className="gap-3">
            {riskWarnings.map((warning) => (
              <Card key={warning.id} className={`p-3 ${riskBorderClass(warning.severity)}`}>
                <Text className="text-text-primary text-base font-semibold">
                  {warning.title}
                </Text>
                <Text className="text-text-secondary text-sm mt-1">
                  {warning.detail}
                </Text>
              </Card>
            ))}
          </View>
        </View>
      ) : null}

      <View className="mb-4">
        <Text className="text-text-muted text-xs uppercase tracking-wider mb-2">
          Surface and fuel
        </Text>
        {contextEditing ? (
          <View className="gap-3">
            <RunContextEditor value={contextDraft} onChange={setContextDraft} />
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Button title="Save" onPress={onSaveContext} variant="primary" size="md" />
              </View>
              <View className="flex-1">
                <Button title="Cancel" onPress={onCancelContext} variant="secondary" size="md" />
              </View>
            </View>
          </View>
        ) : (
          <Card className="p-3">
            <RunContextSummary context={run.context} />
            <View className="mt-3">
              <Button
                title={run.context ? 'Edit context' : 'Add context'}
                onPress={onEditContext}
                variant="secondary"
                size="md"
              />
            </View>
          </Card>
        )}
      </View>

      <View className="mb-4">
        <Text className="text-text-muted text-xs uppercase tracking-wider mb-2">
          Notes
        </Text>
        {notesEditing ? (
          <NotesEditor
            value={notesDraft}
            onChange={setNotesDraft}
            onSave={onSaveNotes}
            onCancel={onCancelNotes}
          />
        ) : savedNotes && !isEmptyRunNotes(savedNotes) ? (
          <Card className="p-3">
            <NotesSummary notes={savedNotes} />
            <View className="mt-3">
              <Button title="Edit" onPress={onEditNotes} variant="secondary" size="md" />
            </View>
          </Card>
        ) : (
          <Card className="p-3">
            <Text className="text-text-secondary text-sm mb-3">
              {"No notes yet. Capture how the run felt while it's fresh."}
            </Text>
            <Button title="Add a note" onPress={onEditNotes} variant="secondary" size="md" />
          </Card>
        )}
      </View>

      <View className="mb-2">
        <Text className="text-text-muted text-xs uppercase tracking-wider mb-2">
          Terrain, HR, Pace
        </Text>
        <TerrainRunChart gps={gps} hr={hr} cadence={cadence} />
      </View>

      {gps.length >= 2 && elevation ? (
        <View className="mb-4">
          <View className="flex-row items-center mb-2" style={{ gap: 8 }}>
            <Text className="text-text-muted text-xs uppercase tracking-wider">
              Elevation
            </Text>
            {refiningElevation ? (
              <View className="flex-row items-center" style={{ gap: 6 }}>
                <ActivityIndicator size="small" color="#737373" />
                <Text className="text-text-muted text-[11px]">
                  refining elevation…
                </Text>
              </View>
            ) : null}
          </View>
          <ElevationSummaryCard stats={elevation} fitM={run?.elevation_fit_m} />
          <View className="mt-3">
            <ElevationProfileChart points={gps} height={180} />
          </View>
        </View>
      ) : null}

      {terrainSummary.length > 0 ? (
        <View className="mb-4">
          <Text className="text-text-muted text-xs uppercase tracking-wider mb-2">
            Terrain segments
          </Text>
          <Card className="p-3">
            {terrainSummary.map((segment, index) => (
              <View
                key={segment.type}
                className={`py-1.5 ${index < terrainSummary.length - 1 ? 'border-b border-bg-border/60' : ''}`}
              >
                <Text className="text-text-primary text-sm font-semibold">
                  {terrainLabel(segment.type)}: {formatDuration(segment.duration_sec)} over {formatDistance(segment.distance_m)}
                </Text>
                <Text className="text-text-secondary text-xs mt-0.5">
                  Avg HR {segment.avg_hr ?? '--'} · pace {segment.avg_pace_sec_per_km ? formatPace(segment.avg_pace_sec_per_km) : '--:--'} · GAP {segment.avg_gap_sec_per_km ? formatPace(segment.avg_gap_sec_per_km) : '--:--'}
                </Text>
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      {run.pre_run_state ? (
        <View className="mb-4">
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: preRunExpanded }}
            onPress={() => setPreRunExpanded((value) => !value)}
            className="rounded-2xl border border-bg-border bg-bg-card p-3"
          >
            <View className="flex-row justify-between gap-3">
              <Text className="text-text-primary text-base font-semibold">
                Pre-run state
              </Text>
              <Text className="text-text-muted text-xs">
                {preRunExpanded ? 'Hide' : 'Show'}
              </Text>
            </View>
            {preRunExpanded ? (
              <View className="mt-3 gap-1.5">
                <ContextRow label="Sleep" value={`${run.pre_run_state.sleep_hours}h · ${run.pre_run_state.sleep_quality}/5`} />
                <ContextRow label="Readiness" value={`${run.pre_run_state.readiness}/10`} />
                <ContextRow label="Hydration" value={run.pre_run_state.hydration.replace(/_/g, ' ')} />
                <ContextRow label="Alcohol" value={run.pre_run_state.alcohol_24h.replace(/_/g, ' ')} />
                <ContextRow label="Niggles" value={run.pre_run_state.niggles.join(', ')} />
                {run.pre_run_state.last_meal_what ? (
                  <ContextRow label="Meal" value={run.pre_run_state.last_meal_what} />
                ) : null}
              </View>
            ) : null}
          </Pressable>
        </View>
      ) : null}

      <View className="mb-2">
        <Text className="text-text-muted text-xs uppercase tracking-wider mb-2">
          Heart Rate
        </Text>
        <HRTimeChart samples={hr} zones={profile.zones} height={180} />
      </View>

      <View className="mb-6">
        <Text className="text-text-muted text-xs uppercase tracking-wider mb-2">
          Zone Distribution
        </Text>
        <Card className="p-3">
          <View className="flex-row items-center">
            <ZonePieChart distribution={currentZoneDistribution} size={104} />
            <View className="flex-1 ml-3">
              {(['z1_sec', 'z2_sec', 'z3_sec', 'z4_sec', 'z5_sec'] as const).map((k, i) => {
                const sec = currentZoneDistribution[k];
                return (
                  <View key={k} className="flex-row justify-between mb-0.5">
                    <Text className="text-text-secondary text-xs">Z{i + 1}</Text>
                    <Text className="text-text-primary text-xs font-mono">
                      {formatDuration(sec)}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
          <View className="mt-3">
            <ZoneDistributionBar
              distribution={currentZoneDistribution}
              showLegend={false}
              height={10}
            />
          </View>
        </Card>
      </View>

      {gps.length >= 2 ? (
        <View className="mb-6">
          <Text className="text-text-muted text-xs uppercase tracking-wider mb-2">Route</Text>
          {canRenderRouteMap ? (
            <RunMap points={gps} hrSamples={hr} zones={profile.zones} />
          ) : (
            <RouteMapUnavailable pointCount={gps.length} />
          )}
          <Button
            title="Export GPX"
            onPress={() => {
              void onExportGpx();
            }}
            variant="secondary"
            size="md"
            className="mt-3"
          />
        </View>
      ) : null}

      <View className="mb-6">
        <Text className="text-text-muted text-xs uppercase tracking-wider mb-2">Splits</Text>
        <Card className="p-3">
          <SplitsTable
            splits={splitsWithElevation}
            totalDistanceM={run.distance_m}
            totalDurationSec={run.duration_sec}
          />
        </Card>
      </View>

      <View className="mb-6">
        <MemoMafPaceMiniTrend current={run} previousRuns={previousRuns} />
      </View>

      {decoupling ? (
        <View className="mb-6">
          <DecouplingCard result={decoupling} />
        </View>
      ) : null}

      {run.recovery_hr_drop !== undefined && run.recovery_hr_drop > 0 ? (
        <Card className="mb-6 p-3">
          <Text className="text-text-muted text-xs uppercase tracking-wider">
            1-Min Recovery HR Drop
          </Text>
          <Text className="text-text-primary text-2xl font-bold mt-1">
            -{run.recovery_hr_drop} bpm
          </Text>
        </Card>
      ) : null}

      <View className="mb-6">
        <Text className="text-text-muted text-xs uppercase tracking-wider mb-2">
          Export
        </Text>
        <Card className="p-3">
          <Text className="text-text-secondary text-sm mb-3">
            Save this run as a JSON file with its full data: splits, GPS,
            heart rate, cadence, elevation, and context. Share it or analyse it
            in any tool you like.
          </Text>
          <Button
            title="Export JSON"
            onPress={() => {
              void onExportJson();
            }}
            variant="secondary"
            size="md"
          />
        </Card>
      </View>

      <Button title="Delete run" variant="danger" onPress={onDelete} className="mb-6" />
    </Screen>
  );
}

function RouteMapUnavailable({ pointCount }: { pointCount: number }) {
  return (
    <Card className="p-3">
      <Text className="text-text-secondary text-sm">
        Route map unavailable in this Android build. GPS track is saved with{' '}
        {pointCount} points, and GPX export is available.
      </Text>
    </Card>
  );
}

interface DetailMetricProps {
  label: string;
  value: string;
  sublabel?: string;
  className?: string;
  valueClassName?: string;
}

function DetailMetric({
  label,
  value,
  sublabel,
  className,
  valueClassName,
}: DetailMetricProps) {
  return (
    <View className={className}>
      <Text className="text-text-muted text-[10px] uppercase tracking-wider">
        {label}
      </Text>
      <Text
        className={`text-text-primary text-lg font-semibold mt-0.5 ${
          valueClassName ?? ''
        }`}
      >
        {value}
      </Text>
      {sublabel ? (
        <Text className="text-text-secondary text-[11px] mt-0.5">{sublabel}</Text>
      ) : null}
    </View>
  );
}

function RunContextSummary({ context }: { context: RunContext | undefined }) {
  if (!context) {
    return (
      <Text className="text-text-secondary text-sm">
        Add surface, fueling, hydration, and niggle notes for better risk warnings.
      </Text>
    );
  }

  const fuelDone = context.fueling
    ? Object.values(context.fueling).filter(Boolean).length
    : 0;
  return (
    <View className="gap-2">
      <ContextRow label="Surface" value={context.surface ?? 'not set'} />
      <ContextRow label="Fuel checklist" value={`${fuelDone}/4`} />
      <ContextRow label="Niggle" value={context.niggle?.trim() || 'none'} />
    </View>
  );
}

function ContextRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between gap-3">
      <Text className="text-text-secondary text-sm">{label}</Text>
      <Text className="text-text-primary text-sm font-medium flex-1 text-right">
        {value}
      </Text>
    </View>
  );
}

function normalizeRunContext(context: RunContext): RunContext | undefined {
  const niggle = context.niggle?.trim();
  const next: RunContext = {
    ...(context.surface ? { surface: context.surface } : {}),
    ...(context.fueling ? { fueling: context.fueling } : {}),
    ...(niggle ? { niggle } : {}),
  };
  return Object.keys(next).length > 0 ? next : undefined;
}

function formatGapDelta(run: CompletedRun): string | undefined {
  if (run.avg_gap_sec_per_km === null || run.avg_gap_sec_per_km === undefined) {
    return undefined;
  }
  const delta = Math.round(run.avg_gap_sec_per_km - run.avg_pace_sec_per_km);
  if (delta === 0) return 'same as pace';
  // Keep the minus sign: GAP faster than raw (the common hilly case) used to
  // render identically to an unsigned value.
  return `${delta > 0 ? '+' : '−'}${formatDuration(Math.abs(delta))}/km vs raw`;
}

function terrainLabel(type: string): string {
  switch (type) {
    case 'descent':
      return 'Descents';
    case 'flat':
      return 'Flat';
    case 'climb':
      return 'Climbs';
    case 'steep_climb':
      return 'Steep climbs';
    default:
      return type;
  }
}

function riskBorderClass(severity: 'info' | 'warning' | 'danger'): string {
  if (severity === 'danger') return 'border border-zone-z5';
  if (severity === 'warning') return 'border border-zone-z4';
  return 'border border-zone-z3';
}

/**
 * Merge per-km elevation gain/loss (from the GPS track) into the stored
 * splits. Falls back to the original splits when there's no usable track.
 */
function enrichSplitsWithElevation(
  splits: CompletedRun['splits'],
  gps: GpsPointRecord[]
): CompletedRun['splits'] {
  if (splits.length === 0 || gps.length < 2) return splits;
  const perKm = elevationPerSplit(gps);
  if (perKm.length === 0) return splits;

  const byKm = new Map(perKm.map((e) => [e.km, e]));
  return splits.map((split) => {
    const elev = byKm.get(split.km);
    if (!elev) return split;
    // Prefer values already set at run finish (from terrain metrics); only
    // backfill ascent/descent from the GPS track when they're missing.
    return {
      ...split,
      ascent_m: split.ascent_m ?? elev.gain_m,
      descent_m: split.descent_m ?? elev.loss_m,
    };
  });
}
