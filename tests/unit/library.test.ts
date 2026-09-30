import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  buildLibraryEntry,
  dedupeEntries,
  fillSlotsFromStart,
  filterEntries,
  findSlotConflicts,
  hashBytes,
  packOf,
  packsOf,
  sortEntries,
  verifyWrite,
  type LibraryEntry,
} from '@/core/library';
import type { GP200Preset } from '@/core/types';
import { createDefaultPreset } from '@/core/defaultPreset';

const ATBL_PATH = join(process.cwd(), 'ref/fixtures/ATBL Rhythm.prst');
const CREEP_PATH = join(process.cwd(), 'ref/fixtures/Creep Bass.prst');
// Never committed (see .gitignore); skip the tests that need it if absent.
const KW_PATH = join(process.cwd(), 'ref/fixtures/private/26-A KW - DOOM M.prst');

function fixtureBytes(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path));
}

describe('hashBytes', () => {
  it('is deterministic and content-addressed', async () => {
    const a = await hashBytes(new Uint8Array([1, 2, 3]));
    const b = await hashBytes(new Uint8Array([1, 2, 3]));
    const c = await hashBytes(new Uint8Array([1, 2, 4]));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('packOf', () => {
  it('takes the first path segment', () => {
    expect(packOf('Choptones EVH/40-A EVH 78 Rhythm.prst')).toBe('Choptones EVH');
  });
  it('is empty for a bare filename', () => {
    expect(packOf('Creep Bass.prst')).toBe('');
  });
});

describe('buildLibraryEntry', () => {
  it.skipIf(!existsSync(ATBL_PATH))('decodes a real 1224-byte .prst into an entry', async () => {
    const bytes = fixtureBytes(ATBL_PATH);
    const entry = await buildLibraryEntry(bytes, 'ATBL Rhythm.prst', 'Some Pack/ATBL Rhythm.prst');
    expect(entry.name).toBe('ATBL Rhythm');
    expect(entry.author).toBe('RR');
    expect(entry.format).toBe(1224);
    expect(entry.pack).toBe('Some Pack');
    expect(entry.relPath).toBe('Some Pack/ATBL Rhythm.prst');
    expect(entry.ampName).toBe('UK SLP');
    expect(entry.cabName).toBe('UK GRN 2');
    expect(entry.usesUserIr).toBe(false);
    expect(entry.irSlot).toBeNull();
    expect(entry.bytes).toBe(bytes);
    expect(entry.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it.skipIf(!existsSync(CREEP_PATH))('falls back to the bare filename as pack/relPath for single-file imports', async () => {
    const bytes = fixtureBytes(CREEP_PATH);
    const entry = await buildLibraryEntry(bytes, 'Creep Bass.prst', 'Creep Bass.prst');
    expect(entry.name).toBe('Creep Bass');
    expect(entry.pack).toBe('');
    expect(entry.ampName).toBe('Classic Bass');
    expect(entry.cabName).toBe('AMPG 2');
    expect(entry.usesUserIr).toBe(false);
  });

  it.skipIf(!existsSync(KW_PATH))('detects a User IR cab and its slot number (1176-byte factory-style file)', async () => {
    const bytes = fixtureBytes(KW_PATH);
    const entry = await buildLibraryEntry(bytes, '26-A KW - DOOM M.prst', '26-A KW - DOOM M.prst');
    expect(entry.format).toBe(1176);
    expect(entry.usesUserIr).toBe(true);
    expect(entry.irSlot).toBe(6);
    expect(entry.cabName).toBe('User IR #6');
  });

  it('throws (does not swallow) on bytes that are not a valid .prst', async () => {
    await expect(buildLibraryEntry(new Uint8Array(10), 'bad.prst', 'bad.prst')).rejects.toThrow();
  });

  it.skipIf(!existsSync(ATBL_PATH))('re-importing identical bytes yields the same id (dedupe key)', async () => {
    const bytes = fixtureBytes(ATBL_PATH);
    const first = await buildLibraryEntry(bytes, 'a.prst', 'a.prst');
    const second = await buildLibraryEntry(bytes, 'renamed.prst', 'Other Pack/renamed.prst');
    expect(first.id).toBe(second.id);
  });
});

function makeEntry(overrides: Partial<LibraryEntry>): LibraryEntry {
  return {
    id: 'id',
    bytes: new Uint8Array(),
    fileName: 'x.prst',
    relPath: 'x.prst',
    pack: '',
    name: 'X',
    author: '',
    format: 1224,
    ampName: '',
    cabName: '',
    usesUserIr: false,
    irSlot: null,
    tags: [],
    favorite: false,
    importedAt: 0,
    ...overrides,
  };
}

describe('dedupeEntries', () => {
  it('keeps the first occurrence of each id', () => {
    const a = makeEntry({ id: '1', name: 'first' });
    const b = makeEntry({ id: '1', name: 'second' });
    const c = makeEntry({ id: '2', name: 'third' });
    expect(dedupeEntries([a, b, c])).toEqual([a, c]);
  });
});

describe('filterEntries / sortEntries / packsOf', () => {
  const entries = [
    makeEntry({ id: '1', name: 'Beta', pack: 'PackA', ampName: 'UK SLP', usesUserIr: false, format: 1224, importedAt: 10, fileName: 'beta.prst' }),
    makeEntry({ id: '2', name: 'Alpha', pack: 'PackB', ampName: 'Classic Bass', usesUserIr: true, format: 1176, importedAt: 30, fileName: 'alpha.prst' }),
    makeEntry({ id: '3', name: 'Gamma', pack: '', ampName: 'UK 50', usesUserIr: false, format: 1224, importedAt: 20, fileName: 'gamma.prst' }),
  ];

  it('matches the query against name/pack/amp/cab/fileName', () => {
    expect(filterEntries(entries, { query: 'alpha' }).map((e) => e.id)).toEqual(['2']);
    expect(filterEntries(entries, { query: 'packa' }).map((e) => e.id)).toEqual(['1']);
    expect(filterEntries(entries, { query: 'classic bass' }).map((e) => e.id)).toEqual(['2']);
  });

  it('filters by pack, User IR and format independently', () => {
    expect(filterEntries(entries, { pack: 'PackB' }).map((e) => e.id)).toEqual(['2']);
    expect(filterEntries(entries, { usesUserIr: true }).map((e) => e.id)).toEqual(['2']);
    expect(filterEntries(entries, { format: 1176 }).map((e) => e.id)).toEqual(['2']);
  });

  it('sorts by name, pack, amp and imported-at', () => {
    expect(sortEntries(entries, 'name').map((e) => e.id)).toEqual(['2', '1', '3']);
    expect(sortEntries(entries, 'pack').map((e) => e.id)).toEqual(['3', '1', '2']);
    expect(sortEntries(entries, 'imported').map((e) => e.id)).toEqual(['2', '3', '1']);
  });

  it('lists distinct packs with unfiled ("") sorted first', () => {
    expect(packsOf(entries)).toEqual(['', 'PackA', 'PackB']);
  });
});

describe('fillSlotsFromStart', () => {
  it('fills sequentially from the given slot', () => {
    // 41A = bank 41, letter A -> slot (41-1)*4 = 160
    expect(fillSlotsFromStart(160, 5)).toEqual([160, 161, 162, 163, 164]);
  });

  it('stops rather than wrapping past slot 255', () => {
    expect(fillSlotsFromStart(253, 5)).toEqual([253, 254, 255]);
  });
});

describe('findSlotConflicts', () => {
  it('reports only slots assigned more than once', () => {
    const conflicts = findSlotConflicts([
      { id: 'a', slot: 1 },
      { id: 'b', slot: 2 },
      { id: 'c', slot: 1 },
    ]);
    expect([...conflicts.keys()]).toEqual([1]);
    expect(conflicts.get(1)?.sort()).toEqual(['a', 'c']);
  });

  it('is empty when every slot is unique', () => {
    const conflicts = findSlotConflicts([{ id: 'a', slot: 1 }, { id: 'b', slot: 2 }]);
    expect(conflicts.size).toBe(0);
  });
});

describe('verifyWrite', () => {
  function preset(): GP200Preset {
    return createDefaultPreset();
  }

  it('passes when the read-back preset matches', () => {
    const p = preset();
    expect(verifyWrite(p, p)).toEqual({ ok: true });
  });

  it('fails on a patch name mismatch', () => {
    const expected = preset();
    const actual = { ...preset(), patchName: 'Different' };
    const result = verifyWrite(expected, actual);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/patch name/);
  });

  it('fails on a routing (slot order) mismatch', () => {
    const expected = preset();
    const actual = { ...preset(), effects: [...preset().effects].reverse() };
    const result = verifyWrite(expected, actual);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/routing/);
  });

  it('fails on an effect id mismatch', () => {
    const expected = preset();
    const actual = preset();
    actual.effects[0] = { ...actual.effects[0], effectId: actual.effects[0].effectId + 1 };
    const result = verifyWrite(expected, actual);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/effect mismatch/);
  });

  it('tolerates float noise within 1e-4 but not beyond it', () => {
    const expected = preset();
    // Block 0's first param needs an EFFECT_PARAMS entry for this to be exercised;
    // params are compared only when EFFECT_PARAMS defines them for the effectId.
    const closeEnough = preset();
    closeEnough.effects[0] = {
      ...closeEnough.effects[0],
      params: closeEnough.effects[0].params.map((v, i) => (i === 0 ? v + 0.00001 : v)),
    };
    expect(verifyWrite(expected, closeEnough).ok).toBe(true);

    const tooFar = preset();
    tooFar.effects[0] = {
      ...tooFar.effects[0],
      params: tooFar.effects[0].params.map((v, i) => (i === 0 ? v + 1 : v)),
    };
    const result = verifyWrite(expected, tooFar);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/param/);
  });

  it('fails on an FX-loop send/return mismatch', () => {
    const expected = preset();
    const actual = { ...preset(), fxLoopSend: expected.fxLoopSend + 1 };
    const result = verifyWrite(expected, actual);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/FX loop send/);
  });
});
