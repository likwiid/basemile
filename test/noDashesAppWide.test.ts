// SPDX-License-Identifier: GPL-3.0-or-later

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * No em or en dashes in anything the user can read or hear. Scans every
 * non-comment source line under app/, components/ and lib/ (UI text, alerts,
 * spoken cues, insights). Comments are free to use them.
 */
const ROOTS = ['app', 'components', 'lib'];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('{/*') || t.startsWith('--');
}

describe('app-wide copy', () => {
  it('never uses em or en dashes outside comments', () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of sourceFiles(root)) {
        fs.readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (!/[–—]/.test(line) || isCommentLine(line)) return;
            // Trailing `// comment` on a code line is still a comment.
            const code = line.replace(/\s\/\/\s.*$/, '');
            if (/[–—]/.test(code)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
          });
      }
    }
    expect(offenders).toEqual([]);
  });
});
