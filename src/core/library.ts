/**
 * Pure helpers for the preset library: entry construction, hashing,
 * filtering/sorting, slot-fill assignment, conflict detection, and
 * write-verification. Kept free of IndexedDB (that lives in
 * libraryStore.ts) so this module is trivially unit-testable.
 */
import { PRSTDecoder } from './PRSTDecoder';
import { getEffectName } from './effectNames';
import { EFFECT_PARAMS } from './effectParams';
import type { GP200Preset } from './types';

/** Fixed hardware block indices (see effectNames.ts SLOT_MODULES). */
const AMP_SLOT_INDEX = 3;
const CAB_SLOT_INDEX = 5;

/** CAB sub-category byte for a User IR cab (bits 16-23 of the effect id). */
const USER_IR_SUBCATEGORY = 0x10;

export interface LibraryEntry {
  /** sha256 hex of `bytes`; re-importing the same bytes is a no-op. */
  id: string;
  /** Original .prst file bytes, unchanged (1176 or 1224). */
  bytes: Uint8Array;
  fileName: string;
  /** webkitRelativePath, or fileName when imported as a single file. */
  relPath: string;
  /** First path segment of relPath; '' for single files. User-editable. */
  pack: string;
  name: string;
  author: string;
  format: 1176 | 1224;
  ampName: string;
  /** "User IR #n" when usesUserIr, else the cab's display name. */
  cabName: string;
  usesUserIr: boolean;
  irSlot: number | null;
  tags: string[];
  favorite: boolean;
  importedAt: number;
}

/** sha256 hex digest of `bytes`, used as the library entry's dedupe key. */
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** First path segment of a webkitRelativePath-style path; '' when there is none. */
export function packOf(relPath: string): string {
  const slash = relPath.indexOf('/');
  return slash === -1 ? '' : relPath.slice(0, slash);
}

/**
 * Decodes `bytes` and builds a LibraryEntry from it. Throws (does not
 * catch) if the bytes aren't a valid .prst; callers importing many files
 * should catch per-file and keep a failure count, per LIBRARY-SPEC.md.
 */
export async function buildLibraryEntry(
  bytes: Uint8Array,
  fileName: string,
  relPath: string,
  now: number = Date.now(),
): Promise<LibraryEntry> {
  const preset = new PRSTDecoder(bytes).decode();
  const id = await hashBytes(bytes);
  const amp = preset.effects.find((e) => e.slotIndex === AMP_SLOT_INDEX);
  const cab = preset.effects.find((e) => e.slotIndex === CAB_SLOT_INDEX);
  const ampName = amp ? getEffectName(amp.effectId) : '';
  const usesUserIr = cab !== undefined && ((cab.effectId >> 16) & 0xFF) === USER_IR_SUBCATEGORY;
  const irSlot = usesUserIr && cab ? (cab.effectId & 0xFF) + 1 : null;
  const cabName = usesUserIr ? `User IR #${irSlot}` : cab ? getEffectName(cab.effectId) : '';

  return {
    id,
    bytes,
    fileName,
    relPath: relPath || fileName,
    pack: packOf(relPath || fileName),
    name: preset.patchName,
    author: preset.author ?? '',
    format: bytes.length === 1176 ? 1176 : 1224,
    ampName,
    cabName,
    usesUserIr,
    irSlot,
    tags: [],
    favorite: false,
    importedAt: now,
  };
}

/** Drops duplicate ids, keeping the first occurrence (import order). */
export function dedupeEntries(entries: LibraryEntry[]): LibraryEntry[] {
  const seen = new Set<string>();
  const out: LibraryEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out;
}

export interface LibraryFilters {
  query?: string;
  pack?: string; // '' / undefined = all
  usesUserIr?: boolean; // undefined = either
  format?: 1176 | 1224; // undefined = either
}

/** Matches name/pack/amp/cab/fileName against the (already-lowercased) query. */
function matchesQuery(entry: LibraryEntry, query: string): boolean {
  if (!query) return true;
  const haystack = `${entry.name} ${entry.pack} ${entry.ampName} ${entry.cabName} ${entry.fileName}`.toLowerCase();
  return haystack.includes(query);
}

export function filterEntries(entries: LibraryEntry[], filters: LibraryFilters): LibraryEntry[] {
  const query = filters.query?.trim().toLowerCase() ?? '';
  return entries.filter((entry) => {
    if (!matchesQuery(entry, query)) return false;
    if (filters.pack && entry.pack !== filters.pack) return false;
    if (filters.usesUserIr !== undefined && entry.usesUserIr !== filters.usesUserIr) return false;
    if (filters.format !== undefined && entry.format !== filters.format) return false;
    return true;
  });
}

export type LibrarySortKey = 'name' | 'pack' | 'amp' | 'imported';

export function sortEntries(entries: LibraryEntry[], key: LibrarySortKey): LibraryEntry[] {
  const sorted = [...entries];
  sorted.sort((a, b) => {
    switch (key) {
      case 'pack':
        return a.pack.localeCompare(b.pack) || a.name.localeCompare(b.name);
      case 'amp':
        return a.ampName.localeCompare(b.ampName) || a.name.localeCompare(b.name);
      case 'imported':
        return b.importedAt - a.importedAt;
      case 'name':
      default:
        return a.name.localeCompare(b.name);
    }
  });
  return sorted;
}

/** Every pack name present in `entries`, sorted, '' (unfiled) sorted first. */
export function packsOf(entries: LibraryEntry[]): string[] {
  const packs = new Set(entries.map((e) => e.pack));
  return [...packs].sort((a, b) => {
    if (a === b) return 0;
    if (a === '') return -1;
    if (b === '') return 1;
    return a.localeCompare(b);
  });
}

/**
 * Sequential slot assignment starting at `startSlot`: 41A, 41B, 41C, 41D,
 * 42A, … Stops (returns a shorter array) rather than wrapping past slot 255,
 * so a fill can never silently land back at the top of the device.
 */
export function fillSlotsFromStart(startSlot: number, count: number): number[] {
  const slots: number[] = [];
  for (let i = 0; i < count && startSlot + i <= 255; i++) {
    slots.push(startSlot + i);
  }
  return slots;
}

/**
 * Slots assigned to more than one row. Returns a Map from slot to the ids
 * assigned to it, containing only the conflicting slots (size >= 2 each).
 */
export function findSlotConflicts(assignments: { id: string; slot: number }[]): Map<number, string[]> {
  const bySlot = new Map<number, string[]>();
  for (const { id, slot } of assignments) {
    const ids = bySlot.get(slot) ?? [];
    ids.push(id);
    bySlot.set(slot, ids);
  }
  const conflicts = new Map<number, string[]>();
  for (const [slot, ids] of bySlot) {
    if (ids.length > 1) conflicts.set(slot, ids);
  }
  return conflicts;
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

/**
 * Compares a preset just written to the device (`expected`) against what
 * was read back (`actual`): patch name, every block's effectId/enabled and
 * only the params EFFECT_PARAMS defines for that effect (float tolerance
 * `tol`), routing order, and fxLoopSend/fxLoopReturn. Returns the first
 * mismatch found; does not attempt to report every difference.
 */
export function verifyWrite(expected: GP200Preset, actual: GP200Preset, tol = 1e-4): VerifyResult {
  if (expected.patchName.trim() !== actual.patchName.trim()) {
    return { ok: false, reason: 'patch name mismatch' };
  }
  if (expected.effects.length !== actual.effects.length) {
    return { ok: false, reason: 'block count mismatch' };
  }
  for (let i = 0; i < expected.effects.length; i++) {
    const exp = expected.effects[i];
    const act = actual.effects[i];
    if (exp.slotIndex !== act.slotIndex) {
      return { ok: false, reason: `routing mismatch at position ${i}` };
    }
    if (exp.effectId !== act.effectId) {
      return { ok: false, reason: `block ${exp.slotIndex} effect mismatch` };
    }
    if (exp.enabled !== act.enabled) {
      return { ok: false, reason: `block ${exp.slotIndex} enabled mismatch` };
    }
    const paramDefs = EFFECT_PARAMS[exp.effectId] ?? [];
    for (const def of paramDefs) {
      const expVal = exp.params[def.idx];
      const actVal = act.params[def.idx];
      if (expVal === undefined || actVal === undefined) continue;
      if (Math.abs(expVal - actVal) > tol) {
        return { ok: false, reason: `block ${exp.slotIndex} param "${def.name}" mismatch` };
      }
    }
  }
  if (expected.fxLoopSend !== actual.fxLoopSend) {
    return { ok: false, reason: 'FX loop send mismatch' };
  }
  if (expected.fxLoopReturn !== actual.fxLoopReturn) {
    return { ok: false, reason: 'FX loop return mismatch' };
  }
  return { ok: true };
}
