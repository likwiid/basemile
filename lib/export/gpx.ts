// SPDX-License-Identifier: GPL-3.0-or-later

import type { CompletedRun, GpsPointRecord } from '@/types';

export function gpxFilename(run: CompletedRun): string {
  const date = new Date(run.started_at).toISOString().slice(0, 10);
  return `basemile-run-${date}-${run.id}.gpx`;
}

export function runToGpx(run: CompletedRun, points: GpsPointRecord[]): string {
  const name = `${run.type} ${new Date(run.started_at).toISOString()}`;
  const trkpts = points
    .map((point) => {
      const ele =
        point.altitude !== null && point.altitude !== undefined
          ? `\n        <ele>${escapeXml(String(point.altitude))}</ele>`
          : '';
      return `      <trkpt lat="${point.latitude}" lon="${point.longitude}">${ele}
        <time>${new Date(point.timestamp).toISOString()}</time>
      </trkpt>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="BaseMile" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(name)}</name>
    <time>${new Date(run.started_at).toISOString()}</time>
  </metadata>
  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
