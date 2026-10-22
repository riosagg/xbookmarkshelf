import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryDB, accountFor, commitBatch, finishRun, newRun, pagePosts, windowPosts, libraryMetadata, markPostRead } from '../../src/db';
import { DEFAULT_OPTIONS } from '../../src/model';
import { createBackup, restoreBackup } from '../../src/backup';
import { observation } from './helpers';

let store: LibraryDB;
beforeEach(() => { store = new LibraryDB(`test-${crypto.randomUUID()}`); });
afterEach(async () => { await store.delete(); });
async function runFor(handle = 'sample', maxPosts = 100) {
  const account = await accountFor(handle, store);
  const run = newRun(account, 7, 'document-id', { ...DEFAULT_OPTIONS, maxPosts });
  await store.importRuns.add(run); return run;
}
describe('persistent batch commits', () => {
  it('adds missing photos on re-import, deduplicates size variants and round-trips all media with edits', async () => {
    const run = await runFor(); const p = observation('1');
    const cover = { kind: 'image' as const, url: 'https://pbs.twimg.com/media/one?format=jpg&name=small' };
    await commitBatch(run.id, 0, [{ ...p, media: [cover] }], store);
    const state = { accountId: run.accountId, postId: '1', read: true, favorite: true };
    const tag = { id: 'protected-mark', accountId: run.accountId, name: '保存するマーク', mark: 'book' as const };
    const relation = { accountId: run.accountId, postId: '1', tagId: tag.id };
    await store.userStates.put(state); await store.tags.put(tag); await store.postTags.put(relation);
    const next = await runFor();
    const result = await commitBatch(next.id, 0, [{ ...p, media: [{ ...cover, url: 'https://pbs.twimg.com/media/one?format=webp&name=large' }, ...['two', 'three', 'four'].map(id => ({ kind: 'image' as const, url: `https://pbs.twimg.com/media/${id}.jpg` }))] }], store);
    expect(result.added).toBe(0); expect(result.existing).toBe(1); expect(await store.posts.count()).toBe(1);
    expect(await store.media.count()).toBe(4);
    const missing = await runFor(); await commitBatch(missing.id, 0, [p], store);
    const backup = await createBackup(store); expect(backup.posts[0]?.media).toHaveLength(4);
    expect(await store.tags.get(tag.id)).toEqual(tag); expect(await store.postTags.toArray()).toEqual([relation]);
    const destination = new LibraryDB(`gallery-${crypto.randomUUID()}`);
    try {
      await restoreBackup(backup, destination);
      expect((await destination.posts.get([run.accountId, '1']))?.media).toEqual(backup.posts[0]?.media);
      expect(await destination.media.count()).toBe(4); expect(await destination.userStates.get([run.accountId, '1'])).toEqual(state);
      const restoredTag = await destination.tags.where('[accountId+name]').equals([tag.accountId, tag.name]).first();
      expect(restoredTag).toMatchObject({ accountId: tag.accountId, name: tag.name, mark: tag.mark });
      expect(await destination.postTags.toArray()).toEqual([{ ...relation, tagId: restoredTag!.id }]);
    } finally { await destination.delete(); }
  });
  it('keeps large IDs as strings and separates accounts', async () => {
    const a = await runFor('sample'); const b = await runFor('another');
    await commitBatch(a.id, 0, [observation()], store); await commitBatch(b.id, 0, [observation()], store);
    expect(await store.posts.count()).toBe(2);
    expect((await store.posts.get([a.accountId, observation().postId]))?.postId).toBe('9007199254740993123');
  });
  it('deduplicates retransmitted batches and rejects altered replay', async () => {
    const run = await runFor();
    const first = await commitBatch(run.id, 0, [observation()], store);
    const replay = await commitBatch(run.id, 0, [observation()], store);
    expect(replay).toEqual(first); expect(replay.added).toBe(1);
    await expect(commitBatch(run.id, 0, [observation(undefined, '差し替え')], store)).rejects.toThrow('順序');
    expect(await store.posts.count()).toBe(1);
  });
  it('preserves user edits and fuller content on another import', async () => {
    const run = await runFor(); const p = observation(undefined, '長い完全に表示されたテスト本文');
    await commitBatch(run.id, 0, [p], store);
    const state = { accountId: run.accountId, postId: p.postId, read: true, favorite: true };
    await store.userStates.put(state);
    await store.tags.put({ id: 'tag-1', accountId: run.accountId, name: '保護するタグ' });
    await store.postTags.put({ accountId: run.accountId, postId: p.postId, tagId: 'tag-1' });
    const next = await runFor(); await commitBatch(next.id, 0, [observation(undefined, '短い')], store);
    expect((await store.posts.get([run.accountId, p.postId]))?.text).toBe(p.text);
    expect(await store.userStates.get([run.accountId, p.postId])).toEqual(state);
    expect(await store.postTags.count()).toBe(1);
  });
  it('rolls back posts, media and checkpoint together on a write failure', async () => {
    const run = await runFor(); const p = { ...observation(), media: [{ kind: 'image' as const, url: 'https://pbs.twimg.com/media/test.jpg' }] };
    const fault = vi.spyOn(store.media, 'bulkPut').mockRejectedValueOnce(new Error('QuotaExceededError'));
    await expect(commitBatch(run.id, 0, [p], store)).rejects.toThrow(); fault.mockRestore();
    expect(await store.posts.count()).toBe(0); expect((await store.importRuns.get(run.id))?.nextSequence).toBe(0);
    await commitBatch(run.id, 0, [p], store); expect(await store.posts.count()).toBe(1);
  });
  it('does not write after pause and can re-scan without data loss', async () => {
    const run = await runFor(); await commitBatch(run.id, 0, [observation()], store);
    await finishRun(run.id, 'user_pause', store);
    await commitBatch(run.id, 1, [observation('123')], store);
    expect(await store.posts.count()).toBe(1);
    const next = await runFor(); const result = await commitBatch(next.id, 0, [observation(), observation('123')], store);
    expect(result.existing).toBe(1); expect(result.added).toBe(1);
  });
  it('stops at the per-run cap and at the delta threshold', async () => {
    const capped = await runFor('capped', 10);
    const result = await commitBatch(capped.id, 0, Array.from({ length: 10 }, (_, i) => observation(String(i + 1))), store);
    expect(result.reason).toBe('run_limit');
    const full = await runFor('delta');
    for (let batch = 0; batch < 3; batch++) await commitBatch(full.id, batch, Array.from({ length: 10 }, (_, i) => observation(String(batch * 10 + i + 1))), store);
    const delta = await runFor('delta'); await store.importRuns.update(delta.id, { mode: 'delta' });
    for (let batch = 0; batch < 3; batch++) await commitBatch(delta.id, batch, Array.from({ length: 10 }, (_, i) => observation(String(batch * 10 + i + 1))), store);
    expect((await store.importRuns.get(delta.id))?.reason).toBe('known_threshold');
  });
  it('continues from visible posts past thirty known posts without losing edits or adding duplicates', async () => {
    const seed = await runFor('visible', 40);
    const posts = Array.from({ length: 40 }, (_, i) => observation(String(i + 1)));
    for (let batch = 0; batch < 4; batch++) await commitBatch(seed.id, batch, posts.slice(batch * 10, batch * 10 + 10), store);
    const state = { accountId: seed.accountId, postId: '1', read: true, favorite: true };
    await store.userStates.put(state);
    const run = newRun({ id: seed.accountId, handle: seed.handle }, 7, 'doc', { ...DEFAULT_OPTIONS, mode: 'visible', maxPosts: 40 });
    await store.importRuns.add(run);
    for (let batch = 0; batch < 4; batch++) await commitBatch(run.id, batch, posts.slice(batch * 10, batch * 10 + 10), store);
    expect(await store.importRuns.get(run.id)).toMatchObject({ observed: 40, existing: 40, added: 0, reason: 'run_limit' });
    expect(await store.posts.count()).toBe(40); expect(await store.userStates.get([seed.accountId, '1'])).toEqual(state);
  });
  it('retains data across closing and opening the database', async () => {
    const run = await runFor(); await commitBatch(run.id, 0, [observation()], store);
    store.close(); await store.open(); expect(await store.posts.count()).toBe(1);
  });
});
describe('JSON restore', () => {
  it('restores new posts but preserves existing states and tags on repeat', async () => {
    const run = await runFor(); await commitBatch(run.id, 0, [observation()], store);
    await store.userStates.add({ accountId: run.accountId, postId: observation().postId, read: true, favorite: true });
    await store.tags.put({ id: 'tag-1', accountId: run.accountId, name: 'テスト' });
    await store.postTags.put({ accountId: run.accountId, postId: observation().postId, tagId: 'tag-1' });
    const backup = await createBackup(store);
    const destination = new LibraryDB(`restore-${crypto.randomUUID()}`);
    try {
      expect((await restoreBackup(backup, destination)).added).toBe(1);
      await destination.userStates.update([run.accountId, observation().postId], { read: false });
      expect((await restoreBackup(backup, destination)).existing).toBe(1);
      expect((await destination.userStates.get([run.accountId, observation().postId]))?.read).toBe(false);
      expect(await destination.tags.count()).toBe(1); expect(await destination.postTags.count()).toBe(1);
    } finally { await destination.delete(); }
  });
  it('rejects future versions, bad URLs and orphan relations without DB changes', async () => {
    const run = await runFor(); await commitBatch(run.id, 0, [observation()], store); const backup = await createBackup(store);
    for (const invalid of [ { ...backup, formatVersion: 99 }, { ...backup, posts: [{ ...backup.posts[0], url: 'javascript:alert(1)' }] }, { ...backup, postTags: [{ accountId: run.accountId, postId: '123', tagId: 'missing' }] } ]) {
      await expect(restoreBackup(invalid, store)).rejects.toThrow(); expect(await store.posts.count()).toBe(1);
    }
  });
});
describe('library queries', () => {
  it('marks opened posts read idempotently while preserving favorite and account separation', async () => {
    await store.posts.bulkPut([['a', '1'], ['a', '2'], ['b', '1']].map(([accountId, postId]) => ({ ...observation(postId), accountId: accountId!, firstImportedAt: new Date().toISOString(), lastImportedAt: new Date().toISOString() })));
    await store.userStates.put({ accountId: 'a', postId: '1', read: false, favorite: true });
    await store.userStates.put({ accountId: 'b', postId: '1', read: false, favorite: false });
    await markPostRead('a', '1', store); await markPostRead('a', '1', store);
    expect(await store.userStates.get(['a', '1'])).toMatchObject({ read: true, favorite: true });
    expect((await store.userStates.get(['b', '1']))?.read).toBe(false);
    expect(await markPostRead('a', '2', store)).toMatchObject({ read: true, favorite: false });
  });
  it('combines account, text, read, favorite and tag filters without crossing accounts', async () => {
    const a = await runFor('one'); const b = await runFor('two');
    await commitBatch(a.id, 0, [observation('1', '日本語 ＡＢＣ'), observation('2', '日本語 abc')], store);
    await commitBatch(b.id, 0, [observation('1', '日本語 abc')], store);
    await store.userStates.bulkPut([{ accountId: a.accountId, postId: '1', read: true, favorite: true }, { accountId: b.accountId, postId: '1', read: false, favorite: true }]);
    await store.tags.put({ id: 'tag', accountId: a.accountId, name: '読書' });
    await store.postTags.put({ accountId: a.accountId, postId: '1', tagId: 'tag' });
    expect((await pagePosts(a.accountId, 'abc', 0, { favorite: true, read: true, tagId: 'tag' }, store)).rows.map(p => p.postId)).toEqual(['1']);
    expect((await pagePosts(a.accountId, '', 0, { read: false }, store)).rows.map(p => p.postId)).toEqual(['2']);
    expect((await pagePosts(b.accountId, '', 0, { tagId: 'tag' }, store)).total).toBe(0);
    const meta = await libraryMetadata(a.accountId, store);
    expect(meta).toMatchObject({ total: 2, favorites: 1, unread: 1 }); expect(meta.tags[0]?.count).toBe(1);
  });
  it('reads only one page and reverses the import-time order when requested', async () => {
    const account = await accountFor('pages', store);
    await store.posts.bulkPut(Array.from({ length: 51 }, (_, i) => ({ ...observation(String(i + 1)), accountId: account.id, firstImportedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), lastImportedAt: '2026-10-10T08:00:00.000Z' })));
    const first = await pagePosts(account.id, '', 0, {}, store); const second = await pagePosts(account.id, '', 1, {}, store);
    expect(first.total).toBe(51); expect(first.rows).toHaveLength(50); expect(second.rows).toHaveLength(1); expect(first.rows[0]?.postId).toBe('51');
    expect((await pagePosts(account.id, '', 0, { oldestFirst: true }, store)).rows[0]?.postId).toBe('1');
  });
});
it('fills URLs and video classification on rescan without losing fuller text or user state', async () => {
  const run = await runFor();
  await commitBatch(run.id, 0, [{ ...observation('1', '保持する長い本文'.repeat(20)), media: [{ kind: 'image', url: 'https://pbs.twimg.com/media/poster.jpg' }] }], store);
  await store.userStates.put({ accountId: run.accountId, postId: '1', read: true, favorite: true });
  const next = await runFor();
  const result = await commitBatch(next.id, 0, [{ ...observation('1', '短い本文 https://example.invalid/article'), media: [{ kind: 'video', url: 'https://pbs.twimg.com/media/poster.jpg' }] }], store);
  expect(result.added).toBe(0); expect(result.existing).toBe(1);
  const post = (await store.posts.get([run.accountId, '1']))!;
  expect(post.text).toBe('保持する長い本文'.repeat(20) + '\nhttps://example.invalid/article'); expect(post.media).toHaveLength(1); expect(post.media[0]?.kind).toBe('video');
  const third = await runFor(); await commitBatch(third.id, 0, [{ ...observation('1'), media: [{ kind: 'image', url: 'https://pbs.twimg.com/media/poster.jpg' }] }], store);
  expect((await store.posts.get([run.accountId, '1']))?.media[0]?.kind).toBe('video');
  const backup = await createBackup(store); await restoreBackup(backup, store);
  expect((await store.posts.get([run.accountId, '1']))?.text).toBe(post.text);
  expect(await store.userStates.get([run.accountId, '1'])).toMatchObject({ read: true, favorite: true });
});

it('keeps link-card references on missing observations and JSON roundtrips, without counting them as post media', async () => {
  const run = await runFor();
  const card = { url: 'https://example.invalid/story', title: '記事の見出し', imageUrl: 'https://pbs.twimg.com/card_img/123.jpg' };
  const p = { ...observation('1', '記事 https://example.invalid/story'), linkCards: [card] };
  await commitBatch(run.id, 0, [p], store);
  // A previous reader may have mistaken a nested card photo for post media.
  await store.posts.update([run.accountId, '1'], { media: [{ kind: 'image', url: card.imageUrl }] });
  await store.userStates.put({ accountId: run.accountId, postId: '1', read: true, favorite: true });
  const next = await runFor(); await commitBatch(next.id, 0, [observation('1', '記事')], store);
  expect((await store.posts.get([run.accountId, '1']))?.linkCards).toEqual([card]);
  expect((await pagePosts('', '', 0, { media: 'without' }, store)).total).toBe(1);
  expect((await pagePosts('', '', 0, { media: 'image' }, store)).total).toBe(0);
  const latest = await runFor();
  await commitBatch(latest.id, 0, [{ ...p, linkCards: [{ ...card, title: '', imageUrl: 'https://pbs.twimg.com/card_img/updated.jpg' }] }], store);
  const expected = [{ ...card, imageUrl: 'https://pbs.twimg.com/card_img/updated.jpg' }];
  const backup = await createBackup(store);
  expect(backup.posts[0]?.linkCards).toEqual(expected);
  const destination = new LibraryDB(`cards-${crypto.randomUUID()}`);
  try {
    await restoreBackup(backup, destination);
    expect((await destination.posts.get([run.accountId, '1']))?.linkCards).toEqual(expected);
    const legacy = { ...backup, formatVersion: 1, posts: backup.posts.map(({ linkCards: _cards, ...post }) => post) };
    await restoreBackup(legacy, destination);
    expect((await destination.posts.get([run.accountId, '1']))?.linkCards).toEqual(expected);
    expect(await destination.userStates.get([run.accountId, '1'])).toMatchObject({ read: true, favorite: true });
    await expect(restoreBackup({ ...backup, posts: [{ ...backup.posts[0], linkCards: [{ ...card, imageUrl: 'https://other.invalid/track.jpg' }] }] }, destination)).rejects.toThrow('リンクカード');
    expect(await destination.posts.count()).toBe(1);
  } finally { await destination.delete(); }
});

it('reads bounded overlapping scroll windows without crossing accounts and keeps page compatibility', async () => {
  for (const accountId of ['a', 'b']) await store.posts.bulkPut(Array.from({ length: 125 }, (_, i) => {
    const date = new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString();
    return { ...observation(String(i), `Window ${i}`), accountId, firstImportedAt: date, lastImportedAt: date };
  }));
  const first = await windowPosts('a', '', 0, 50, { oldestFirst: true }, store);
  const next = await windowPosts('a', '', 30, 50, { oldestFirst: true }, store);
  expect(first.total).toBe(125); expect(next.rows.map(p => p.postId)).toEqual(Array.from({ length: 50 }, (_, i) => String(i + 30)));
  expect(next.rows.every(p => p.accountId === 'a')).toBe(true);
  expect((await windowPosts('a', '', 120, 50, {}, store)).rows).toHaveLength(5);
  expect(await pagePosts('a', '', 1, {}, store)).toEqual(await windowPosts('a', '', 50, 50, {}, store));
  await expect(windowPosts('a', '', -1, 50, {}, store)).rejects.toThrow('Invalid post window');
  await expect(windowPosts('a', '', 0, 51, {}, store)).rejects.toThrow('Invalid post window');
});
