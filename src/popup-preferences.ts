import { db, type LibraryDB } from './db';
import { isLibrarySource, validateOptions, type ImportOptions, type LibrarySource } from './model';

export const IMPORT_PREFERENCES_KEY = 'importPreferences';
export interface PopupPreferences {
  source: LibrarySource;
  waitMode: 'fixed' | 'random';
  intervalMs: number;
  intervalMaxMs: number;
  maxPosts: number;
  mode: ImportOptions['mode'];
  autoMark: boolean;
}
export function initialPopupSource(explicit: unknown, inspected: unknown, saved: unknown): LibrarySource {
  if (isLibrarySource(inspected)) return inspected;
  if (isLibrarySource(explicit)) return explicit;
  return isLibrarySource(saved) ? saved : 'bookmarks';
}
export function popupOptions(value: PopupPreferences): ImportOptions {
  return validateOptions({ intervalMs: value.intervalMs, ...(value.waitMode === 'random' ? { intervalMaxMs: value.intervalMaxMs } : {}), maxPosts: value.maxPosts, mode: value.mode === 'full' ? 'visible' : value.mode });
}
export function validatePopupPreferences(input: unknown): PopupPreferences | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  const value = input as PopupPreferences;
  if (!isLibrarySource(value.source) || (value.waitMode !== 'fixed' && value.waitMode !== 'random') ||
    !Number.isInteger(value.intervalMaxMs) || value.intervalMaxMs < 3000 || value.intervalMaxMs > 30000 ||
    (value.autoMark !== undefined && typeof value.autoMark !== 'boolean')) return;
  try {
    const options = popupOptions(value);
    return { source: value.source, waitMode: value.waitMode, ...options, intervalMaxMs: value.intervalMaxMs, autoMark: value.autoMark ?? false };
  } catch { return; }
}
export function preferencesFromOptions(source: LibrarySource, options: ImportOptions, autoMark = false): PopupPreferences {
  return { source, intervalMs: options.intervalMs, maxPosts: options.maxPosts, mode: options.mode === 'full' ? 'visible' : options.mode, waitMode: options.intervalMaxMs === undefined ? 'fixed' : 'random', intervalMaxMs: options.intervalMaxMs ?? Math.max(options.intervalMs, 6000), autoMark };
}
export async function loadPopupPreferences(store: LibraryDB = db): Promise<PopupPreferences | undefined> {
  return validatePopupPreferences((await store.settings.get(IMPORT_PREFERENCES_KEY))?.value);
}
export async function savePopupPreferences(input: unknown, store: LibraryDB = db): Promise<void> {
  const value = validatePopupPreferences(input);
  if (!value) throw new Error('取り込み設定が不正です');
  await store.settings.put({ key: IMPORT_PREFERENCES_KEY, value });
}
