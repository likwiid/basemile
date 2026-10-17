// SPDX-License-Identifier: GPL-3.0-or-later

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * House style for the run surfaces: no em dashes and no en dashes in
 * user-visible copy (JSX text, string and template literals, which covers
 * Alert text and spoken cue text). Ranges use a plain hyphen; asides become
 * short sentences. Comments are ignored because they are never shown.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EM_DASH = '—';
const EN_DASH = '–';

function runSurfaceFiles(): string[] {
  const componentsDir = join(root, 'components', 'run');
  const components = readdirSync(componentsDir)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => join(componentsDir, f));
  return [join(root, 'app', '(tabs)', 'run.tsx'), ...components];
}

interface Offender {
  file: string;
  line: number;
  text: string;
}

/** Every string/template/JSX-text node in `source` that contains a dash. */
export function findDashCopy(fileName: string, source: string): Offender[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: Offender[] = [];
  const visit = (node: ts.Node) => {
    let text: string | null = null;
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      text = node.text;
    } else if (ts.isJsxText(node)) {
      text = node.getText(sf);
    }
    if (text !== null && (text.includes(EM_DASH) || text.includes(EN_DASH))) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      out.push({ file: relative(root, fileName), line: line + 1, text: text.trim() });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe('run surface copy has no em/en dashes', () => {
  it('detects dashes in literals and JSX text but ignores comments', () => {
    const src = [
      '// comment — fine',
      '/* block – fine */',
      "const a = 'plain - ok';",
      "const b = 'bad — dash';",
      'const c = `t ${a} – x`;',
      'const d = <Text>Hi — there</Text>;',
      'const e = <Text>{a}–{b}</Text>;',
    ].join('\n');
    const found = findDashCopy('fixture.tsx', src).map((o) => o.line);
    expect(found).toEqual([4, 5, 6, 7]);
  });

  it.each(runSurfaceFiles().map((f) => [relative(root, f), f]))('%s', (_name, file) => {
    const offenders = findDashCopy(file, readFileSync(file, 'utf8'));
    expect(offenders).toEqual([]);
  });
});
