import { openLocalFile, type LocalFileHandle } from './local-files';

export const LOCAL_SESSION_DB = 'xbookmarkshelf-local-session';
const STORE = 'preferences';
export interface LocalSession { handle: LocalFileHandle | null; previews: boolean }

function fileHandle(value: unknown): value is LocalFileHandle {
  const h = value as Partial<LocalFileHandle> | null;
  return !!h && h.kind === 'file' && typeof h.name === 'string' && h.name.length <= 1024 &&
    typeof h.getFile === 'function' && typeof h.createWritable === 'function' && typeof h.queryPermission === 'function';
}
async function database(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(LOCAL_SESSION_DB, 1); let failed = false;
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => { failed = true; reject(request.error); };
    request.onblocked = () => { failed = true; reject(new Error('Session storage blocked')); };
    request.onsuccess = () => {
      const db = request.result; db.onversionchange = () => db.close();
      if (failed) db.close(); else resolve(db);
    };
  });
}
async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => () => T, factory: IDBFactory): Promise<T> {
  const db = await database(factory);
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode); let result: () => T;
      tx.oncomplete = () => resolve(result()); tx.onabort = () => reject(tx.error ?? new Error('Session storage failed'));
      tx.onerror = () => { /* Abort reports the transaction failure. */ };
      try { result = action(tx.objectStore(STORE)); }
      catch (e) { tx.abort(); reject(e); }
    });
  } finally { db.close(); }
}
// Exactly two small values. Never pass a library, JSON text, Blob, or post here.
export function loadLocalSession(factory: IDBFactory = indexedDB): Promise<LocalSession> {
  return transaction('readonly', store => {
    const handle = store.get('file'); const previews = store.get('previews');
    return () => ({ handle: fileHandle(handle.result) ? handle.result : null, previews: previews.result === true });
  }, factory);
}
export function rememberLocalFile(handle: LocalFileHandle | null, factory: IDBFactory = indexedDB): Promise<void> {
  if (handle && !fileHandle(handle)) return Promise.reject(new Error('Invalid file handle'));
  return transaction('readwrite', store => {
    if (handle) store.put(handle, 'file'); else store.delete('file'); return () => undefined;
  }, factory);
}
export function rememberLocalPreviews(previews: boolean, factory: IDBFactory = indexedDB): Promise<void> {
  return transaction('readwrite', store => { store.put(previews === true, 'previews'); return () => undefined; }, factory);
}
// On startup, only inspect permission. A prompt requires the user's Open click.
export async function resumeLocalFile(handle: LocalFileHandle, request = false) {
  if (request) {
    if (!handle.requestPermission || await handle.requestPermission({ mode: 'read' }) !== 'granted') return null;
  } else if (!handle.queryPermission || await handle.queryPermission({ mode: 'read' }) !== 'granted') return null;
  return openLocalFile(handle);
}
