import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { LibraryDB, accountFor } from '../../src/db';
import { createBackup, validateBackup } from '../../src/backup';
import { createSettingsBackup, readSettingsFile, restoreSettingsBackup, validateSettingsBackup, MAX_SETTINGS_FILE_BYTES, DEFAULT_DISPLAY_SETTINGS } from '../../src/settings-backup';
import { observation } from './helpers';

let store: LibraryDB;
beforeEach(() => { store = new LibraryDB(`settings-${crypto.randomUUID()}`); });
afterEach(async () => { await store.delete(); });
const settingsFile = () => ({ format: 'xbookmarkshelf-settings', formatVersion: 1, exportedAt: '2026-10-11T00:00:00.000Z',
  settings: { theme: 'dark', columns: 5, layout: 'list', previews: true, language: 'en' } });

it('exports only the five display preferences, using defaults without exposing other stored values', async () => {
  const account = await accountFor('synthetic_user', store);
  await store.settings.put({ key: 'internal', value: { private: 'synthetic-only' } });
  const backup = await createSettingsBackup(store);
  expect(backup.settings).toEqual(DEFAULT_DISPLAY_SETTINGS);
  expect(Object.keys(backup).sort()).toEqual(['exportedAt', 'format', 'formatVersion', 'settings']);
  expect(JSON.stringify(backup)).not.toContain(account.handle);
  expect(JSON.stringify(backup)).not.toContain('synthetic-only');
  await store.settings.put({ key: 'previews', value: false });
  expect((await createSettingsBackup(store)).settings.previews).toBe(false);
  await store.settings.bulkPut([{ key: 'theme', value: 'dark' }, { key: 'columns', value: 5 }, { key: 'layout', value: 'list' }, { key: 'previews', value: true }, { key: 'language', value: 'en' }]);
  expect((await createSettingsBackup(store)).settings).toEqual(settingsFile().settings);
});
it('applies settings without modifying accounts, posts, marks, read state, relations or import history', async () => {
  const account = await accountFor('synthetic_user', store);
  await store.posts.put({ ...observation('1'), accountId: account.id, firstImportedAt: '2026-10-11T00:00:00Z', lastImportedAt: '2026-10-11T00:00:00Z' });
  await store.tags.put({ id: 'reading', accountId: account.id, name: '読書', mark: 'book' });
  await store.postTags.put({ accountId: account.id, postId: '1', tagId: 'reading' });
  await store.userStates.put({ accountId: account.id, postId: '1', read: true, favorite: true });
  await store.settings.put({ key: 'untouched', value: 'synthetic-value' });
  await store.importRuns.put({ id: 'synthetic-run', accountId: account.id, handle: account.handle, tabId: 1, documentId: 'synthetic', mode: 'full', intervalMs: 3000, maxPosts: 100, state: 'stopped', reason: 'run_limit', startedAt: '2026-10-11T00:00:00Z', updatedAt: '2026-10-11T00:00:00Z', observed: 1, added: 1, existing: 0, consecutiveKnown: 0, nextSequence: 1, lastFingerprint: 'synthetic', lastPostId: '1' });
  await store.savedFilters.put({ id: 'synthetic-filter', name: '保持する条件', value: { read: true } });
  const before = await createBackup(store);
  const protectedData = await Promise.all([store.importRuns.toArray(), store.savedFilters.toArray()]);
  expect(await restoreSettingsBackup(settingsFile(), store)).toEqual(settingsFile().settings);
  const after = await createBackup(store);
  expect({ ...after, exportedAt: before.exportedAt }).toEqual(before);
  expect(await store.settings.get('untouched')).toEqual({ key: 'untouched', value: 'synthetic-value' });
  expect(await Promise.all([store.importRuns.toArray(), store.savedFilters.toArray()])).toEqual(protectedData);
  expect((await createSettingsBackup(store)).settings).toEqual(settingsFile().settings);
});
it('rejects mismatched files, unknown versions and invalid values without writing', async () => {
  await restoreSettingsBackup(settingsFile(), store);
  const before = await store.settings.toArray();
  const base = settingsFile();
  const invalid = [null, [], {}, { ...base, formatVersion: 2 }, { ...base, formatVersion: '1' }, { ...base, exportedAt: 'invalid' },
    { ...base, posts: [] }, { ...base, settings: { ...base.settings, accounts: [] } },
    { ...base, settings: { ...base.settings, theme: 'automatic' } },
    ...[0, 6, 1.5, '3', NaN, Infinity].map(columns => ({ ...base, settings: { ...base.settings, columns } })),
    { ...base, settings: { ...base.settings, layout: '<script>' } }, { ...base, settings: { ...base.settings, previews: 'false' } },
    ...['fr', '', null, 1, {}, undefined].map(language => ({ ...base, settings: { ...base.settings, language } })),
    { ...base, settings: { theme: 'dark', columns: 3, layout: 'grid' } }, { ...base, settings: [] },
    await createBackup(store)];
  for (const input of invalid) {
    expect(() => validateSettingsBackup(input)).toThrow();
    await expect(restoreSettingsBackup(input, store)).rejects.toThrow();
    expect(await store.settings.toArray()).toEqual(before);
  }
  expect(() => validateBackup(base)).toThrow('対応するJSON');
});
it('rejects malformed and oversized files, accepting a valid file at the byte limit', async () => {
  await expect(readSettingsFile(new Blob(['{broken']))).rejects.toThrow('読み込めません');
  const json = JSON.stringify(settingsFile());
  const padding = ' '.repeat(MAX_SETTINGS_FILE_BYTES - new Blob([json]).size);
  expect((await readSettingsFile(new Blob([json, padding]))).settings).toEqual(settingsFile().settings);
  await expect(readSettingsFile(new Blob([json, padding, ' ']))).rejects.toThrow('64KB');
});
it('rolls back every changed preference when one database write fails', async () => {
  await restoreSettingsBackup({ ...settingsFile(), settings: { theme: 'light', columns: 2, layout: 'grid', previews: false, language: 'ja' } }, store);
  const before = await store.settings.toArray();
  store.settings.hook('updating', (_changes, key) => { if (key === 'language') throw new Error('synthetic-write-failure'); });
  await expect(restoreSettingsBackup(settingsFile(), store)).rejects.toThrow();
  expect(await store.settings.toArray()).toEqual(before);
});
it('exports safe defaults instead of serializing malformed stored preferences', async () => {
  await store.settings.bulkPut([{ key: 'theme', value: { private: 'synthetic-private' } }, { key: 'columns', value: 99 }, { key: 'layout', value: '<script>' }, { key: 'previews', value: 'true' }, { key: 'language', value: '<script>' }]);
  const backup = await createSettingsBackup(store);
  expect(backup.settings).toEqual({ ...DEFAULT_DISPLAY_SETTINGS, previews: false });
  expect(JSON.stringify(backup)).not.toContain('synthetic-private');
});
it('reads old four-key files without replacing the current language and exports it in new files', async () => {
  const { language: _language, ...legacy } = settingsFile().settings;
  const oldFile = { ...settingsFile(), settings: legacy };
  expect(validateSettingsBackup(oldFile).settings).toEqual(legacy);
  await store.settings.put({ key: 'language', value: 'en' });
  await restoreSettingsBackup(oldFile, store);
  expect((await store.settings.get('language'))?.value).toBe('en');
  expect((await createSettingsBackup(store)).settings).toEqual(settingsFile().settings);
  await store.settings.delete('language');
  await restoreSettingsBackup(oldFile, store);
  expect(await store.settings.get('language')).toBeUndefined();
  expect((await createSettingsBackup(store)).settings.language).toBe('system');
});
it('round-trips the system preference, keeping it when an old file has no language', async () => {
  const input = { ...settingsFile(), settings: { ...settingsFile().settings, language: 'system' } };
  await restoreSettingsBackup(input, store);
  expect((await createSettingsBackup(store)).settings).toEqual(input.settings);
  const { language: _language, ...legacy } = input.settings;
  await restoreSettingsBackup({ ...input, settings: legacy }, store);
  expect((await store.settings.get('language'))?.value).toBe('system');
});
