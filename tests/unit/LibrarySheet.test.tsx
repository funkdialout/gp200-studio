import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LibrarySheet } from '@/components/LibrarySheet';
import type { LibraryEntry } from '@/core/library';

// jsdom has no IndexedDB; the store itself is exercised indirectly through
// this mock (LIBRARY-SPEC.md: unit-test the pure helpers when fake-indexeddb
// isn't already a devDep, which it isn't here).
vi.mock('@/core/libraryStore', () => ({
  libraryStore: {
    getAll: vi.fn(),
    putMany: vi.fn(),
    remove: vi.fn(),
    update: vi.fn(),
    clear: vi.fn(),
  },
}));

import { libraryStore } from '@/core/libraryStore';

function makeEntry(overrides: Partial<LibraryEntry>): LibraryEntry {
  return {
    id: 'id-1',
    bytes: new Uint8Array([1, 2, 3]),
    fileName: 'Song.prst',
    relPath: 'Song.prst',
    pack: '',
    name: 'Song',
    author: 'RR',
    format: 1224,
    ampName: 'UK SLP',
    cabName: 'UK GRN 2',
    usesUserIr: false,
    irSlot: null,
    tags: [],
    favorite: false,
    importedAt: Date.now(),
    ...overrides,
  };
}

function renderSheet(overrides: Partial<Parameters<typeof LibrarySheet>[0]> = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    connected: true,
    presetNames: new Array(256).fill(null) as (string | null)[],
    onImportFile: vi.fn(),
    onWriteToSlot: vi.fn().mockResolvedValue(undefined),
    onVerifySlot: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
  const utils = render(<LibrarySheet {...props} />);
  return { props, ...utils };
}

describe('LibrarySheet', () => {
  beforeEach(() => {
    vi.mocked(libraryStore.getAll).mockReset();
    vi.mocked(libraryStore.putMany).mockReset();
    vi.mocked(libraryStore.remove).mockReset();
    vi.mocked(libraryStore.clear).mockReset();
  });

  it('loads entries from the store and renders them', async () => {
    vi.mocked(libraryStore.getAll).mockResolvedValue([
      makeEntry({ id: '1', name: 'ATBL Rhythm', pack: 'Choptones' }),
      makeEntry({ id: '2', name: 'Creep Bass', pack: '' }),
    ]);
    renderSheet();
    await waitFor(() => expect(screen.getByText('ATBL Rhythm')).toBeTruthy());
    expect(screen.getByText('Creep Bass')).toBeTruthy();
    expect(screen.getByText('2 in library')).toBeTruthy();
  });

  it('filters the table by search query', async () => {
    vi.mocked(libraryStore.getAll).mockResolvedValue([
      makeEntry({ id: '1', name: 'ATBL Rhythm' }),
      makeEntry({ id: '2', name: 'Creep Bass' }),
    ]);
    renderSheet();
    await waitFor(() => expect(screen.getByText('ATBL Rhythm')).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText(/Search name/), { target: { value: 'creep' } });
    expect(screen.queryByText('ATBL Rhythm')).toBeNull();
    expect(screen.getByText('Creep Bass')).toBeTruthy();
  });

  it('disables LOAD TO DEVICE until connected and something is selected', async () => {
    vi.mocked(libraryStore.getAll).mockResolvedValue([makeEntry({ id: '1', name: 'ATBL Rhythm' })]);
    renderSheet({ connected: false });
    await waitFor(() => expect(screen.getByText('ATBL Rhythm')).toBeTruthy());
    expect(screen.getByText('LOAD TO DEVICE…')).toBeDisabled();
  });

  it('opens the assignment panel with the selected row and fills a start slot', async () => {
    vi.mocked(libraryStore.getAll).mockResolvedValue([makeEntry({ id: '1', name: 'ATBL Rhythm' })]);
    renderSheet({ connected: true });
    await waitFor(() => expect(screen.getByText('ATBL Rhythm')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Select ATBL Rhythm'));
    fireEvent.click(screen.getByText('LOAD TO DEVICE…'));
    expect(screen.getByText('LOAD 1 TO DEVICE')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Start slot/), { target: { value: '41A' } });
    fireEvent.click(screen.getByText('FILL FROM START'));
    const slotInput = screen.getByLabelText('Target slot for ATBL Rhythm') as HTMLInputElement;
    expect(slotInput.value).toBe('41A');
  });

  it('writes each selected row and marks it OK', async () => {
    const onWriteToSlot = vi.fn().mockResolvedValue(undefined);
    const onVerifySlot = vi.fn().mockResolvedValue({ ok: true });
    vi.mocked(libraryStore.getAll).mockResolvedValue([makeEntry({ id: '1', name: 'ATBL Rhythm', bytes: new Uint8Array([9, 9]) })]);
    renderSheet({ connected: true, onWriteToSlot, onVerifySlot });
    await waitFor(() => expect(screen.getByText('ATBL Rhythm')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Select ATBL Rhythm'));
    fireEvent.click(screen.getByText('LOAD TO DEVICE…'));
    fireEvent.change(screen.getByLabelText('Target slot for ATBL Rhythm'), { target: { value: '1A' } });
    fireEvent.click(screen.getByText('WRITE 1 PATCHES'));

    await waitFor(() => expect(onWriteToSlot).toHaveBeenCalledWith(0, new Uint8Array([9, 9])));
    await waitFor(() => expect(onVerifySlot).toHaveBeenCalledWith(0, new Uint8Array([9, 9])));
    await waitFor(() => expect(screen.getByText('OK')).toBeTruthy());
  });

  it('blocks the write when two rows target the same slot', async () => {
    vi.mocked(libraryStore.getAll).mockResolvedValue([
      makeEntry({ id: '1', name: 'First' }),
      makeEntry({ id: '2', name: 'Second' }),
    ]);
    renderSheet({ connected: true });
    await waitFor(() => expect(screen.getByText('First')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Select First'));
    fireEvent.click(screen.getByLabelText('Select Second'), { ctrlKey: true });
    fireEvent.click(screen.getByText('LOAD TO DEVICE…'));

    fireEvent.change(screen.getByLabelText('Target slot for First'), { target: { value: '1A' } });
    fireEvent.change(screen.getByLabelText('Target slot for Second'), { target: { value: '1A' } });

    expect(screen.getByText(/slot conflict/)).toBeTruthy();
    expect(screen.getByText(/WRITE 2 PATCHES/)).toBeDisabled();
  });

  it('opens a row in the editor and closes the sheet', async () => {
    const onImportFile = vi.fn();
    const onClose = vi.fn();
    vi.mocked(libraryStore.getAll).mockResolvedValue([makeEntry({ id: '1', name: 'ATBL Rhythm', bytes: new Uint8Array([7]) })]);
    renderSheet({ onImportFile, onClose });
    await waitFor(() => expect(screen.getByText('ATBL Rhythm')).toBeTruthy());

    fireEvent.click(screen.getAllByText('OPEN')[0]);
    expect(onImportFile).toHaveBeenCalledWith(new Uint8Array([7]));
    expect(onClose).toHaveBeenCalled();
  });

  it('deletes a row via the store', async () => {
    vi.mocked(libraryStore.getAll)
      .mockResolvedValueOnce([makeEntry({ id: '1', name: 'ATBL Rhythm' })])
      .mockResolvedValueOnce([]);
    renderSheet();
    await waitFor(() => expect(screen.getByText('ATBL Rhythm')).toBeTruthy());

    fireEvent.click(screen.getAllByText('DELETE')[0]);
    await waitFor(() => expect(libraryStore.remove).toHaveBeenCalledWith(['1']));
  });

  it('clears the library after confirming', async () => {
    vi.mocked(libraryStore.getAll).mockResolvedValue([makeEntry({ id: '1', name: 'ATBL Rhythm' })]);
    renderSheet();
    await waitFor(() => expect(screen.getByText('ATBL Rhythm')).toBeTruthy());

    fireEvent.click(screen.getByText('CLEAR LIBRARY'));
    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => expect(libraryStore.clear).toHaveBeenCalled());
  });
});
