// SPDX-License-Identifier: GPL-3.0-or-later

import { totalZoneSec, zoneSeconds } from '@/lib/metrics/zones';
import { formatDistance, formatDuration, formatPace } from '@/lib/time';
import { classifyHR } from '@/lib/zones';
import type { CompletedRun, HRSample, HRSampleRecord, ZoneConfig, ZoneNumber } from '@/types';

type InsightSample = Pick<HRSample | HRSampleRecord, 'timestamp' | 'bpm'>;

export interface RunReportSection {
  title: string;
  items: string[];
}

export interface RunReport {
  mafProgress: RunReportSection;
  whatHappened: RunReportSection;
  next: RunReportSection;
  splits: RunReportSection;
  comparison: RunReportSection;
}

export function runInsights(
  run: CompletedRun,
  zones: ZoneConfig,
  samples: readonly InsightSample[] = [],
  targetZone: ZoneNumber = 2
): string[] {
  const insights: string[] = [];
  const drift = splitDriftInsight(run);
  if (drift) insights.push(drift);

  const finish = finishingKickInsight(run, zones, samples);
  if (finish) insights.push(finish);

  const compliance = zoneComplianceInsight(run, targetZone);
  if (compliance) insights.push(compliance);

  const terrain = terrainInsight(run, zones);
  if (terrain) insights.push(terrain);

  const cadence = cadenceInsight(run);
  if (cadence) insights.push(cadence);

  return insights.slice(0, 4);
}

export function runReport(
  run: CompletedRun,
  zones: ZoneConfig,
  samples: readonly InsightSample[] = [],
  previousRuns: readonly CompletedRun[] = [],
  targetZone: ZoneNumber = 2
): RunReport {
  const similarRuns = lastSimilarRuns(run, previousRuns);
  return {
    mafProgress: {
      title: 'MAF progress',
      items: mafProgressItems(run, similarRuns),
    },
    whatHappened: {
      title: 'What happened',
      items: whatHappenedItems(run, zones, samples, targetZone),
    },
    next: {
      title: 'What to do next',
      items: nextItems(run, targetZone, similarRuns),
    },
    splits: {
      title: 'Split commentary',
      items: splitCommentaryItems(run),
    },
    comparison: {
      title: 'Vs last 3 similar runs',
      items: comparisonItems(run, similarRuns),
    },
  };
}

function splitDriftInsight(run: CompletedRun): string | null {
  for (let i = 1; i < run.splits.length; i += 1) {
    const prev = run.splits[i - 1];
    const curr = run.splits[i];
    if (!prev || !curr || prev.avg_hr <= 0 || curr.avg_hr <= 0) continue;
    const sameHr = Math.abs(curr.avg_hr - prev.avg_hr) <= 3;
    const slower = curr.duration_sec - prev.duration_sec;
    if (sameHr && slower > 30) {
      return `Pace slowed on Km ${curr.km} at the same HR, likely early fatigue.`;
    }
  }
  return null;
}

/**
 * Grade-adjusted MAF pace when available, raw otherwise — the SAME preference
 * the weekly drift trend and VDOT use. Comparing raw here while the trend used
 * GAP produced opposite verdicts for the same hilly run.
 */
function mafMarker(run: CompletedRun): number | null {
  return run.maf_gap_pace_sec_per_km ?? run.maf_pace_sec_per_km;
}

function mafProgressItems(run: CompletedRun, previousRuns: readonly CompletedRun[]): string[] {
  const todayMaf = mafMarker(run);
  if (todayMaf === null) {
    return [
      'No MAF pace was captured inside the MAF window. Next run, settle into that range long enough to record a clean aerobic marker.',
    ];
  }

  const items = [`Today: ${formatPace(todayMaf)} at MAF.`];
  const latest = previousRuns.map(mafMarker).find((pace) => pace !== null);
  if (latest !== null && latest !== undefined) {
    items.push(`Vs most recent similar MAF run: ${formatPaceDelta(todayMaf - latest)}.`);
  }

  const previousMaf = previousRuns
    .map(mafMarker)
    .filter((pace): pace is number => pace !== null);
  if (previousMaf.length > 0) {
    const avg = average(previousMaf);
    items.push(`Vs similar-run average: ${formatPaceDelta(todayMaf - avg)}.`);
  }

  return items;
}

function whatHappenedItems(
  run: CompletedRun,
  zones: ZoneConfig,
  samples: readonly InsightSample[],
  targetZone: ZoneNumber
): string[] {
  const items = [
    `You ran ${formatDistance(run.distance_m)} in ${formatDuration(run.duration_sec)} at ${formatPace(run.avg_pace_sec_per_km)}, averaging ${formatBpm(run.avg_hr)}.`,
  ];
  const targetPct = zonePct(run, targetZone);
  if (targetPct !== null) {
    items.push(`${targetPct}% of recorded HR time landed in Z${targetZone}.`);
  }
  if (run.max_hr > 0) {
    items.push(`Peak HR was ${run.max_hr} bpm.`);
  }
  const finish = finishingKickInsight(run, zones, samples);
  if (finish) items.push(finish);
  const terrain = terrainInsight(run, zones);
  if (terrain) items.push(terrain);
  if (run.weather?.temp_c !== null && run.weather?.temp_c !== undefined && run.weather.temp_c > 26) {
    items.push('Hot run: expect +5-10 bpm HR drift vs cool conditions. Treat drift interpretation as heat-aware.');
  }
  return items;
}

function nextItems(
  run: CompletedRun,
  targetZone: ZoneNumber,
  previousRuns: readonly CompletedRun[]
): string[] {
  const items: string[] = [];
  const targetPct = atOrBelowZonePct(run, targetZone);
  if (targetPct === null) {
    items.push('Keep the next run easy and steady so the report has enough zone data to judge pacing.');
  } else if (targetPct >= 90) {
    items.push('Repeat this effort profile: easy start, steady middle, no need to chase pace.');
  } else if (targetPct < 75) {
    items.push(`Start easier next time and keep more time at or below Z${targetZone}.`);
  } else {
    items.push(`Good base, but smooth the first half so more time stays at or below Z${targetZone}.`);
  }

  const adviceMaf = mafMarker(run);
  if (adviceMaf === null) {
    items.push('Hold the MAF window for a longer continuous block to establish MAF progress.');
  } else {
    const previousMaf = previousRuns
      .map(mafMarker)
      .filter((pace): pace is number => pace !== null);
    if (previousMaf.length > 0 && adviceMaf > average(previousMaf) + 10) {
      items.push('MAF pace is slower than the recent similar-run average; prioritize recovery and aerobic control before adding intensity.');
    } else {
      items.push('Keep using MAF pace as the main progress marker for the next comparable run.');
    }
  }

  if (run.pre_run_state?.readiness !== undefined && run.pre_run_state.readiness < 6) {
    items.push('You started under-ready; treat today as a recovery signal before blaming fitness.');
  }

  if (
    run.pre_run_state?.hydration === 'none' &&
    run.weather?.temp_c !== null &&
    run.weather?.temp_c !== undefined &&
    run.weather.temp_c > 22
  ) {
    items.push('Ran under-hydrated in warm conditions; drift would be expected.');
  }

  return items;
}

function splitCommentaryItems(run: CompletedRun): string[] {
  if (run.splits.length === 0) {
    return ['No split data was recorded for this run.'];
  }

  const items: string[] = [];
  const fastest = minBy(run.splits, (s) => s.duration_sec);
  const slowest = maxBy(run.splits, (s) => s.duration_sec);
  if (fastest && slowest) {
    items.push(
      `Fastest split: Km ${fastest.km} at ${formatDuration(fastest.duration_sec)}. Slowest: Km ${slowest.km} at ${formatDuration(slowest.duration_sec)}.`
    );
  }

  const first = run.splits[0];
  const last = run.splits[run.splits.length - 1];
  if (first && last && first.avg_hr > 0 && last.avg_hr > 0) {
    const paceDelta = last.duration_sec - first.duration_sec;
    const hrDelta = last.avg_hr - first.avg_hr;
    items.push(
      `First-to-last split moved ${formatSplitSeconds(paceDelta)} with HR ${formatSignedBpm(hrDelta)}.`
    );
  }

  const drift = splitDriftInsight(run);
  if (drift) items.push(drift);
  const cadence = cadenceInsight(run);
  if (cadence) items.push(cadence);

  return items;
}

function comparisonItems(run: CompletedRun, previousRuns: readonly CompletedRun[]): string[] {
  if (previousRuns.length === 0) {
    return ['No similar previous runs yet. This run becomes the baseline.'];
  }

  const avgPace = average(previousRuns.map((r) => r.avg_pace_sec_per_km).filter(isPositive));
  const avgHr = average(previousRuns.map((r) => r.avg_hr).filter(isPositive));
  const avgZ2 = average(
    previousRuns
      .map((r) => zonePct(r, 2))
      .filter((pct): pct is number => pct !== null)
  );

  const items = [`Compared against ${previousRuns.length} similar run${previousRuns.length === 1 ? '' : 's'}.`];
  if (avgPace > 0 && run.avg_pace_sec_per_km > 0) {
    items.push(`Average pace was ${formatPaceDelta(run.avg_pace_sec_per_km - avgPace)} than that group.`);
  }
  if (avgHr > 0 && run.avg_hr > 0) {
    items.push(`Average HR was ${formatSignedBpm(Math.round(run.avg_hr - avgHr))} vs that group.`);
  }
  if (avgZ2 > 0) {
    const currentZ2 = zonePct(run, 2);
    if (currentZ2 !== null) {
      items.push(`Z2 time was ${formatSignedPct(currentZ2 - avgZ2)} vs that group.`);
    }
  }
  return items;
}

function finishingKickInsight(
  run: CompletedRun,
  zones: ZoneConfig,
  samples: readonly InsightSample[]
): string | null {
  if (samples.length === 0 || run.max_hr <= 0) return null;
  const maxSamples = samples.filter((s) => s.bpm === run.max_hr);
  const lastMax = maxSamples[maxSamples.length - 1];
  if (!lastMax) return null;
  const cutoff = run.ended_at - run.duration_sec * 100;
  if (lastMax.timestamp < cutoff) return null;
  const zone = classifyHR(run.max_hr, zones);
  if (zone !== null && zone >= 3) {
    return `Brief Z${zone} spike on the finishing kick.`;
  }
  return 'Highest HR landed in the final 10%. Strong, controlled finish.';
}

function zoneComplianceInsight(run: CompletedRun, targetZone: ZoneNumber): string | null {
  // Compliance for an easy/aerobic target = time at or below the ceiling (Z1 is
  // compliant, not a miss). Thresholds judge a single session, not the weekly
  // 80/20 distribution, so a clean easy run should be ~90%+ at or below target.
  const pct = atOrBelowZonePct(run, targetZone);
  if (pct === null) return null;
  if (pct >= 90) return `${pct}% at or below Z${targetZone}. Excellent aerobic discipline.`;
  if (pct < 75) {
    return `${pct}% at or below Z${targetZone}. Too much time above the ceiling. Start easier and let HR settle.`;
  }
  return `${pct}% at or below Z${targetZone}. Close, with room to keep more of it easy.`;
}

function terrainInsight(run: CompletedRun, zones: ZoneConfig): string | null {
  const mafCeiling = zones.z2[1];
  const climbSplits = run.splits.filter((split) => (split.ascent_m ?? 0) > 10);
  if (climbSplits.length > 0) {
    const climbHr = average(
      climbSplits.map((split) => split.avg_hr).filter((hr) => hr > 0)
    );
    if (climbHr > mafCeiling + 5) {
      return `Climbs pushed HR to ${Math.round(climbHr)} avg, above MAF. Walk steep sections next time.`;
    }
  }
  if ((run.ascent_m ?? 0) > 20 && run.avg_gap_sec_per_km && run.avg_pace_sec_per_km) {
    const delta = Math.abs(run.avg_gap_sec_per_km - run.avg_pace_sec_per_km);
    if (delta <= 15) return 'Pacing was well-controlled across the terrain.';
  }
  return null;
}

function cadenceInsight(run: CompletedRun): string | null {
  const splits = run.splits.filter(
    (split) => split.avg_cadence_spm !== null && split.avg_cadence_spm !== undefined
  );
  if (splits.length < 2) return null;
  const half = Math.floor(splits.length / 2);
  const first = average(splits.slice(0, half).map((split) => split.avg_cadence_spm ?? 0));
  const second = average(splits.slice(half).map((split) => split.avg_cadence_spm ?? 0));
  if (first - second > 5) {
    return `Cadence dropped from ${Math.round(first)} to ${Math.round(second)} spm, possible form breakdown under fatigue.`;
  }
  return null;
}

function lastSimilarRuns(
  run: CompletedRun,
  previousRuns: readonly CompletedRun[]
): CompletedRun[] {
  const olderRuns = [...previousRuns]
    .filter((candidate) => candidate.id !== run.id && candidate.started_at < run.started_at)
    .sort((a, b) => b.started_at - a.started_at);

  const similar = olderRuns.filter((candidate) => {
    if (candidate.type !== run.type) return false;
    if (run.distance_m > 0 && candidate.distance_m > 0) {
      return Math.abs(candidate.distance_m - run.distance_m) / run.distance_m <= 0.25;
    }
    if (run.duration_sec > 0 && candidate.duration_sec > 0) {
      return Math.abs(candidate.duration_sec - run.duration_sec) / run.duration_sec <= 0.25;
    }
    return true;
  });

  return (similar.length > 0 ? similar : olderRuns.filter((candidate) => candidate.type === run.type)).slice(0, 3);
}

function zonePct(run: CompletedRun, zone: ZoneNumber): number | null {
  const total = totalZoneSec(run.zone_distribution);
  if (total <= 0) return null;
  return Math.round((zoneSeconds(run.zone_distribution, zone) / total) * 100);
}

/** % of recorded HR time at or below `zone` (Z1..zone) — aerobic-easy compliance. */
function atOrBelowZonePct(run: CompletedRun, zone: ZoneNumber): number | null {
  const total = totalZoneSec(run.zone_distribution);
  if (total <= 0) return null;
  let secs = 0;
  for (let z = 1; z <= zone; z += 1) {
    secs += zoneSeconds(run.zone_distribution, z as ZoneNumber);
  }
  return Math.round((secs / total) * 100);
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function minBy<T>(values: readonly T[], score: (value: T) => number): T | null {
  let best: T | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const value of values) {
    const current = score(value);
    if (current < bestScore) {
      best = value;
      bestScore = current;
    }
  }
  return best;
}

function maxBy<T>(values: readonly T[], score: (value: T) => number): T | null {
  let best: T | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    const current = score(value);
    if (current > bestScore) {
      best = value;
      bestScore = current;
    }
  }
  return best;
}

function formatBpm(bpm: number): string {
  return bpm > 0 ? `${bpm} bpm` : 'unknown HR';
}

function formatPaceDelta(deltaSecPerKm: number): string {
  const rounded = Math.round(deltaSecPerKm);
  if (rounded === 0) return 'even';
  const label = rounded < 0 ? 'faster' : 'slower';
  return `${formatDuration(Math.abs(rounded))}/km ${label}`;
}

function formatSplitSeconds(deltaSec: number): string {
  const rounded = Math.round(deltaSec);
  if (rounded === 0) return 'even';
  return `${Math.abs(rounded)}s ${rounded < 0 ? 'faster' : 'slower'}`;
}

function formatSignedBpm(delta: number): string {
  if (delta === 0) return 'even';
  return `${delta > 0 ? '+' : ''}${delta} bpm`;
}

function formatSignedPct(delta: number): string {
  const rounded = Math.round(delta);
  if (rounded === 0) return 'even';
  return `${rounded > 0 ? '+' : ''}${rounded} pts`;
}
