// SPDX-License-Identifier: GPL-3.0-or-later

import { getDb } from './db';

export function updateRunNotes(id: string, notes: string | null): void {
  const db = getDb();
  db.runSync('UPDATE runs SET notes = ? WHERE id = ?', notes, id);
}

/**
 * The old free-text placeholder template that was saved verbatim even when the
 * user never typed anything (Bug 5). Kept here (not imported from the editor
 * component) so this DB migration stays out of the UI dependency graph.
 */
const LEGACY_NOTES_PLACEHOLDER = `Felt: /10
Energy: low / normal / high
Niggles: none
Conditions:`;

/**
 * One-time migration: clear runs whose notes are exactly the old placeholder
 * template (with optional trailing whitespace). Idempotent. Returns the number
 * of rows cleared.
 */
export function migrateLegacyPlaceholderNotes(): number {
  const db = getDb();
  const result = db.runSync(
    'UPDATE runs SET notes = NULL WHERE notes IS NOT NULL AND TRIM(notes) = ?',
    LEGACY_NOTES_PLACEHOLDER
  );
  return result.changes ?? 0;
}
