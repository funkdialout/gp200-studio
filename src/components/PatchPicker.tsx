import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { SysExCodec } from '@/core/SysExCodec';
import { PATCH_STYLES, patchStyleName } from '@/core/patchStyles';

export interface PatchPickerProps {
  presetNames: (string | null)[];
  presetStyles: (number | null)[];
  namesLoadProgress: number;
  currentSlot: number | null;
  /** single-select highlight (the anchor row) */
  selected: number | null;
  /** Extra rows painted as selected. Omit for hosts that only single-select. */
  multiSelected?: ReadonlySet<number>;
  /** Modifiers let a host build shift-ranges and ctrl-toggles; hosts that
   *  only single-select can ignore the second argument. */
  onSelect: (slot: number, modifiers?: { shift: boolean; toggle: boolean }) => void;
  /** double-click / Enter confirm */
  onActivate?: (slot: number) => void;
}

interface PatchRow {
  slot: number;
  label: string;
  bank: number;
  name: string | null;
  style: number | null;
}

interface BankCategory {
  bank: number;
  /** Named slots normally; matching slots when a style is selected. */
  count: number;
}

interface BankGroup {
  bank: number;
  rows: PatchRow[];
}

const ALL = -1;
const TOTAL_SLOTS = 256;

/** All 256 slots decorated with their bank + label. */
function buildRows(presetNames: (string | null)[], presetStyles: (number | null)[]): PatchRow[] {
  return Array.from({ length: TOTAL_SLOTS }, (_unused, slot) => ({
    slot,
    label: SysExCodec.slotToLabel(slot),
    bank: Math.floor(slot / 4) + 1,
    name: presetNames[slot] ?? null,
    style: presetStyles[slot] ?? null,
  }));
}

/** One rail entry per bank, carrying its count of named slots. */
function buildBankCategories(rows: PatchRow[], countAll: boolean): BankCategory[] {
  const counts = new Map<number, number>();
  for (const row of rows) {
    if (countAll || row.name !== null) counts.set(row.bank, (counts.get(row.bank) ?? 0) + 1);
  }
  return Array.from({ length: 64 }, (_unused, index) => {
    const bank = index + 1;
    return { bank, count: counts.get(bank) ?? 0 };
  });
}

function matchesQuery(row: PatchRow, query: string): boolean {
  if (!query) return true;
  const haystack = `${row.name ?? ''} ${row.label}`.toLowerCase();
  return haystack.includes(query);
}

/** Bucket visible rows by bank, in ascending bank order. */
function groupRows(rows: PatchRow[]): BankGroup[] {
  const byBank = new Map<number, PatchRow[]>();
  for (const row of rows) {
    const bucket = byBank.get(row.bank) ?? [];
    bucket.push(row);
    byBank.set(row.bank, bucket);
  }
  const banks = [...byBank.keys()].sort((first, second) => first - second);
  return banks.map((bank) => ({ bank, rows: byBank.get(bank)! }));
}

function bankLabel(bank: number): string {
  return `BANK ${String(bank).padStart(2, '0')}`;
}

function slotName(name: string | null, namesLoadProgress: number): string {
  if (name !== null) return name;
  if (namesLoadProgress < TOTAL_SLOTS) return '…';
  return '-';
}

/**
 * Rich patch browser: a bank rail + search + scrolling list of labelled
 * rows, modelled on EffectPicker. Presentational: selection lives in the
 * host (DeviceSlotBrowser modal, PatchManagerSheet side sheet).
 */
export function PatchPicker({
  presetNames,
  presetStyles,
  namesLoadProgress,
  currentSlot,
  selected,
  multiSelected,
  onSelect,
  onActivate,
}: PatchPickerProps) {
  const rows = useMemo(() => buildRows(presetNames, presetStyles), [presetNames, presetStyles]);
  const [styleFilter, setStyleFilter] = useState<number | null>(null);
  const styleRows = useMemo(
    () => styleFilter === null ? rows : rows.filter((row) => row.style === styleFilter),
    [rows, styleFilter],
  );
  const categories = useMemo(
    () => buildBankCategories(styleRows, styleFilter !== null),
    [styleRows, styleFilter],
  );
  const totalCount = useMemo(
    () => styleFilter === null ? rows.filter((row) => row.name !== null).length : styleRows.length,
    [rows, styleRows, styleFilter],
  );
  const stylesKnown = useMemo(() => rows.filter((row) => row.style !== null).length, [rows]);

  const [bank, setBank] = useState(ALL);
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  // bring the selected (or current) slot into view when the list first renders
  useEffect(() => {
    const node = selectedRef.current;
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'center' });
    }
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleRows = styleRows.filter((row) => {
    const inBank = bank === ALL || row.bank === bank || normalizedQuery !== '';
    return inBank && matchesQuery(row, normalizedQuery);
  });
  const groups = groupRows(visibleRows);

  function railClass(target: number): string {
    const classes = ['pp-cat'];
    if (bank === target && normalizedQuery === '') classes.push('active');
    return classes.join(' ');
  }

  function handleActivate(slot: number) {
    onActivate?.(slot);
  }

  // ↑/↓ move focus between visible rows; Home/End jump to the ends
  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const foundRows = listRef.current?.querySelectorAll<HTMLButtonElement>('.pp-row');
    const buttons = [...(foundRows ?? [])];
    if (buttons.length === 0) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const targets: Record<string, number> = {
      ArrowDown: Math.min(current + 1, buttons.length - 1),
      ArrowUp: Math.max(current - 1, 0),
      Home: 0,
      End: buttons.length - 1,
    };
    buttons[targets[event.key]]?.focus();
  }

  return (
    <div className="patch-picker">
      <header className="pp-head">
        <input
          className="pp-search"
          type="search"
          placeholder="Search patches or slot (e.g. 63B)…"
          value={query}
          aria-label="Search patches"
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          className="pp-style-filter"
          aria-label="Filter patches by style"
          value={styleFilter === null ? 'all' : String(styleFilter)}
          onChange={(event) => {
            setStyleFilter(event.target.value === 'all' ? null : Number(event.target.value));
            setBank(ALL);
          }}
        >
          <option value="all">All styles</option>
          {PATCH_STYLES.map((style, index) => (
            <option key={index} value={index}>{index === 0 ? 'No style' : style}</option>
          ))}
        </select>
      </header>

      {styleFilter !== null && stylesKnown < TOTAL_SLOTS && (
        <p className="pp-style-progress" role="status">
          Styles known for {stylesKnown}/{TOTAL_SLOTS} slots; matches may appear as the device scan continues.
        </p>
      )}

      <div className="pp-body">
        <nav className="pp-rail" aria-label="Patch banks">
          <button type="button" className={railClass(ALL)} onClick={() => setBank(ALL)}>
            <span>All banks</span>
            <span className="pp-cat-count">{totalCount}</span>
          </button>
          {categories.filter((category) => styleFilter === null || category.count > 0).map((category) => (
            <button
              key={category.bank}
              type="button"
              className={railClass(category.bank)}
              onClick={() => setBank(category.bank)}
            >
              <span>{bankLabel(category.bank)}</span>
              <span className="pp-cat-count">{category.count}</span>
            </button>
          ))}
        </nav>

        <div className="pp-list" ref={listRef} onKeyDown={handleListKeyDown}>
          {groups.length === 0 && (
            <p className="pp-empty">
              No patches match the current search and style filter.
            </p>
          )}
          {groups.map((group) => (
            <section key={group.bank} className="pp-group">
              <h3 className="pp-group-head">{bankLabel(group.bank)}</h3>
              {group.rows.map((row) => {
                const isAnchor = row.slot === selected;
                const isSelected = isAnchor || (multiSelected?.has(row.slot) ?? false);
                const isCurrent = row.slot === currentSlot;
                const rowClasses = ['pp-row'];
                if (isSelected) rowClasses.push('selected');
                if (isCurrent) rowClasses.push('current');
                return (
                  <button
                    key={row.slot}
                    type="button"
                    ref={(node) => {
                      if (isAnchor || (selected === null && isCurrent)) {
                        selectedRef.current = node;
                      }
                    }}
                    className={rowClasses.join(' ')}
                    aria-current={isAnchor}
                    aria-selected={isSelected}
                    onClick={(event) => onSelect(row.slot, {
                      shift: event.shiftKey,
                      toggle: event.ctrlKey || event.metaKey,
                    })}
                    onDoubleClick={() => handleActivate(row.slot)}
                  >
                    <span className="pp-badge">{row.label}</span>
                    <span className="pp-name">{slotName(row.name, namesLoadProgress)}</span>
                    {row.style !== null && row.style !== 0 && (
                      <span className="pp-style">{patchStyleName(row.style)}</span>
                    )}
                    {isCurrent && <span className="pp-now">NOW</span>}
                  </button>
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
