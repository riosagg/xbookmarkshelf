import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryDB, markPostRead, togglePostRead, newRun } from '../../src/db';
import { prepareDeletion, deletePosts, storageUsage, formatStorageBytes, type DeletionPlan } from '../../src/post-data';
import { createBackup, restoreBackup } from '../../src/backup';
import { togglePostMark } from '../../src/marks';
import { DEFAULT_OPTIONS } from '../../src/model';
import { observation, timestamp } from './helpers';

let store: LibraryDB;
const largeId = '9007199254740993123';
beforeEach(async () => {
  store = new LibraryDB(`delete-${crypto.randomUUID()}`);
  for (const [accountId, postId] of [['a', largeId], ['b', largeId], ['a', '2']]) {
    const post = { ...observation(postId), media: [{ kind: 'image' as const, url: 'https://pbs.twimg.com/media/synthetic.jpg' }], accountId: accountId!, firstImportedAt: timestamp, lastImportedAt: timestamp };
    await store.posts.put(post);
    await store.media.put({ accountId: accountId!, postId: postId!, index: 0, ...post.media[0]! });
    await store.userStates.put({ accountId: accountId!, postId: postId!, read: true, favorite: true });
    await store.postTags.put({ accountId: accountId!, postId: postId!, tagId: `${accountId}-mark` });
  }
  await store.tags.bulkPut([{ id: 'a-mark', accountId: 'a', name: '残すマーク', mark: 'book', markOrder: 0 }, { id: 'b-mark', accountId: 'b', name: 'Keep', mark: 'star', markOrder: 0 }]);
  await store.settings.bulkPut([{ key: 'accounts', value: [{ id: 'a', handle: 'sample_a' }, { id: 'b', handle: 'sample_b' }] }, { key: 'theme', value: 'dark' }, { key: 'language', value: 'en' }]);
  await store.savedFilters.put({ id: 'keep-filter', name: 'Filter', value: {} });
  const run = newRun({ id: 'a', handle: 'sample_a' }, 7, 'synthetic', DEFAULT_OPTIONS);
  await store.importRuns.put({ ...run, state: 'stopped', reason: 'manual_stop' });
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await store.delete(); });
async function snapshot() { return Promise.all(store.tables.map(async table => [table.name, await table.toArray()])); }

describe('explicit local post deletion', () => {
  it('previews without writes and deletes only selected composite keys and their assignments', async () => {
    const before = await snapshot();
    const input: [string, string][] = [['a', largeId]];
    const plan = await prepareDeletion('selected', input, store);
    input[0]![0] = 'b';
    expect(await snapshot()).toEqual(before);
    expect(await deletePosts(plan, store)).toBe(1);
    expect(await store.posts.get(['a', largeId])).toBeUndefined();
    expect(await store.posts.get(['b', largeId])).toBeDefined();
    expect(await store.posts.get(['a', '2'])).toBeDefined();
    expect(await store.userStates.count()).toBe(2); expect(await store.postTags.count()).toBe(2); expect(await store.media.count()).toBe(2);
    for (const table of [store.tags, store.settings, store.importRuns, store.savedFilters]) expect(await table.toArray()).toEqual(before.find(row => row[0] === table.name)![1]);
  });
  it('clears all post tables and orphan assignments while preserving definitions, settings and history', async () => {
    await store.postTags.put({ accountId: 'a', postId: '999', tagId: 'a-mark' });
    const before = await snapshot();
    expect(await deletePosts(await prepareDeletion('all', [], store), store)).toBe(3);
    for (const table of [store.posts, store.media, store.userStates, store.postTags]) expect(await table.count()).toBe(0);
    for (const table of [store.tags, store.settings, store.importRuns, store.savedFilters]) expect(await table.toArray()).toEqual(before.find(row => row[0] === table.name)![1]);
    expect(store.verno).toBe(1);
  });
  it.each(['selected', 'all'] as const)('rolls back every related table after a %s deletion failure', async scope => {
    const plan = await prepareDeletion(scope, [['a', largeId]], store);
    const before = await snapshot();
    const fault = scope === 'all' ? vi.spyOn(store.userStates, 'clear') : vi.spyOn(store.userStates, 'bulkDelete');
    fault.mockRejectedValueOnce(new Error('Synthetic write failure'));
    await expect(deletePosts(plan, store)).rejects.toThrow('Synthetic');
    expect(await snapshot()).toEqual(before);
  });
  it('rejects invalid, empty, duplicate, oversized or stale selections without writes', async () => {
    const before = await snapshot();
    const inputs = [[], [['a', largeId], ['a', largeId]], [['a', 123]], [['a', 'not-numeric']], Array.from({ length: 51 }, (_, i) => ['a', String(i)])];
    for (const keys of inputs) await expect(prepareDeletion('selected', keys as [string, string][], store)).rejects.toThrow();
    await expect(prepareDeletion('selected', [['a', '404']], store)).rejects.toThrow('変更');
    await expect(deletePosts({ scope: 'everything', keys: [['a', largeId]] } as unknown as DeletionPlan, store)).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });
  it('rejects changed all-post targets even if the total count is unchanged', async () => {
    const plan = await prepareDeletion('all', [], store);
    const old = (await store.posts.get(['a', '2']))!;
    await store.posts.delete(['a', '2']); await store.posts.put({ ...old, postId: '3', url: 'https://x.com/test_author/status/3' });
    const before = await snapshot();
    await expect(deletePosts(plan, store)).rejects.toThrow('変更');
    expect(await snapshot()).toEqual(before);
  });
  it('checks running imports both before confirmation and in the write transaction', async () => {
    const plan = await prepareDeletion('all', [], store);
    const run = newRun({ id: 'b', handle: 'sample_b' }, 8, 'synthetic-new', DEFAULT_OPTIONS);
    await store.importRuns.add(run);
    const before = await snapshot();
    await expect(prepareDeletion('selected', [['a', largeId]], store)).rejects.toThrow('停止');
    await expect(deletePosts(plan, store)).rejects.toThrow('停止');
    expect(await snapshot()).toEqual(before);
  });
  it('does not delete restored posts added after all-deletion confirmation', async () => {
    const plan = await prepareDeletion('all', [], store);
    const backup = await createBackup(store);
    backup.posts.push({ ...backup.posts[0]!, postId: '99', url: 'https://x.com/test_author/status/99' });
    const result = await Promise.allSettled([restoreBackup(backup, store), deletePosts(plan, store)]);
    expect(result[0].status).toBe('fulfilled'); expect(result[1].status).toBe('rejected');
    expect(await store.posts.count()).toBe(4); expect(await store.posts.get(['a', '99'])).toBeDefined();
    expect(await store.userStates.count()).toBe(3); expect(await store.postTags.count()).toBe(3);
  });
  it('rejects a stale selection without partially deleting the remaining target', async () => {
    const plan = await prepareDeletion('selected', [['a', largeId], ['a', '2']], store);
    await deletePosts(await prepareDeletion('selected', [['a', largeId]], store), store);
    const before = await snapshot();
    await expect(deletePosts(plan, store)).rejects.toThrow('変更');
    expect(await snapshot()).toEqual(before); expect(await store.posts.get(['a', '2'])).toBeDefined();
  });
  it('does not recreate read states or mark assignments after a concurrent deletion', async () => {
    const plan = await prepareDeletion('selected', [['a', largeId]], store);
    await Promise.allSettled([deletePosts(plan, store), togglePostRead('a', largeId, store), togglePostMark('a', largeId, 'a-mark', store)]);
    expect(await store.posts.get(['a', largeId])).toBeUndefined();
    expect(await store.userStates.get(['a', largeId])).toBeUndefined();
    expect(await store.postTags.where('[accountId+postId]').equals(['a', largeId]).count()).toBe(0);
    await expect(markPostRead('a', largeId, store)).rejects.toThrow('見つかりません');
    await expect(togglePostRead('a', largeId, store)).rejects.toThrow('見つかりません');
    expect(await store.userStates.get(['a', largeId])).toBeUndefined();
  });
  it('restores posts and classifications from a pre-deletion JSON backup', async () => {
    const backup = await createBackup(store);
    await deletePosts(await prepareDeletion('all', [], store), store);
    await restoreBackup(backup, store);
    const restored = await createBackup(store);
    expect(restored.posts).toEqual(backup.posts); expect(restored.tags).toEqual(backup.tags);
    expect(restored.userStates).toEqual(backup.userStates); expect(restored.postTags).toEqual(backup.postTags);
    expect((await store.settings.get('theme'))?.value).toBe('dark');
  });
});
describe('browser storage estimates', () => {
  it('reads available usage and treats unsupported, missing, invalid or failed estimates as unavailable', async () => {
    for (const value of [0, 2048, undefined, -1, NaN]) {
      vi.stubGlobal('navigator', { storage: { estimate: async () => ({ usage: value }) } });
      expect(await storageUsage()).toBe(typeof value === 'number' && value >= 0 ? value : null);
    }
    vi.stubGlobal('navigator', {}); expect(await storageUsage()).toBeNull();
    vi.stubGlobal('navigator', { storage: { estimate: async () => { throw new Error('Unavailable'); } } }); expect(await storageUsage()).toBeNull();
  });
  it('formats byte units without interpreting quota as storage used', () => {
    expect(formatStorageBytes(0, 'ja-JP')).toBe('0 B');
    expect(formatStorageBytes(1536, 'en-US')).toBe('1.5 KiB');
    expect(formatStorageBytes(1024 ** 2, 'en-US')).toBe('1 MiB');
    expect(formatStorageBytes(1024 ** 3, 'ja-JP')).toBe('1 GiB');
  });
});
