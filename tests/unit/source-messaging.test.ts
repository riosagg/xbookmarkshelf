import 'fake-indexeddb/auto';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { db, likesDB } from '../../src/db';
import { observation } from './helpers';
import { saveImportLocations } from '../../src/import-locations-store';
import { DEFAULT_IMPORT_LOCATIONS } from '../../src/import-locations';

const id = 'synthetic-extension';
let listener: (message: unknown, sender: chrome.runtime.MessageSender, reply: (value: any) => void) => void;
const pages = new Map<number, { source: 'bookmarks' | 'likes'; handle: string; url: string }>();
const inspections: unknown[] = [];
const fromPage = { id, url: `chrome-extension://${id}/popup.html` };
const fromTab = (tabId: number) => ({ id, tab: { id: tabId } as chrome.tabs.Tab, frameId: 0, documentId: `doc-${tabId}`, url: pages.get(tabId)!.url });
const send = (message: unknown, sender: chrome.runtime.MessageSender = fromPage): Promise<any> => new Promise(resolve => listener(message, sender, resolve));
beforeAll(async () => {
  vi.stubGlobal('chrome', {
    runtime: { id, getURL: (path: string) => `chrome-extension://${id}/${path}`, onMessage: { addListener: (value: typeof listener) => { listener = value; } }, onStartup: { addListener: vi.fn() } },
    scripting: { executeScript: async ({ target }: { target: { tabId: number } }) => [{ frameId: 0, documentId: `doc-${target.tabId}` }] },
    tabs: { get: async (tabId: number) => ({ id: tabId, url: pages.get(tabId)?.url }),
      sendMessage: async (tabId: number, message: { type: string; locations?: unknown }) => {
        if (message.type === 'INSPECT') { inspections.push(message.locations); return { ...pages.get(tabId), bookmarkSelected: pages.get(tabId)?.source === 'bookmarks', restricted: false }; }
        return { started: true };
      },
      onRemoved: { addListener: vi.fn() }, onUpdated: { addListener: vi.fn() } },
  });
  await import('../../src/background');
});
beforeEach(async () => {
  for (const store of [db, likesDB]) for (const table of store.tables) await table.clear();
  pages.clear();
  inspections.length = 0;
  pages.set(1, { source: 'bookmarks', handle: 'sample', url: 'https://x.com/i/history' });
  pages.set(2, { source: 'likes', handle: 'sample', url: 'https://x.com/sample/likes' });
});
afterAll(async () => { await db.delete(); await likesDB.delete(); vi.unstubAllGlobals(); });
const start = (tabId: number, source?: unknown) => send({ type: 'START', tabId, source, handle: 'sample', options: { intervalMs: 3000, maxPosts: 10, mode: 'full' } });

it('serializes simultaneous starts across separate sources and retains legacy default', async () => {
  const results = await Promise.all([start(1), start(2, 'likes')]);
  expect(results.filter(r => r.ok)).toHaveLength(1);
  expect(results.find(r => !r.ok)?.error).toContain('実行中');
  expect(await db.importRuns.count() + await likesDB.importRuns.count()).toBe(1);
  expect((await send({ type: 'STATUS' })).value.source).toBe('bookmarks');
  expect((await send({ type: 'STATUS', source: 'likes' })).value).toBeUndefined();
});
it('routes commits/status/stop to Likes and rejects forged source, frame and document bindings', async () => {
  const started = await start(2, 'likes'); expect(started.ok).toBe(true);
  const batch = { type: 'BATCH', runId: started.value.id, source: 'likes', sequence: 0, posts: [observation('1')] };
  expect((await send({ ...batch, source: 'bookmarks' }, fromTab(2))).ok).toBe(false);
  expect((await send(batch, { ...fromTab(2), frameId: 1 })).ok).toBe(false);
  expect((await send(batch, { ...fromTab(2), documentId: 'another-document' })).ok).toBe(false);
  expect((await send(batch, fromTab(2))).value.added).toBe(1);
  expect(await db.posts.count()).toBe(0); expect(await likesDB.posts.count()).toBe(1);
  expect((await send({ type: 'STOP', source: 'bookmarks', runId: started.value.id })).ok).toBe(false);
  expect((await send({ type: 'STOP', source: 'likes', runId: started.value.id, pause: true })).value.state).toBe('paused');
});
it('inspects and imports the explicit History Likes URL only into the Likes database, then stops on collection changes', async () => {
  pages.set(2, { source: 'likes', handle: 'sample', url: 'https://x.com/i/history/likes' });
  expect((await send({ type: 'INSPECT_TAB', tabId: 2 })).value).toMatchObject({ source: 'likes', handle: 'sample' });
  expect((await start(2, 'bookmarks')).ok).toBe(false);
  const started = await start(2, 'likes'); expect(started.ok).toBe(true);
  expect((await send({ type: 'BATCH', runId: started.value.id, source: 'likes', sequence: 0, posts: [observation('1')] }, fromTab(2))).value.added).toBe(1);
  pages.set(2, { source: 'bookmarks', handle: 'sample', url: 'https://x.com/i/history' });
  expect((await send({ type: 'BATCH', runId: started.value.id, source: 'likes', sequence: 1, posts: [observation('2')] }, fromTab(2))).value.reason).toBe('source_scope_changed');
  expect(await likesDB.posts.count()).toBe(1); expect(await db.posts.count()).toBe(0);
});
it('checks the current scope again before commit and validates page sources/query URLs', async () => {
  expect((await start(2)).ok).toBe(false);
  expect((await start(2, 'unknown')).ok).toBe(false);
  expect((await send({ type: 'STATUS' }, { id, url: `chrome-extension://${id}/library.html?source=unknown` })).ok).toBe(false);
  expect((await send({ type: 'STATUS', source: 'likes' }, { id, url: `chrome-extension://${id}/library.html?source=likes` })).ok).toBe(true);
  const started = await start(2, 'likes');
  pages.set(2, { source: 'bookmarks', handle: 'sample', url: 'https://x.com/i/history' });
  const result = await send({ type: 'BATCH', source: 'likes', runId: started.value.id, sequence: 0, posts: [observation()] }, fromTab(2));
  expect(result.value.reason).toBe('source_scope_changed');
  expect(await likesDB.posts.count()).toBe(0); expect(await db.posts.count()).toBe(0);
});

it('persists a valid random range in the selected source and rejects an inverted range before writes', async () => {
  const base = { type: 'START', source: 'likes', tabId: 2, handle: 'sample' };
  const invalid = await send({ ...base, options: { intervalMs: 8000, intervalMaxMs: 5000, maxPosts: 10, mode: 'full' } });
  expect(invalid.ok).toBe(false); expect(await likesDB.importRuns.count()).toBe(0);
  const started = await send({ ...base, options: { intervalMs: 3000, intervalMaxMs: 8000, maxPosts: 10, mode: 'full' } });
  expect(started.value).toMatchObject({ source: 'likes', intervalMs: 3000, intervalMaxMs: 8000 });
  expect(await likesDB.importRuns.get(started.value.id)).toMatchObject({ intervalMaxMs: 8000 });
  expect(await db.importRuns.count()).toBe(0);
});

it('uses saved custom URLs throughout a run, rejects overrides and keeps its start snapshot after settings changes', async () => {
  const locations = { bookmarks: 'https://x.com/i/saved-posts', likes: 'https://x.com/i/liked-posts' };
  pages.set(2, { source: 'likes', handle: 'sample', url: locations.likes });
  expect((await send({ type: 'INSPECT_TAB', tabId: 2, locations })).ok).toBe(false);
  expect((await send({ type: 'START', tabId: 2, source: 'likes', handle: 'sample', options: { intervalMs: 3000, maxPosts: 10, mode: 'full' }, locations })).ok).toBe(false);
  expect(await likesDB.importRuns.count()).toBe(0);
  await saveImportLocations(locations);
  expect((await send({ type: 'INSPECT_TAB', tabId: 2 })).value.source).toBe('likes');
  const started = await start(2, 'likes'); expect(started.ok).toBe(true);
  expect(started.value.importLocations).toEqual(locations);
  await saveImportLocations(DEFAULT_IMPORT_LOCATIONS);
  const batch = { type: 'BATCH', runId: started.value.id, source: 'likes', sequence: 0, posts: [observation('1')] };
  expect((await send(batch, { ...fromTab(2), url: 'https://evil.invalid/i/liked-posts' })).ok).toBe(false);
  expect((await send(batch, { ...fromTab(2), documentId: 'different' })).ok).toBe(false);
  expect((await send(batch, fromTab(2))).value.added).toBe(1);
  expect(inspections.at(-1)).toEqual(locations);
  expect(await db.posts.count()).toBe(0);
  pages.set(2, { source: 'bookmarks', handle: 'sample', url: locations.bookmarks });
  expect((await send({ ...batch, sequence: 1, posts: [observation('2')] }, fromTab(2))).value.reason).toBe('source_scope_changed');
  expect(await likesDB.posts.count()).toBe(1);
  expect((await send({ type: 'INSPECT_TAB', tabId: 2 })).ok).toBe(false);
});
