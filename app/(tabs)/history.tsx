// SPDX-License-Identifier: GPL-3.0-or-later

import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FlatList, Pressable, Text, View, type ListRenderItem } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DecouplingTrendChart } from '@/components/history/DecouplingTrendChart';
import { FreshnessPill } from '@/components/history/FreshnessPill';
import { HrvTrendChart } from '@/components/history/HrvTrendChart';
import { LoadChart } from '@/components/history/LoadChart';
import { MafDriftChart } from '@/components/history/MafDriftChart';
import { RunRow } from '@/components/history/RunRow';
import { SummaryCard } from '@/components/history/SummaryCard';
import { TrendLineChart } from '@/components/history/TrendLineChart';
import { VdotCard } from '@/components/history/VdotCard';
import { WeeklyZ2BarChart } from '@/components/history/WeeklyZ2BarChart';
import { Card } from '@/components/ui/Card';
import { decouplingTrendLoadingMissing } from '@/lib/metrics/historyTrends';
import { loadSeries } from '@/lib/metrics/load';
import { weeklyMafDrift, weeklyZ2Minutes } from '@/lib/metrics/maf';
import { maxHRTrend, restingHRTrend } from '@/lib/metrics/trends';
import { latestVdotFromRuns } from '@/lib/metrics/vdot';
import { useProfileStore } from '@/lib/storage/profile';
import {
  getAllHrv,
  getAllRuns,
  getBaselines,
  getDataVersion,
  getGpsPoints,
  getHRSamples,
} from '@/lib/storage/db';
import { formatPace } from '@/lib/time';
import { zoneColor } from '@/lib/zones';
import type { BaselineRecord, CompletedRun, DecouplingPoint, HrvRecord } from '@/types';

type Tab = 'runs' | 'trends';

const Z2_TARGET = 150;
const SUB_7_PACE = 7 * 60;
const STALE_MAF_MS = 14 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
// Mirrors <Screen scroll>: this tab renders its own FlatList so the run list
// is virtualised, but must look identical to every other tab.
const HORIZONTAL_PADDING = 16;
const VERTICAL_PADDING = 12;
const TAB_SCROLL_CLEARANCE = 64;
const NO_DECOUPLING: DecouplingPoint[] = [];
const NO_RUNS: CompletedRun[] = [];

interface HistoryData {
  runs: CompletedRun[];
  restingBaselines: BaselineRecord[];
  maxBaselines: BaselineRecord[];
  hrvHistory: HrvRecord[];
}

const EMPTY_DATA: HistoryData = {
  runs: [],
  restingBaselines: [],
  maxBaselines: [],
  hrvHistory: [],
};

function localDayStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const keyExtractor = (run: CompletedRun) => run.id;

export default function HistoryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string | string[] }>();
  const profile = useProfileStore((s) => s.profile);
  const [tab, setTab] = useState<Tab>(() => parseTabParam(params.tab) ?? 'runs');
  // The decoupling trend is the only derivation that may need raw samples, so
  // it waits until the Trends tab is first opened.
  const [trendsOpened, setTrendsOpened] = useState(tab === 'trends');
  const [data, setData] = useState<HistoryData>(EMPTY_DATA);
  const [focusedAt, setFocusedAt] = useState(() => Date.now());
  const dataVersion = useRef<string | null>(null);
  const { runs, restingBaselines, maxBaselines, hrvHistory } = data;

  const showTab = useCallback((next: Tab) => {
    setTab(next);
    if (next === 'trends') setTrendsOpened(true);
  }, []);

  useEffect(() => {
    const requestedTab = parseTabParam(params.tab);
    if (requestedTab) showTab(requestedTab);
  }, [params.tab, showTab]);

  useFocusEffect(
    useCallback(() => {
      // Re-read only when something was written since the last focus; an
      // unchanged refocus keeps every array identity, so nothing re-derives.
      const version = getDataVersion();
      if (version !== dataVersion.current) {
        dataVersion.current = version;
        setData({
          runs: getAllRuns(),
          restingBaselines: getBaselines('resting_hr'),
          maxBaselines: getBaselines('max_hr'),
          hrvHistory: getAllHrv(),
        });
      }
      setFocusedAt(Date.now());
    }, [])
  );

  // Load and weekly Z2 only read "today" at day granularity.
  const todayStart = localDayStart(focusedAt);
  const drift = useMemo(() => weeklyMafDrift(runs), [runs]);
  const weeklyZ2 = useMemo(() => weeklyZ2Minutes(runs, new Date(todayStart)), [runs, todayStart]);
  const rhrPoints = useMemo(() => restingHRTrend(restingBaselines), [restingBaselines]);
  const maxHrPoints = useMemo(() => maxHRTrend(maxBaselines), [maxBaselines]);
  const load = useMemo(
    () => loadSeries(runs, profile, new Date(todayStart)),
    [runs, profile, todayStart]
  );
  const tsb = load[load.length - 1]?.tsb ?? 0;
  const vdot = useMemo(() => latestVdotFromRuns(runs), [runs]);
  const decoupling = useMemo(() => {
    if (!trendsOpened || runs.length === 0) return NO_DECOUPLING;
    return decouplingTrendLoadingMissing(runs, getHRSamples, getGpsPoints);
  }, [runs, trendsOpened]);

  const z2LastSevenDaysMin = useMemo(() => {
    const cutoff = focusedAt - SEVEN_DAYS_MS;
    const sec = runs
      .filter((r) => r.started_at >= cutoff)
      .reduce((acc, r) => acc + r.zone_distribution.z2_sec, 0);
    return Math.round(sec / 60);
  }, [runs, focusedAt]);

  const latestMaf = drift[drift.length - 1];
  const subSevenWeek = drift.find((d) => d.pace_sec_per_km <= SUB_7_PACE);
  const latestMafIsStale = latestMaf
    ? Date.now() - new Date(latestMaf.weekStart).getTime() > STALE_MAF_MS
    : false;

  const onRowPress = useCallback(
    (runId: string) => {
      router.push({ pathname: '/run/[id]', params: { id: runId } });
    },
    [router]
  );
  const showRuns = useCallback(() => showTab('runs'), [showTab]);
  const showTrends = useCallback(() => showTab('trends'), [showTab]);
  const renderRun = useCallback<ListRenderItem<CompletedRun>>(
    ({ item }) => <RunRow run={item} onPress={onRowPress} />,
    [onRowPress]
  );

  const insets = useSafeAreaInsets();

  const header = (
    <>
      <View className="mb-4">
        <Text className="text-text-primary text-3xl font-bold">History</Text>
        <Text className="text-text-secondary text-sm mt-1">
          {`${runs.length} run${runs.length === 1 ? '' : 's'} logged`}
        </Text>
      </View>

      <View className="flex-row bg-bg-card rounded-full p-1 mb-4">
        <TabPill label="Runs" active={tab === 'runs'} onPress={showRuns} />
        <TabPill
          label="Trends"
          active={tab === 'trends'}
          onPress={showTrends}
        />
      </View>

      <View className="mb-4 gap-2">
        <View className="flex-row">
          <SummaryCard
            label="MAF GAP"
            value={latestMaf ? formatPace(latestMaf.pace_sec_per_km) : '--:--'}
            hint={
              latestMaf
                ? `W${latestMaf.weekNumber}${latestMafIsStale ? ' · stale' : ''}`
                : 'Run at MAF'
            }
            accentClass={latestMafIsStale ? 'text-text-muted' : 'text-zone-z2'}
          />
          <SummaryCard
            label="Z2 Last 7 Days"
            value={`${z2LastSevenDaysMin} min`}
            hint={`of ${Z2_TARGET}min target`}
            accentClass="text-zone-z2"
          />
        </View>
        <View className="flex-row">
          <FreshnessPill tsb={tsb} />
        </View>
      </View>
    </>
  );

  const trends =
    tab === 'trends' ? (
      <View>
        <Section title="MAF-GAP Drift">
          <MafDriftChart data={drift} milestonePace={SUB_7_PACE} />
          {subSevenWeek ? (
            <View className="mt-3 flex-row items-center">
              <View
                className="w-2 h-2 rounded-full mr-2"
                style={{ backgroundColor: zoneColor(2) }}
              />
              <Text className="text-text-secondary text-xs">
                Week {subSevenWeek.weekNumber}: first sub-7:00/km at MAF-GAP
              </Text>
            </View>
          ) : null}
        </Section>

        <Section title="Training Load">
          <LoadChart data={load} />
        </Section>

        <Section title="VDOT">
          <VdotCard result={vdot} />
        </Section>

        <Section title="HRV Trend">
          <HrvTrendChart history={hrvHistory} />
        </Section>

        <Section title="Aerobic Decoupling">
          <DecouplingTrendChart points={decoupling} />
        </Section>

        <Section title="Weekly Z2 Minutes">
          <WeeklyZ2BarChart data={weeklyZ2} targetMinutes={Z2_TARGET} />
          <Text className="text-text-secondary text-xs mt-2">
            Target: 150 min/week of zone 2
          </Text>
        </Section>

        <Section title="Resting HR">
          <TrendLineChart
            data={rhrPoints}
            color={zoneColor(1)}
            emptyMessage="Log a resting HR baseline to start tracking"
          />
        </Section>

        <Section title="Max HR per Month">
          <TrendLineChart
            data={maxHrPoints}
            color={zoneColor(5)}
            height={80}
            emptyMessage="No max HR baselines yet"
            showDots={false}
          />
        </Section>
      </View>
    ) : null;

  return (
    <View
      className="flex-1 bg-bg"
      style={{
        paddingTop: insets.top,
        paddingLeft: insets.left,
        paddingRight: insets.right,
      }}
    >
      <FlatList
        data={tab === 'runs' ? runs : NO_RUNS}
        keyExtractor={keyExtractor}
        renderItem={renderRun}
        ListHeaderComponent={header}
        ListEmptyComponent={tab === 'runs' ? <NoRunsCard /> : null}
        ListFooterComponent={trends}
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: VERTICAL_PADDING,
          paddingBottom: VERTICAL_PADDING + TAB_SCROLL_CLEARANCE,
          paddingHorizontal: HORIZONTAL_PADDING,
        }}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        windowSize={7}
      />
    </View>
  );
}

function NoRunsCard() {
  return (
    <Card>
      <Text className="text-text-secondary text-sm text-center py-6">
        No runs yet. Start one from the Run tab.
      </Text>
    </Card>
  );
}

function parseTabParam(value: string | string[] | undefined): Tab | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === 'runs' || raw === 'trends') return raw;
  return null;
}

interface TabPillProps {
  label: string;
  active: boolean;
  onPress: () => void;
}

function TabPill({ label, active, onPress }: TabPillProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Show ${label.toLowerCase()}`}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      hitSlop={4}
      className={`flex-1 min-h-11 rounded-full items-center justify-center border ${
        active ? 'bg-bg-elevated border-bg-border' : 'border-transparent'
      }`}
    >
      <Text
        className={`text-xs font-semibold ${active ? 'text-accent' : 'text-text-secondary'}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

interface SectionProps {
  title: string;
  children: ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <View className="mb-6">
      <Text className="text-text-muted text-xs uppercase tracking-wider mb-2">{title}</Text>
      {children}
    </View>
  );
}
