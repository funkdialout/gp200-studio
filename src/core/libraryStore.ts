/**
 * Tiny typed IndexedDB wrapper for the preset library (LIBRARY-SPEC.md).
 * No runtime dependency: raw `indexedDB`, one object store keyed by `id`
 * (the sha256 hash of the .prst bytes), so re-`putMany`-ing the same file
 * is a no-op overwrite rather than a duplicate row.
 */
import type { LibraryEntry } from './library';

const DB_NAME = 'gp200-studio';
const DB_VERSION = 1;
const STORE_NAME = 'library';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error as Error);
    });
  }
  return dbPromise;
}

/** Runs `fn` against the store inside a transaction, resolving/rejecting with the transaction. */
async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => void,
): Promise<T | void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    fn(store);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error as Error);
    tx.onabort = () => reject(tx.error as Error);
  });
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error as Error);
  });
}

export const libraryStore = {
  /** Insert or overwrite entries, keyed by `id` (dedupe: same bytes = same id). */
  async putMany(entries: LibraryEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await withStore('readwrite', (store) => {
      for (const entry of entries) store.put(entry);
    });
  },

  async getAll(): Promise<LibraryEntry[]> {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    return requestToPromise(store.getAll());
  },

  async remove(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await withStore('readwrite', (store) => {
      for (const id of ids) store.delete(id);
    });
  },

  /** Shallow-merges `patch` into the stored entry (e.g. renaming its pack/tags). */
  async update(id: string, patch: Partial<LibraryEntry>): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const existing = await requestToPromise(store.get(id) as IDBRequest<LibraryEntry | undefined>);
    if (!existing) return;
    store.put({ ...existing, ...patch, id });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error as Error);
    });
  },

  async clear(): Promise<void> {
    await withStore('readwrite', (store) => {
      store.clear();
    });
  },
};
