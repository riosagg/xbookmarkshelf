import { describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { loadLocalSession, rememberLocalFile, rememberLocalPreviews, resumeLocalFile, LOCAL_SESSION_DB } from '../../src/local-session';
import { emptyLocalLibrary, serializeLocalLibrary } from '../../src/local-data';
import type { LocalFileHandle } from '../../src/local-files';

function handle(permission: PermissionState = 'granted', contents = serializeLocalLibrary(emptyLocalLibrary())) {
  const queryPermission = vi.fn(async () => permission); const requestPermission = vi.fn(async () => permission);
  const getFile = vi.fn(async () => new File([contents], 'synthetic-library.json'));
  const createWritable = vi.fn();
  return { name: 'synthetic-library.json', kind: 'file', queryPermission, requestPermission, getFile, createWritable } satisfies LocalFileHandle;
}
async function records(factory: IDBFactory) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = factory.open(LOCAL_SESSION_DB, 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  try { return await new Promise<{ keys: IDBValidKey[]; values: unknown[] }>((resolve, reject) => {
    const tx = db.transaction('preferences', 'readonly'); const store = tx.objectStore('preferences'); const keys = store.getAllKeys(); const values = store.getAll();
    tx.oncomplete = () => resolve({ keys: keys.result, values: values.result }); tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
describe('local resume metadata', () => {
  it('keeps only the preview boolean, supports ON/OFF and forgetting a file without erasing that preference', async () => {
    const factory = new IDBFactory(); expect(await loadLocalSession(factory)).toEqual({ handle: null, previews: false });
    await rememberLocalPreviews(true, factory); expect(await loadLocalSession(factory)).toEqual({ handle: null, previews: true });
    expect(await records(factory)).toEqual({ keys: ['previews'], values: [true] });
    await rememberLocalFile(null, factory); expect((await loadLocalSession(factory)).previews).toBe(true);
    await rememberLocalPreviews(false, factory); expect((await loadLocalSession(factory)).previews).toBe(false);
  });
  it('rejects malformed handles and clone failures without losing the preview preference', async () => {
    const factory = new IDBFactory(); await rememberLocalPreviews(true, factory);
    await expect(rememberLocalFile({ name: 'invalid' } as LocalFileHandle, factory)).rejects.toThrow();
    // Fake objects with methods are not browser-native structured-clonable file handles.
    await expect(rememberLocalFile(handle(), factory)).rejects.toThrow();
    expect(await records(factory)).toEqual({ keys: ['previews'], values: [true] });
  });
  it('returns storage failures to the caller without reading or writing the chosen file', async () => {
    const factory = { open() { throw new DOMException('Synthetic denied storage', 'SecurityError'); } } as unknown as IDBFactory;
    const h = handle(); await expect(loadLocalSession(factory)).rejects.toThrow('Synthetic');
    await expect(rememberLocalFile(h, factory)).rejects.toThrow('Synthetic'); expect(h.getFile).not.toHaveBeenCalled(); expect(h.createWritable).not.toHaveBeenCalled();
  });
  it('automatically reads only an already permitted file and validates its JSON without writing', async () => {
    const h = handle(); const result = await resumeLocalFile(h); expect(result?.library.formatVersion).toBe(1);
    expect(h.queryPermission).toHaveBeenCalledWith({ mode: 'read' }); expect(h.requestPermission).not.toHaveBeenCalled(); expect(h.createWritable).not.toHaveBeenCalled();
    await expect(resumeLocalFile(handle('granted', 'malformed'))).rejects.toThrow();
  });
  it('never prompts or reads on startup when access is prompt/denied', async () => {
    for (const p of ['prompt', 'denied'] as const) { const h = handle(p); expect(await resumeLocalFile(h)).toBeNull(); expect(h.getFile).not.toHaveBeenCalled(); expect(h.requestPermission).not.toHaveBeenCalled(); }
  });
  it('requests read access immediately on an explicit reopen, handles refusal and missing files', async () => {
    const h = handle(); expect(await resumeLocalFile(h, true)).not.toBeNull(); expect(h.requestPermission).toHaveBeenCalledWith({ mode: 'read' }); expect(h.queryPermission).not.toHaveBeenCalled();
    const denied = handle('denied'); expect(await resumeLocalFile(denied, true)).toBeNull(); expect(denied.getFile).not.toHaveBeenCalled();
    h.getFile.mockRejectedValueOnce(new DOMException('Synthetic missing file', 'NotFoundError')); await expect(resumeLocalFile(h)).rejects.toThrow('Synthetic missing');
  });
});
