/** Minimal promise wrapper over IndexedDB for saved projects, results, the offline queue and key/value data. */

export type StoreName = 'projects' | 'results' | 'queue' | 'kv';

const DB_NAME = 'qg-devs';
const DB_VERSION = 1;
const KEYS: Record<StoreName, string> = { projects: 'id', results: 'id', queue: 'id', kv: 'key' };

let dbPromise: Promise<IDBDatabase> | null = null;

/** Storage failure with a message suitable for showing to the user. */
export class StorageError extends Error {}

function friendly(e: unknown): StorageError {
  const name = (e as DOMException)?.name ?? '';
  const raw = e instanceof Error ? e.message : String(e);
  if (name === 'QuotaExceededError' || /quota/i.test(raw)) return new StorageError('Storage on this device is full. Delete saved projects/results (Jobs → Saved on this device) or free browser storage, then try again.');
  if (/not available|InvalidStateError|SecurityError|blocked/i.test(`${name} ${raw}`)) return new StorageError('Storage on this device is unavailable (private browsing, blocked site data, or another tab is upgrading it). Nothing was saved.');
  return new StorageError(`Local storage error: ${raw}`);
}

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    try {
      if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is not available in this browser context');
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const [name, keyPath] of Object.entries(KEYS)) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // another tab upgrading the schema: close so it is not blocked; the next call reopens
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB open blocked by another tab'));
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

async function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  try { return await runRaw<T>(store, mode, fn); } catch (e) { throw e instanceof StorageError ? e : friendly(e); }
}

async function runRaw<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    try {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      let result: T;
      req.onsuccess = () => { result = req.result as T; };
      req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

export function idbPut<T>(store: StoreName, value: T): Promise<IDBValidKey> {
  return run<IDBValidKey>(store, 'readwrite', (s) => s.put(value));
}

export function idbGet<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return run<T | undefined>(store, 'readonly', (s) => s.get(key));
}

export function idbAll<T>(store: StoreName): Promise<T[]> {
  return run<T[]>(store, 'readonly', (s) => s.getAll());
}

export function idbDelete(store: StoreName, key: IDBValidKey): Promise<void> {
  return run<undefined>(store, 'readwrite', (s) => s.delete(key)).then(() => undefined);
}

export function idbClear(store: StoreName): Promise<void> {
  return run<undefined>(store, 'readwrite', (s) => s.clear()).then(() => undefined);
}

/** Time-ordered random id: base-36 milliseconds + 8 random base-36 characters (sorts by creation time). */
export function newId(): string {
  const t = Date.now().toString(36).padStart(9, '0');
  let r = '';
  const bytes = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256);
  for (const b of bytes) r += (b % 36).toString(36);
  return `${t}-${r}`;
}
