import { LOCAL_MAX_BYTES, LocalDataError, parseLocalLibrary, serializeLocalLibrary, type LocalLibrary } from './local-data';

export interface LocalFileHandle {
  name: string;
  kind?: 'file';
  queryPermission?(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(text: string): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
}
export interface LocalFileTarget { handle: LocalFileHandle; fingerprint: string }
interface FilePickers {
  showOpenFilePicker?(options: object): Promise<LocalFileHandle[]>;
  showSaveFilePicker?(options: object): Promise<LocalFileHandle>;
}
export const pickers = () => window as unknown as FilePickers;
export const filePickerTypes = [{ description: 'xbookmarkshelf library JSON', accept: { 'application/json': ['.json'] } }];
async function fingerprint(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
async function read(handle: LocalFileHandle) {
  const file = await handle.getFile(); if (file.size > LOCAL_MAX_BYTES) throw new LocalDataError('size');
  const text = await file.text(); return { file, text, hash: await fingerprint(text) };
}
export async function openLocalFile(handle: LocalFileHandle) {
  const input = await read(handle); const library = parseLocalLibrary(input.text);
  return { library, target: { handle, fingerprint: input.hash } satisfies LocalFileTarget, bytes: input.file.size };
}
// Save As may select an existing management file, but never an archive or posts backup.
export async function newLocalTarget(handle: LocalFileHandle): Promise<LocalFileTarget> {
  const input = await read(handle); if (input.file.size) parseLocalLibrary(input.text);
  return { handle, fingerprint: input.hash };
}
export async function saveLocalFile(target: LocalFileTarget, library: LocalLibrary): Promise<LocalFileTarget> {
  const text = serializeLocalLibrary(library);
  if ((await read(target.handle)).hash !== target.fingerprint) throw new LocalDataError('conflict');
  const stream = await target.handle.createWritable();
  try { await stream.write(text); await stream.close(); }
  catch (error) { try { await stream.abort(); } catch { /* The stream may already be closed. */ } throw error; }
  const hash = await fingerprint(text);
  if ((await read(target.handle)).hash !== hash) throw new LocalDataError('conflict');
  return { handle: target.handle, fingerprint: hash };
}
export function downloadLocalText(text: string, filename: string) {
  const blob = new Blob([text], { type: 'application/json' }); if (blob.size > LOCAL_MAX_BYTES) throw new LocalDataError('size');
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
