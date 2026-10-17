// SPDX-License-Identifier: GPL-3.0-or-later

import { totalZoneSec } from '@/lib/metrics/zones';
import { formatDuration, formatPace } from '@/lib/time';
import type { CompletedRun } from '@/types';

function formatPercent(numerator: number, denominator: number): string {
  if (denominator <= 0) return '0%';
  return `${Math.round((numerator / denominator) * 100)}%`;
}

export function postRunSummaryText(run: CompletedRun): { title: string; body: string } {
  const duration = formatDuration(run.duration_sec);
  const z2Pct = formatPercent(
    run.zone_distribution.z2_sec,
    totalZoneSec(run.zone_distribution),
  );
  const parts: string[] = [`${duration}.`];
  if (run.avg_hr > 0) parts.push(`${run.avg_hr} avg.`);
  parts.push(`${z2Pct} in Z2.`);
  if (run.maf_pace_sec_per_km !== null && run.maf_pace_sec_per_km > 0) {
    parts.push(`MAF ${formatPace(run.maf_pace_sec_per_km)}.`);
  }

  return {
    title: 'Done',
    body: parts.join(' '),
  };
}
