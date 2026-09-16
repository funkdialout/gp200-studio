import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { SysExCodec } from '@/core/SysExCodec';
import { libraryStore } from '@/core/libraryStore';
import {
  buildLibraryEntry,
  dedupeEntries,
  fillSlotsFromStart,
  filterEntries,
  findSlotConflicts,
  packsOf,
  sortEntries,
  type LibraryEntry,
  type LibrarySortKey,
} from '@/core/library';

export interface LibraryVerifyResult {
  ok: boolean;
  reason?: string;
}

export interface LibrarySheetProps {
  open: boolean;
  onClose: () => void;
  connected: boolean;
  /** Device slot names (256 entries), for "current device name" in the assign panel. */
  presetNames: (string | null)[];
  /** Load a .prst into the editor buffer (pushes + saves when connected), same as
   *  the Patch Manager's FILE import. */
  onImportFile: (bytes: Uint8Array) => void;
  /** Flash-write `bytes` to `slot` (the same path the Patch Manager's per-slot
   *  IMPORT uses), throwing on failure. */
  onWriteToSlot: (slot: number, bytes: Uint8Array) => Promise<void>;
  /** Pull `slot` back and compare it against the bytes just written. */
  onVerifySlot: (slot: number, bytes: Uint8Array) => Promise<LibraryVerifyResult>;
}

type RowStatus = 'pending' | 'writing' | 'verifying' | 'ok' | 'fail' | 'error';

interface AssignRow {
  id: string;
  entry: LibraryEntry;
  slot: number | null;
  status: RowStatus;
  message?: string;
}

/** Trigger a browser download for an entry's original bytes. */
function downloadEntry(entry: LibraryEntry) {
  const blob = new Blob([entry.bytes as unknown as BlobPart], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = entry.fileName.endsWith('.prst') ? entry.fileName : `${entry.fileName}.prst`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Reads `files` (already filtered to .prst) into LibraryEntry rows, skipping ones that fail to decode. */
async function readEntries(
  files: { file: File; relPath: string }[],
): Promise<{ entries: LibraryEntry[]; failed: number }> {
  const entries: LibraryEntry[] = [];
  let failed = 0;
  for (const { file, relPath } of files) {
    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      entries.push(await buildLibraryEntry(buffer, file.name, relPath));
    } catch {
      failed++;
    }
  }
  return { entries, failed };
}

function statusLabel(status: RowStatus, message?: string): string {
  switch (status) {
    case 'pending': return 'pending';
    case 'writing': return 'writing…';
    case 'verifying': return 'verifying…';
    case 'ok': return 'OK';
    case 'fail': return `FAIL${message ? ` (${message})` : ''}`;
    case 'error': return `error${message ? ` (${message})` : ''}`;
    default: return status;
  }
}

/**
 * Persistent preset library: import loose .prst files or whole folders into
 * IndexedDB, search/filter/sort them, and bulk-write a selection into chosen
 * device slots. Import/search/export work offline; only "Load to device"
 * needs a connection. See LIBRARY-SPEC.md.
 */
export function LibrarySheet({
  open,
  onClose,
  connected,
  presetNames,
  onImportFile,
  onWriteToSlot,
  onVerifySlot,
}: LibrarySheetProps) {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [packFilter, setPackFilter] = useState('');
  const [irFilter, setIrFilter] = useState<'all' | 'yes' | 'no'>('all');
  const [formatFilter, setFormatFilter] = useState<'all' | 1176 | 1224>('all');
  const [sortKey, setSortKey] = useState<LibrarySortKey>('name');

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [anchorId, setAnchorId] = useState<string | null>(null);

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignRows, setAssignRows] = useState<AssignRow[]>([]);
  const [startSlotLabel, setStartSlotLabel] = useState('1A');
  const [verifyOn, setVerifyOn] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const stopRef = useRef(false);

  const [clearConfirm, setClearConfirm] = useState(false);

  const filesInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Load once on first open; the store is the source of truth thereafter,
  // updated locally after every mutation rather than re-read each time.
  useEffect(() => {
    if (!open || loaded) return;
    void libraryStore.getAll().then((all) => {
      setEntries(all);
      setLoaded(true);
    });
  }, [open, loaded]);

  const packs = useMemo(() => packsOf(entries), [entries]);
  const filtered = useMemo(() => {
    const filters = {
      query,
      pack: packFilter || undefined,
      usesUserIr: irFilter === 'all' ? undefined : irFilter === 'yes',
      format: formatFilter === 'all' ? undefined : formatFilter,
    };
    return sortEntries(filterEntries(entries, filters), sortKey);
  }, [entries, query, packFilter, irFilter, formatFilter, sortKey]);

  const filteredIds = useMemo(() => filtered.map((e) => e.id), [filtered]);
  const selectedCount = selectedIds.size;

  async function reload() {
    setEntries(await libraryStore.getAll());
  }

  async function handleFilesPicked(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = [...fileList]
      .filter((f) => f.name.toLowerCase().endsWith('.prst'))
      .map((file) => ({ file, relPath: file.name }));
    const { entries: built, failed } = await readEntries(files);
    const unique = dedupeEntries(built);
    await libraryStore.putMany(unique);
    await reload();
    let msg = `Imported ${unique.length} patch${unique.length === 1 ? '' : 'es'}`;
    if (failed > 0) msg += `, ${failed} file${failed === 1 ? '' : 's'} skipped`;
    setImportMessage(msg);
  }

  async function handleFolderPicked(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = [...fileList]
      .filter((f) => f.name.toLowerCase().endsWith('.prst'))
      .map((file) => ({
        file,
        relPath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
      }));
    const { entries: built, failed } = await readEntries(files);
    const unique = dedupeEntries(built);
    await libraryStore.putMany(unique);
    await reload();
    let msg = `Imported ${unique.length} patch${unique.length === 1 ? '' : 'es'} from folder`;
    if (failed > 0) msg += `, ${failed} file${failed === 1 ? '' : 's'} skipped`;
    setImportMessage(msg);
  }

  function toggleSelect(id: string, modifiers?: { shift: boolean; toggle: boolean }) {
    setSelectedIds((prev) => {
      if (modifiers?.shift && anchorId !== null) {
        const from = filteredIds.indexOf(anchorId);
        const to = filteredIds.indexOf(id);
        if (from === -1 || to === -1) return new Set(prev).add(id);
        const [lo, hi] = from < to ? [from, to] : [to, from];
        const next = new Set(prev);
        for (let i = lo; i <= hi; i++) next.add(filteredIds[i]);
        return next;
      }
      if (modifiers?.toggle) {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }
      return new Set([id]);
    });
    setAnchorId(id);
  }

  function toggleSelectAllFiltered() {
    setSelectedIds((prev) => {
      const allSelected = filteredIds.length > 0 && filteredIds.every((id) => prev.has(id));
      return allSelected ? new Set() : new Set(filteredIds);
    });
  }

  async function handleDelete(id: string) {
    await libraryStore.remove([id]);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    await reload();
  }

  async function handleClearLibrary() {
    await libraryStore.clear();
    setEntries([]);
    setSelectedIds(new Set());
    setClearConfirm(false);
  }

  function handleOpenInEditor(entry: LibraryEntry) {
    onImportFile(entry.bytes);
    onClose();
  }

  // ── Load-to-device assignment panel ─────────────────────────────────
  function openAssignPanel() {
    const rows: AssignRow[] = filtered
      .filter((e) => selectedIds.has(e.id))
      .map((entry) => ({ id: entry.id, entry, slot: null, status: 'pending' }));
    setAssignRows(rows);
    setAssignOpen(true);
  }

  function fillFromStart() {
    let start: number;
    try {
      start = SysExCodec.labelToSlot(startSlotLabel.trim().toUpperCase());
    } catch {
      return;
    }
    const slots = fillSlotsFromStart(start, assignRows.length);
    setAssignRows((prev) => prev.map((row, i) => ({ ...row, slot: slots[i] ?? null })));
  }

  function setRowSlot(id: string, label: string) {
    let slot: number | null = null;
    try {
      slot = SysExCodec.labelToSlot(label.trim().toUpperCase());
    } catch {
      slot = null;
    }
    setAssignRows((prev) => prev.map((row) => (row.id === id ? { ...row, slot } : row)));
  }

  const conflicts = useMemo(() => {
    const assignments = assignRows
      .filter((r): r is AssignRow & { slot: number } => r.slot !== null)
      .map((r) => ({ id: r.id, slot: r.slot }));
    return findSlotConflicts(assignments);
  }, [assignRows]);

  const canWrite =
    connected
    && !running
    && assignRows.length > 0
    && assignRows.every((r) => r.slot !== null)
    && conflicts.size === 0;

  async function runWrite() {
    if (!canWrite) return;
    setRunning(true);
    stopRef.current = false;
    setProgress({ done: 0, total: assignRows.length });
    for (let i = 0; i < assignRows.length; i++) {
      if (stopRef.current) break;
      const row = assignRows[i];
      if (row.slot === null) continue;
      setAssignRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: 'writing' } : r)));
      try {
        await onWriteToSlot(row.slot, row.entry.bytes);
        if (verifyOn) {
          setAssignRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: 'verifying' } : r)));
          const result = await onVerifySlot(row.slot, row.entry.bytes);
          setAssignRows((prev) => prev.map((r) => (r.id === row.id
            ? { ...r, status: result.ok ? 'ok' : 'fail', message: result.reason }
            : r)));
        } else {
          setAssignRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: 'ok' } : r)));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setAssignRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: 'error', message } : r)));
      }
      setProgress({ done: i + 1, total: assignRows.length });
    }
    setRunning(false);
  }

  function stopWrite() {
    stopRef.current = true;
  }

  const busy = running;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Preset Library"
      placement="right"
      maxWidth="max-w-3xl"
      padding="p-0"
      className="flex flex-col"
      closeOnOverlayClick={!busy}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-active)' }}
      >
        <span className="font-mono-display font-bold" style={{ color: 'var(--text-primary)' }}>
          LIBRARY
        </span>
        <span className="font-mono-display text-caption" style={{ color: 'var(--text-muted)' }}>
          {selectedCount}/{filtered.length}/{entries.length}
        </span>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="ml-auto disabled:opacity-40"
          aria-label="Close library"
          style={{ color: 'var(--text-muted)' }}
        >
          ✕
        </button>
      </div>

      {/* Toolbar */}
      <div
        className="flex flex-wrap items-center gap-2 px-4 py-2 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-active)' }}
      >
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => filesInputRef.current?.click()}
          title="Import one or more .prst files"
        >
          IMPORT FILES
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => folderInputRef.current?.click()}
          title="Import every .prst in a folder (recursively)"
        >
          IMPORT FOLDER
        </Button>
        <input
          ref={filesInputRef}
          type="file"
          accept=".prst"
          multiple
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => { void handleFilesPicked(e.target.files); e.target.value = ''; }}
        />
        <input
          ref={folderInputRef}
          type="file"
          // @ts-expect-error non-standard attribute, no TS lib entry
          webkitdirectory=""
          directory=""
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => { void handleFolderPicked(e.target.files); e.target.value = ''; }}
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name / pack / amp / cab / file…"
          aria-label="Search library"
          className="font-mono-display text-sm rounded px-2 py-1 flex-1 min-w-[10rem]"
          style={{
            background: 'rgba(0,0,0,0.05)',
            border: '1px solid rgba(0,0,0,0.12)',
            color: 'var(--text-primary)',
          }}
        />
        <select
          value={packFilter}
          onChange={(e) => setPackFilter(e.target.value)}
          aria-label="Filter by pack"
          className="font-mono-display text-caption rounded px-1.5 py-1"
          style={{ border: '1px solid rgba(0,0,0,0.20)', color: 'var(--text-secondary)' }}
        >
          <option value="">All packs</option>
          {packs.map((pack) => (
            <option key={pack || '__unfiled__'} value={pack}>{pack || '(unfiled)'}</option>
          ))}
        </select>
        <select
          value={irFilter}
          onChange={(e) => setIrFilter(e.target.value as 'all' | 'yes' | 'no')}
          aria-label="Filter by User IR"
          className="font-mono-display text-caption rounded px-1.5 py-1"
          style={{ border: '1px solid rgba(0,0,0,0.20)', color: 'var(--text-secondary)' }}
        >
          <option value="all">Any cab</option>
          <option value="yes">Uses User IR</option>
          <option value="no">Built-in cab</option>
        </select>
        <select
          value={formatFilter}
          onChange={(e) => setFormatFilter(e.target.value === 'all' ? 'all' : (Number(e.target.value) as 1176 | 1224))}
          aria-label="Filter by format"
          className="font-mono-display text-caption rounded px-1.5 py-1"
          style={{ border: '1px solid rgba(0,0,0,0.20)', color: 'var(--text-secondary)' }}
        >
          <option value="all">Any format</option>
          <option value={1224}>1224 (user)</option>
          <option value={1176}>1176 (factory)</option>
        </select>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as LibrarySortKey)}
          aria-label="Sort by"
          className="font-mono-display text-caption rounded px-1.5 py-1"
          style={{ border: '1px solid rgba(0,0,0,0.20)', color: 'var(--text-secondary)' }}
        >
          <option value="name">Sort: Name</option>
          <option value="pack">Sort: Pack</option>
          <option value="amp">Sort: Amp</option>
          <option value="imported">Sort: Imported</option>
        </select>
      </div>

      {importMessage && (
        <p className="font-mono-display text-caption px-4 py-1.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
          {importMessage}
        </p>
      )}

      {!connected && (
        <p className="font-mono-display text-caption px-4 py-2 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
          Import, search and export work offline. Connect the GP-200 to load patches onto it.
        </p>
      )}

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
        <table className="w-full font-mono-display text-caption" style={{ color: 'var(--text-secondary)' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-active)' }}>
              <th className="text-left py-1 px-1">
                <input
                  type="checkbox"
                  aria-label="Select all filtered"
                  checked={filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id))}
                  onChange={toggleSelectAllFiltered}
                />
              </th>
              <th className="text-left py-1 px-1">★</th>
              <th className="text-left py-1 px-1">Name</th>
              <th className="text-left py-1 px-1">Pack</th>
              <th className="text-left py-1 px-1">Amp</th>
              <th className="text-left py-1 px-1">Cab</th>
              <th className="text-left py-1 px-1">IR</th>
              <th className="text-left py-1 px-1">Fmt</th>
              <th className="text-left py-1 px-1">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry) => {
              const isSelected = selectedIds.has(entry.id);
              return (
                <tr
                  key={entry.id}
                  onClick={(e) => toggleSelect(entry.id, { shift: e.shiftKey, toggle: e.ctrlKey || e.metaKey })}
                  style={{
                    cursor: 'pointer',
                    background: isSelected ? 'var(--glow-accent, rgba(0,0,0,0.06))' : undefined,
                    borderBottom: '1px solid rgba(0,0,0,0.06)',
                  }}
                >
                  <td className="py-1 px-1" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${entry.name || entry.fileName}`}
                      checked={isSelected}
                      onChange={() => toggleSelect(entry.id, { shift: false, toggle: true })}
                    />
                  </td>
                  <td className="py-1 px-1">{entry.favorite ? '★' : ''}</td>
                  <td className="py-1 px-1 truncate max-w-[10rem]" style={{ color: 'var(--text-primary)' }}>
                    {entry.name || entry.fileName}
                  </td>
                  <td className="py-1 px-1 truncate max-w-[8rem]">{entry.pack || '—'}</td>
                  <td className="py-1 px-1 truncate max-w-[8rem]">{entry.ampName || '—'}</td>
                  <td className="py-1 px-1 truncate max-w-[8rem]">{entry.cabName || '—'}</td>
                  <td className="py-1 px-1">{entry.usesUserIr ? `#${entry.irSlot}` : ''}</td>
                  <td className="py-1 px-1">{entry.format}</td>
                  <td className="py-1 px-1 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="ghost" onClick={() => handleOpenInEditor(entry)} title="Load into the editor">
                      OPEN
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => downloadEntry(entry)} title="Download the original file">
                      EXPORT
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void handleDelete(entry.id)} title="Remove from the library">
                      DELETE
                    </Button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="py-4 text-center" style={{ color: 'var(--text-muted)' }}>
                  No patches match. Import files or a folder to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div
        className="flex items-center gap-2 px-4 py-3 flex-shrink-0"
        style={{ borderTop: '1px solid var(--border-active)' }}
      >
        <Button
          disabled={!connected || selectedCount === 0 || busy}
          onClick={openAssignPanel}
          title="Assign the selected patches to device slots and write them"
        >
          LOAD TO DEVICE…
        </Button>
        <span className="font-mono-display text-caption" style={{ color: 'var(--text-muted)' }}>
          {entries.length} in library
        </span>
        {!clearConfirm && (
          <Button size="sm" variant="ghost" className="ml-auto" disabled={busy || entries.length === 0} onClick={() => setClearConfirm(true)}>
            CLEAR LIBRARY
          </Button>
        )}
        {clearConfirm && (
          <span className="ml-auto flex items-center gap-2">
            <span className="font-mono-display text-caption" style={{ color: 'var(--accent-red, #c05050)' }}>
              Delete all {entries.length} patches?
            </span>
            <Button size="sm" variant="ghost" onClick={() => setClearConfirm(false)}>Cancel</Button>
            <Button size="sm" variant="danger" onClick={() => void handleClearLibrary()}>Delete</Button>
          </span>
        )}
      </div>

      {/* Load-to-device assignment panel */}
      {assignOpen && (
        <div
          role="dialog"
          aria-label="Load to device"
          className="px-4 py-3 flex-shrink-0 space-y-2"
          style={{ borderTop: '2px solid var(--border-active)', maxHeight: '50vh', overflowY: 'auto' }}
        >
          <div className="flex items-center justify-between">
            <span className="font-mono-display font-bold" style={{ color: 'var(--text-primary)' }}>
              LOAD {assignRows.length} TO DEVICE
            </span>
            <button
              type="button"
              onClick={() => { if (!running) setAssignOpen(false); }}
              disabled={running}
              className="disabled:opacity-40"
              aria-label="Close assignment panel"
              style={{ color: 'var(--text-muted)' }}
            >
              ✕
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="font-mono-display text-caption flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
              Start slot
              <input
                value={startSlotLabel}
                onChange={(e) => setStartSlotLabel(e.target.value.toUpperCase())}
                disabled={running}
                className="font-mono-display text-sm rounded px-2 py-1 w-16"
                style={{ background: 'rgba(0,0,0,0.05)', border: '1px solid rgba(0,0,0,0.12)', color: 'var(--text-primary)' }}
              />
            </label>
            <Button size="sm" variant="secondary" disabled={running} onClick={fillFromStart}>
              FILL FROM START
            </Button>
            <label className="font-mono-display text-caption flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
              <input type="checkbox" checked={verifyOn} disabled={running} onChange={(e) => setVerifyOn(e.target.checked)} />
              verify
            </label>
            {conflicts.size > 0 && (
              <span className="font-mono-display text-caption" style={{ color: 'var(--accent-red, #c05050)' }}>
                {conflicts.size} slot conflict{conflicts.size === 1 ? '' : 's'}
              </span>
            )}
          </div>

          <div className="space-y-1">
            {assignRows.map((row) => {
              const conflicted = row.slot !== null && conflicts.has(row.slot);
              const currentName = row.slot !== null ? (presetNames[row.slot] ?? '?') : '?';
              return (
                <div key={row.id} className="flex items-center gap-2 font-mono-display text-caption">
                  <span className="truncate flex-1" style={{ color: 'var(--text-primary)' }}>
                    {row.entry.name || row.entry.fileName}
                  </span>
                  <input
                    value={row.slot !== null ? SysExCodec.slotToLabel(row.slot) : ''}
                    onChange={(e) => setRowSlot(row.id, e.target.value)}
                    disabled={running}
                    aria-label={`Target slot for ${row.entry.name || row.entry.fileName}`}
                    className="rounded px-1.5 py-0.5 w-14"
                    style={{
                      background: 'rgba(0,0,0,0.05)',
                      border: `1px solid ${conflicted ? 'var(--accent-red, #c05050)' : 'rgba(0,0,0,0.12)'}`,
                      color: 'var(--text-primary)',
                    }}
                  />
                  <span style={{ color: 'var(--text-muted)' }}>→ {currentName}</span>
                  <span
                    style={{
                      color: row.status === 'ok' ? 'var(--accent-green, #4a8a5a)'
                        : row.status === 'fail' || row.status === 'error' ? 'var(--accent-red, #c05050)'
                        : 'var(--text-muted)',
                    }}
                  >
                    {statusLabel(row.status, row.message)}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <Button disabled={!canWrite} onClick={() => void runWrite()}>
              WRITE {assignRows.length} PATCHES
            </Button>
            {running && (
              <>
                <span className="font-mono-display text-caption" style={{ color: 'var(--text-muted)' }}>
                  {progress.done}/{progress.total}
                </span>
                <Button size="sm" variant="danger" onClick={stopWrite}>STOP</Button>
              </>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
