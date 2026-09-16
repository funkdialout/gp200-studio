# Library feature spec (branch `library`)

Add a persistent **preset library** to GP200 Studio with bulk write to device slots. Follow the existing code conventions exactly (React 19 + TS strict, Tailwind classes as used in neighbouring components, `@/components/ui/{Dialog,Button,Badge,Card}`, `PatchPicker`, `slotSelection.ts`, zod types in `core/types.ts`, oxlint clean, vitest tests next to existing ones under `tests/` or `src/**/*.test.ts` — check where current tests live and match). No new runtime dependencies (raw IndexedDB is fine; write a tiny typed wrapper in `src/core/libraryStore.ts`).

## Why
The owner has ~755 third-party `.prst` files (Choptones etc.) in nested pack folders and wants to keep them all in the browser, search/filter them, and load any selection into chosen device slots in one go — instead of one-at-a-time import in the Patch Manager.

## Data model — `src/core/libraryStore.ts`
IndexedDB db `gp200-studio`, store `library` keyed by `id`:
```ts
interface LibraryEntry {
  id: string;            // sha256 hex of bytes (dedupe: re-importing the same bytes is a no-op)
  bytes: Uint8Array;     // original .prst, unchanged (1176 or 1224)
  fileName: string;
  relPath: string;       // webkitRelativePath or fileName when imported as single files
  pack: string;          // first path segment of relPath ('' for single files); user-editable
  name: string;          // decoded patchName
  author: string;
  format: 1176 | 1224;
  ampName: string;       // real-world or Valeton name via existing effectNames helpers (whatever the app already shows in its info strip)
  cabName: string;       // same; for User IR cab: "User IR #n"
  usesUserIr: boolean;   // CAB effectId has sub-category byte 0x10 ((id>>16)&0xFF === 0x10); irSlot = (id & 0xFF) + 1
  irSlot: number | null;
  tags: string[];
  favorite: boolean;
  importedAt: number;
}
```
API: `putMany(entries)`, `getAll()`, `remove(ids)`, `update(id, patch)`, `clear()`. Decode with the existing `PRSTDecoder`; skip files that throw (report count). Hash with `crypto.subtle.digest`.

## UI — `src/components/LibrarySheet.tsx`
A sheet/dialog like `PatchManagerSheet` (same Dialog/anchor pattern, same look), opened from a **LIBRARY** button placed next to the existing Patch Manager entry point in `App.tsx` (find where the PATCHES / patch-manager button is rendered — desktop and, if there is a mobile menu, mobile too).

Contents:
1. Toolbar: **Import files** (`<input type=file multiple accept=.prst>`), **Import folder** (`<input type=file webkitdirectory>`; recurse; only `.prst`), search box (matches name/pack/amp/cab/fileName), pack `<select>`, "uses User IR" filter, format filter, sort (name/pack/amp/imported), count `selected/filtered/total`.
2. Table: checkbox, ★, Name, Pack, Amp, Cab, IR, Fmt. Row click selects; shift-click range; ctrl/cmd-click toggle; header checkbox = select all filtered. Row buttons: **Open in editor** (calls the existing `onImportFile(bytes)` flow, i.e. load into the editor buffer), **Export** (download the original bytes), **Delete**. Inline edit of pack/tags is a nice-to-have; skip if it bloats.
3. **Load to device…** button (enabled when connected and ≥1 selected) opens the assignment panel:
   - Start slot input (label like `41A`, use `SysExCodec.labelToSlot`) + **Fill from start** (sequential: 41A,41B,41C,41D,42A…), plus a per-row slot input so any row can be changed by hand; also allow picking the start slot from the existing `PatchPicker` if easy.
   - Each row shows the target slot's **current device name** (from `presetNames`, "?" if not loaded) so the user sees what gets overwritten.
   - Conflict detection (two rows → same slot) blocks the write.
   - **Write N patches**: sequential loop; for each row call the `onWriteToSlot(slot, bytes)` prop (App wires it to the existing `handleImportToSlot` path = `PRSTDecoder` → `midiDevice.pushPreset` flash upload, exactly what the Patch Manager's IMPORT button already does), then if `verify` checkbox is on (default on) call `onVerifySlot(slot, bytes)` which the App implements as `pullPreset(slot)` and compares: patchName, every block's effectId/enabled/params (float tol 1e-4, only compare params that are defined for that effect in `EFFECT_PARAMS`), routing (effects slotIndex order), fxLoopSend/Return. Per-row status: pending / writing / verifying / OK / FAIL(reason) / error. **Stop** aborts between rows. Progress bar. After the run, refresh names for the written slots (App can just set `presetNames[slot]` like `writePresetToSlot` does, or call `loadPresetNames`).
   - Disable everything else in the sheet while a write runs.
4. Footer stats + a "Clear library" with confirm.

Keep the sheet usable offline (import/search/export work without a device; only Load-to-device needs a connection).

## App wiring
- `App.tsx`: state `libraryOpen`; render `<LibrarySheet open connected presetNames onImportFile={handleFile} onWriteToSlot={...} onVerifySlot={...} .../>`; button to open it. Reuse `handleImportToSlot` for the write (extract a variant that throws instead of setting `loadError`, if needed).
- After a bulk write, the device's active slot is whatever `pushPreset` left it on; that's fine.

## Tests
- `libraryStore` (use `fake-indexeddb` only if already a devDep; otherwise unit-test the pure helpers: entry building from bytes, dedupe by id, filtering/sorting, sequential slot fill, conflict detection, verify-compare) against fixtures `ref/fixtures/*.prst` (copy from `/home/claude/gp200-librarian/ref/fixtures/` — `ATBL Rhythm.prst` 1224, `Creep Bass.prst` 1224; the 1176 sample `/home/claude/gp200-librarian/ref/fixtures/private/26-A KW - DOOM M.prst` may be used in tests but must NOT be committed — put it under a gitignored path and skip the test if absent).
- `npm run typecheck`, `npm run lint`, `npm run test` all green; `npm run build` green.

## Out of scope
IR/NAM upload, editing parameters from the library, cloud sync.
