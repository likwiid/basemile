// SPDX-License-Identifier: GPL-3.0-or-later

import { Pressable, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import type { RunEnergy, RunNotes } from '@/types';

/** Legacy free-text template — kept only to detect/migrate old saved notes. */
export const RUN_NOTES_TEMPLATE = `Felt: /10
Energy: low / normal / high
Niggles: none
Conditions: `;

export const NIGGLE_OPTIONS = [
  'calf',
  'achilles',
  'knee',
  'hip',
  'it_band',
  'shin',
  'foot',
  'ankle',
  'hamstring',
  'other',
] as const;

const ENERGY_OPTIONS: RunEnergy[] = ['low', 'normal', 'high'];
const ENERGY_LABEL: Record<RunEnergy, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
};
const niggleLabel = (key: string): string => key.replace('_', ' ');

export function isEmptyRunNotes(n: RunNotes): boolean {
  return (
    n.felt == null &&
    n.energy == null &&
    (!n.niggles || n.niggles.length === 0) &&
    (!n.conditions || n.conditions.trim().length === 0)
  );
}

/** Serialize to a JSON string, or null when nothing was entered (Bug 5). */
export function serializeRunNotes(n: RunNotes): string | null {
  return isEmptyRunNotes(n) ? null : JSON.stringify(n);
}

/**
 * Parse stored notes. JSON → RunNotes. The legacy placeholder template → null
 * (it was never real input — this is the migration). Any other legacy free
 * text is preserved as `conditions`.
 */
export function parseRunNotes(raw: string | null | undefined): RunNotes | null {
  if (raw == null) return null;
  if (raw.trim() === RUN_NOTES_TEMPLATE.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as RunNotes;
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // not JSON — legacy free text
  }
  return raw.trim().length > 0 ? { conditions: raw } : null;
}

interface NotesEditorProps {
  value: RunNotes;
  onChange: (next: RunNotes) => void;
  onSave: () => void;
  onCancel?: () => void;
}

export function NotesEditor({ value, onChange, onSave, onCancel }: NotesEditorProps) {
  const toggleNiggle = (key: string) => {
    const set = new Set(value.niggles ?? []);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    onChange({ ...value, niggles: [...set] });
  };

  return (
    <View className="bg-bg-card/80 border border-bg-border/70 rounded-xl p-3" style={{ gap: 14 }}>
      <Field label="Felt (1-10)">
        <View className="flex-row flex-wrap" style={{ gap: 6 }}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
            const sel = value.felt === n;
            return (
              <Pressable
                key={n}
                onPress={() => onChange({ ...value, felt: sel ? null : n })}
                className={`h-8 w-8 rounded-lg items-center justify-center ${
                  sel ? 'bg-accent' : 'bg-bg-elevated/70 border border-bg-border/60'
                }`}
              >
                <Text className={sel ? 'text-black font-bold' : 'text-text-secondary'}>{n}</Text>
              </Pressable>
            );
          })}
        </View>
      </Field>

      <Field label="Energy">
        <View className="flex-row" style={{ gap: 6 }}>
          {ENERGY_OPTIONS.map((e) => {
            const sel = value.energy === e;
            return (
              <Pressable
                key={e}
                onPress={() => onChange({ ...value, energy: sel ? null : e })}
                className={`flex-1 h-9 rounded-lg items-center justify-center ${
                  sel ? 'bg-accent' : 'bg-bg-elevated/70 border border-bg-border/60'
                }`}
              >
                <Text className={sel ? 'text-black font-semibold' : 'text-text-secondary'}>
                  {ENERGY_LABEL[e]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Field>

      <Field label="Niggles">
        <View className="flex-row flex-wrap" style={{ gap: 6 }}>
          {NIGGLE_OPTIONS.map((k) => {
            const sel = (value.niggles ?? []).includes(k);
            return (
              <Pressable
                key={k}
                onPress={() => toggleNiggle(k)}
                className={`px-3 h-8 rounded-full items-center justify-center ${
                  sel
                    ? 'bg-zone-z5/30 border border-zone-z5'
                    : 'bg-bg-elevated/70 border border-bg-border/60'
                }`}
              >
                <Text className={`text-xs ${sel ? 'text-zone-z5' : 'text-text-secondary'}`}>
                  {niggleLabel(k)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Field>

      <Field label="Conditions">
        <TextInput
          value={value.conditions ?? ''}
          onChangeText={(t) => onChange({ ...value, conditions: t })}
          placeholder="weather, route, how it felt…"
          placeholderTextColor="#525252"
          className="bg-bg-elevated/70 text-text-primary text-sm px-3 py-2.5 rounded-lg border border-bg-border/60"
        />
      </Field>

      <View className="flex-row" style={{ gap: 8 }}>
        <View className="flex-1">
          <Button title="Save" onPress={onSave} variant="primary" size="md" />
        </View>
        {onCancel ? (
          <View className="flex-1">
            <Button title="Cancel" onPress={onCancel} variant="secondary" size="md" />
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** Read-only summary of structured notes for the run detail screen. */
export function NotesSummary({ notes }: { notes: RunNotes }) {
  const head: string[] = [];
  if (notes.felt != null) head.push(`Felt ${notes.felt}/10`);
  if (notes.energy) head.push(`Energy: ${ENERGY_LABEL[notes.energy]}`);
  return (
    <View style={{ gap: 6 }}>
      {head.length > 0 ? (
        <Text className="text-text-primary text-sm">{head.join(' · ')}</Text>
      ) : null}
      {notes.niggles && notes.niggles.length > 0 ? (
        <Text className="text-zone-z5 text-sm">
          Niggles: {notes.niggles.map(niggleLabel).join(', ')}
        </Text>
      ) : null}
      {notes.conditions && notes.conditions.trim().length > 0 ? (
        <Text className="text-text-secondary text-sm">{notes.conditions}</Text>
      ) : null}
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View>
      <Text className="text-text-muted text-[11px] uppercase tracking-wider mb-1.5">{label}</Text>
      {children}
    </View>
  );
}
