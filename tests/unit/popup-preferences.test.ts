import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LibraryDB } from '../../src/db';
import { DEFAULT_OPTIONS } from '../../src/model';
import { restoreSettingsBackup, createSettingsBackup } from '../../src/settings-backup';
import { initialPopupSource, IMPORT_PREFERENCES_KEY, loadPopupPreferences, popupOptions, preferencesFromOptions, savePopupPreferences, validatePopupPreferences } from '../../src/popup-preferences';

let store: LibraryDB;
beforeEach(() => { store = new LibraryDB(`synthetic-popup-preferences-${crypto.randomUUID()}`); });
afterEach(async () => { vi.restoreAllMocks(); await store.delete(); });
it('prefers the verified visible collection, then explicit source, saved choice and defaults', () => {
  expect(initialPopupSource('bookmarks', 'likes', 'bookmarks')).toBe('likes');
  expect(initialPopupSource('likes', 'bookmarks', 'likes')).toBe('bookmarks');
  expect(initialPopupSource('likes', undefined, 'bookmarks')).toBe('likes');
  expect(initialPopupSource(undefined, null, 'likes')).toBe('likes');
  expect(initialPopupSource('unknown', 'unknown', 'unknown')).toBe('bookmarks');
});
it('persists only valid form values and retains the last valid choice after invalid edits or a failed write', async () => {
  const preferences = { ...preferencesFromOptions('likes', DEFAULT_OPTIONS), waitMode: 'random' as const, intervalMaxMs: 8000, maxPosts: 250, mode: 'delta' as const, autoMark: true };
  await savePopupPreferences({ ...preferences, handle: 'private-not-stored', token: 'private-not-stored' }, store);
  expect(await loadPopupPreferences(store)).toEqual(preferences);
  expect((await store.settings.get(IMPORT_PREFERENCES_KEY))?.value).toEqual(preferences);
  for (const invalid of [null, [], { ...preferences, source: 'unknown' }, { ...preferences, intervalMs: 2000 }, { ...preferences, intervalMaxMs: 2999 }, { ...preferences, intervalMaxMs: 30001 }, { ...preferences, intervalMs: 9000 }, { ...preferences, maxPosts: 0 }, { ...preferences, maxPosts: 1001 }, { ...preferences, mode: 'unknown' }, { ...preferences, waitMode: 'unknown' }, { ...preferences, autoMark: 'true' }, { ...preferences, autoMark: 1 }, { ...preferences, autoMark: null }]) {
    expect(validatePopupPreferences(invalid)).toBeUndefined(); await expect(savePopupPreferences(invalid, store)).rejects.toThrow();
  }
  expect(await loadPopupPreferences(store)).toEqual(preferences);
  vi.spyOn(store.settings, 'put').mockRejectedValueOnce(new Error('synthetic-quota'));
  await expect(savePopupPreferences({ ...preferences, maxPosts: 300, autoMark: false }, store)).rejects.toThrow('synthetic-quota');
  expect(await loadPopupPreferences(store)).toEqual(preferences);
});
it('reads legacy preferences as auto-mark off without rewriting them and remembers explicit on and off', async () => {
  const preferences = preferencesFromOptions('bookmarks', DEFAULT_OPTIONS);
  const { autoMark: _autoMark, ...legacy } = preferences;
  await store.settings.put({ key: IMPORT_PREFERENCES_KEY, value: legacy });
  expect(await loadPopupPreferences(store)).toEqual(preferences);
  expect((await store.settings.get(IMPORT_PREFERENCES_KEY))?.value).toEqual(legacy);
  await savePopupPreferences({ ...preferences, autoMark: true }, store);
  expect(await loadPopupPreferences(store)).toMatchObject({ autoMark: true });
  expect(popupOptions((await loadPopupPreferences(store))!)).toEqual(DEFAULT_OPTIONS);
  await savePopupPreferences({ ...preferences, autoMark: false }, store);
  expect(await loadPopupPreferences(store)).toMatchObject({ autoMark: false });
});
it('keeps fixed options compatible and ignores a malformed saved record', async () => {
  const fixed = { ...preferencesFromOptions('bookmarks', { ...DEFAULT_OPTIONS, intervalMs: 9000 }), intervalMaxMs: 6000 };
  await savePopupPreferences(fixed, store); expect(await loadPopupPreferences(store)).toEqual(fixed);
  expect(popupOptions(fixed)).toEqual({ ...DEFAULT_OPTIONS, intervalMs: 9000 });
  await store.settings.put({ key: IMPORT_PREFERENCES_KEY, value: { ...fixed, waitMode: 'random' } });
  expect(await loadPopupPreferences(store)).toBeUndefined();
});
it('replaces legacy full in the popup with visible without rewriting stored preferences or the old run', async () => {
  const legacy = { ...preferencesFromOptions('likes', DEFAULT_OPTIONS), mode: 'full' as const };
  await store.settings.put({ key: IMPORT_PREFERENCES_KEY, value: legacy });
  expect(await loadPopupPreferences(store)).toEqual({ ...legacy, mode: 'visible' });
  expect((await store.settings.get(IMPORT_PREFERENCES_KEY))?.value).toEqual(legacy);
  const oldOptions = { ...DEFAULT_OPTIONS, mode: 'full' as const };
  expect(preferencesFromOptions('likes', oldOptions).mode).toBe('visible');
  expect(popupOptions(legacy).mode).toBe('visible'); expect(oldOptions.mode).toBe('full');
});
it('excludes import preferences from display settings JSON and protects them when applying display settings', async () => {
  const preferences = preferencesFromOptions('likes', { ...DEFAULT_OPTIONS, intervalMaxMs: 8000 }, true);
  await savePopupPreferences(preferences, store);
  const backup = await createSettingsBackup(store);
  expect(Object.keys(backup.settings).sort()).toEqual(['columns', 'language', 'layout', 'previews', 'theme']);
  expect(JSON.stringify(backup)).not.toContain(IMPORT_PREFERENCES_KEY);
  expect(JSON.stringify(backup)).not.toContain('autoMark');
  await restoreSettingsBackup({ ...backup, settings: { ...backup.settings, theme: 'dark', previews: true } }, store);
  expect(await loadPopupPreferences(store)).toEqual(preferences);
  expect(await store.posts.count()).toBe(0); expect(await store.importRuns.count()).toBe(0);
});
