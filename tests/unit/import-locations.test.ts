// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import { LibraryDB } from '../../src/db';
import { DEFAULT_IMPORT_LOCATIONS, validateImportLocations, isImportPageUrl, configuredImportSource, runImportLocations, importSourceUrl } from '../../src/import-locations';
import { IMPORT_LOCATIONS_KEY, loadImportLocations, saveImportLocations } from '../../src/import-locations-store';
import { libraryScope } from '../../src/dom';
import { createSettingsBackup, restoreSettingsBackup } from '../../src/settings-backup';

const locations = { bookmarks: 'https://x.com/i/saved-posts', likes: 'https://x.com/i/liked-posts?view=all&order=latest' };
const stores: LibraryDB[] = [];
afterEach(async () => { for (const store of stores.splice(0)) await store.delete(); });

it('recognizes new exact list routes, normalizes query order and keeps legacy URLs', () => {
  const valid = validateImportLocations({ ...locations, bookmarks: ` ${locations.bookmarks}/ `, ignored: 'not stored' });
  expect(valid).toEqual({ ...locations, bookmarks: `${locations.bookmarks}/` });
  expect(configuredImportSource('https://x.com/i/liked-posts/?order=latest&view=all#section', valid)).toBe('likes');
  expect(isImportPageUrl('https://x.com/i/liked-posts?view=all', valid)).toBe(false);
  expect(isImportPageUrl('https://x.com/i/saved-posts/child', valid)).toBe(false);
  for (const url of ['https://x.com/i/bookmarks', 'https://x.com/i/history', 'https://x.com/i/history/likes', 'https://x.com/sample/likes']) expect(isImportPageUrl(url, valid)).toBe(true);
  expect(runImportLocations(undefined)).toEqual(DEFAULT_IMPORT_LOCATIONS);
  expect(runImportLocations({ likes: 'https://evil.invalid' })).toBeNull();
  expect(importSourceUrl('likes', DEFAULT_IMPORT_LOCATIONS, 'SAMPLE')).toBe('https://x.com/sample/likes');
  expect(importSourceUrl('likes', locations, 'sample')).toBe(locations.likes);
});
it('rejects unsafe origins, actions, post/profile pages, encoded routes and ambiguous sources', () => {
  for (const url of ['http://x.com/i/saved', 'https://x.com:8443/i/saved', 'https://x.com.evil/i/saved', 'https://user:pass@x.com/i/saved',
    'javascript:alert(1)', 'https://x.com/', 'https://x.com/home', 'https://x.com/settings/profile', 'https://x.com/intent/tweet',
    'https://x.com/i/flow/login', 'https://x.com/sample', 'https://x.com/sample/status/1', 'https://x.com/i/web/status/1',
    'https://x.com/i/%73aved', 'https://x.com/i/saved#likes', 'https://x.com/i/sa\nved', 'https://x.com/i\\saved', `https://x.com/i/${'a'.repeat(2048)}`]) {
    expect(() => validateImportLocations({ ...locations, bookmarks: url }), url).toThrow();
  }
  for (const value of [null, [], {}, { ...locations, likes: locations.bookmarks }, { ...locations, bookmarks: 'https://x.com/sample/likes' }, { ...locations, likes: DEFAULT_IMPORT_LOCATIONS.bookmarks }]) expect(() => validateImportLocations(value)).toThrow();
  expect(() => validateImportLocations({ bookmarks: 'https://x.com/i/list?a=1&b=2', likes: 'https://x.com/i/list/?b=2&a=1' })).toThrow();
});
it('validates custom source against selected tabs and retains profile owner checks', () => {
  const doc = document; doc.body.innerHTML = '<a data-testid="AppTabBar_Profile_Link" href="/sample">Profile</a>';
  expect(libraryScope(doc, locations.bookmarks)).toBeNull();
  expect(libraryScope(doc, locations.bookmarks, locations)).toBe('bookmarks');
  const tab = doc.createElement('button'); tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', 'true'); doc.body.append(tab);
  tab.textContent = 'Likes';
  expect(libraryScope(doc, locations.bookmarks, locations)).toBeNull();
  expect(libraryScope(doc, locations.likes, locations)).toBe('likes');
  tab.textContent = 'Posts'; expect(libraryScope(doc, locations.likes, locations)).toBeNull();
  tab.textContent = 'ブックマーク'; expect(libraryScope(doc, locations.bookmarks, locations)).toBe('bookmarks');
  const other = tab.cloneNode(true); doc.body.append(other); expect(libraryScope(doc, locations.bookmarks, locations)).toBeNull();
  expect(libraryScope(doc, 'https://x.com/another/likes', locations)).toBeNull();
  expect(libraryScope(doc, 'https://x.com/sample/likes', locations)).toBe('likes');
});
it('persists only validated URLs and isolates display settings transfer', async () => {
  const store = new LibraryDB(`import-locations-${crypto.randomUUID()}`); stores.push(store);
  expect(await loadImportLocations(store)).toEqual(DEFAULT_IMPORT_LOCATIONS);
  await saveImportLocations(locations, store);
  await expect(saveImportLocations({ ...locations, likes: 'https://evil.invalid/likes' }, store)).rejects.toThrow();
  expect(await loadImportLocations(store)).toEqual(locations);
  const exported = await createSettingsBackup(store);
  expect(Object.keys(exported.settings).sort()).toEqual(['columns', 'language', 'layout', 'previews', 'theme']);
  await restoreSettingsBackup(exported, store); expect(await loadImportLocations(store)).toEqual(locations);
  await store.settings.put({ key: IMPORT_LOCATIONS_KEY, value: { bookmarks: 'https://evil.invalid', likes: locations.likes } });
  expect(await loadImportLocations(store)).toEqual(DEFAULT_IMPORT_LOCATIONS);
});
