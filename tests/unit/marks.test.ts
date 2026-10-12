import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LibraryDB, accountFor, pagePosts, libraryMetadata } from '../../src/db';
import { saveMark, togglePostMark, removeMark, moveMark } from '../../src/marks';
import { MARK_SYMBOLS, MAX_MARKS, orderedMarks } from '../../src/model';
import { createBackup, restoreBackup, validateBackup } from '../../src/backup';
import { observation } from './helpers';

let store: LibraryDB;
beforeEach(() => { store = new LibraryDB(`marks-${crypto.randomUUID()}`); });
afterEach(async () => { await store.delete(); });
async function seed(handle = 'sample', postId = '1') {
  const a = await accountFor(handle, store);
  await store.posts.put({ ...observation(postId), accountId: a.id, firstImportedAt: '2026-10-10T08:00:00.000Z', lastImportedAt: '2026-10-10T08:00:00.000Z' });
  return a;
}
it('promotes existing tags, limits marks per account and preserves relations on rename or demotion', async () => {
  const a = await seed();
  await store.tags.put({ id: 'existing', accountId: a.id, name: '資料' });
  await store.postTags.put({ accountId: a.id, postId: '1', tagId: 'existing' });
  const mark = await saveMark(a.id, '資料', 'book', undefined, store);
  expect(mark.id).toBe('existing');
  for (let i = 0; i < MAX_MARKS - 1; i++) await saveMark(a.id, `分類${i}`, 'flag', undefined, store);
  await expect(saveMark(a.id, '31個目', 'heart', undefined, store)).rejects.toThrow('30個');
  await saveMark(a.id, '参考', 'bulb', mark.id, store);
  await expect(saveMark(a.id, '分類0', 'star', mark.id, store)).rejects.toThrow('同じ名前');
  expect(await store.postTags.count()).toBe(1);
  const b = await accountFor('another', store); await saveMark(b.id, '別のマーク', 'pin', undefined, store);
  await removeMark(mark.id, store);
  expect(await store.tags.get(mark.id)).toEqual({ id: 'existing', accountId: a.id, name: '参考' });
  expect(await store.postTags.count()).toBe(1);
  await saveMark(a.id, '新しいマーク', 'heart', undefined, store);
});
it('toggles multiple marks atomically without changing read or legacy favorites and rejects account crossing', async () => {
  const a = await seed(); const b = await seed('another');
  const one = await saveMark(a.id, '資料', 'book', undefined, store); const two = await saveMark(a.id, '仕事', 'flag', undefined, store);
  await store.userStates.put({ accountId: a.id, postId: '1', read: true, favorite: true });
  await Promise.all([togglePostMark(a.id, '1', one.id, store), togglePostMark(a.id, '1', two.id, store)]);
  expect(await store.postTags.count()).toBe(2);
  await togglePostMark(a.id, '1', one.id, store); expect(await store.postTags.count()).toBe(1);
  await expect(togglePostMark(b.id, '1', two.id, store)).rejects.toThrow('付けられる');
  await expect(togglePostMark(a.id, '99', two.id, store)).rejects.toThrow('付けられる');
  expect(await store.userStates.get([a.id, '1'])).toMatchObject({ read: true, favorite: true });
});
it('round-trips v2 icons and v1 tags, keeping local mark names and icons on repeat restore', async () => {
  const a = await seed(); const mark = await saveMark(a.id, '資料', 'book', undefined, store); await togglePostMark(a.id, '1', mark.id, store);
  const backup = await createBackup(store); expect(backup.formatVersion).toBe(2);
  const destination = new LibraryDB(`mark-restore-${crypto.randomUUID()}`);
  try {
    await restoreBackup(backup, destination);
    const local = (await destination.tags.toArray())[0]!; expect(local.mark).toBe('book');
    await saveMark(a.id, '資料', 'flag', local.id, destination);
    await restoreBackup(backup, destination);
    expect((await destination.tags.toArray())[0]?.mark).toBe('flag'); expect(await destination.postTags.count()).toBe(1);
    const legacy = { ...backup, formatVersion: 1, tags: backup.tags.map(({ mark: _mark, ...tag }) => tag) };
    expect(validateBackup(legacy).tags[0]?.mark).toBeUndefined(); await restoreBackup(legacy, destination);
    expect((await destination.tags.toArray())[0]?.mark).toBe('flag');
  } finally { await destination.delete(); }
});
it('rejects invalid or over-limit icons before writing and rolls back restore conflicts', async () => {
  const a = await seed(); await saveMark(a.id, '資料', 'book', undefined, store);
  const backup = await createBackup(store);
  expect(() => validateBackup({ ...backup, tags: [{ ...backup.tags[0], mark: '<script>' }] })).toThrow('アイコン');
  expect(() => validateBackup({ ...backup, tags: Array.from({ length: 31 }, (_, i) => ({ id: `mark-${i}`, accountId: a.id, name: `分類${i}`, mark: 'flag' })) })).toThrow('30個');
  const destination = new LibraryDB(`mark-conflict-${crypto.randomUUID()}`);
  try {
    const local = await accountFor('sample', destination);
    for (let i = 0; i < 30; i++) await saveMark(local.id, `既存${i}`, 'star', undefined, destination);
    await expect(restoreBackup(backup, destination)).rejects.toThrow('30個');
    expect(await destination.posts.count()).toBe(0); expect(await destination.tags.count()).toBe(30); expect(await destination.postTags.count()).toBe(0);
  } finally { await destination.delete(); }
});
it('combines author, mark, legacy-video media, safe URL and inclusive-date boundaries independently of body mentions', async () => {
  const a = await seed(); const mark = await saveMark(a.id, '資料', 'book', undefined, store); await togglePostMark(a.id, '1', mark.id, store);
  await store.posts.update([a.id, '1'], { authorHandle: 'one', authorName: 'Ａｕｔｈｏｒ', postedAt: '2026-10-01T00:00:00Z', text: '参考 https://example.invalid/', media: [{ kind: 'image', url: 'https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/a.jpg' }] });
  await store.posts.put({ ...(await store.posts.get([a.id, '1']))!, postId: '2', authorName: '別の人', authorHandle: 'two', text: 'Authorという本文', media: [], postedAt: null });
  const filters = { author: 'author', mark: 'with' as const, media: 'video' as const, links: true, postedFrom: '2026-10-01T00:00:00Z', postedBefore: '2026-10-02T00:00:00Z' };
  expect((await pagePosts(a.id, '', 0, filters, store)).rows.map(p => p.postId)).toEqual(['1']);
  expect((await pagePosts(a.id, '', 0, { mark: 'without', media: 'without', links: false }, store)).rows.map(p => p.postId)).toEqual(['2']);
  expect((await pagePosts(a.id, '', 0, { ...filters, postedFrom: '2026-10-02T00:00:00Z' }, store)).total).toBe(0);
  expect((await pagePosts(a.id, '', 0, { ...filters, media: 'image' }, store)).total).toBe(0);
});

it('counts unmarked posts once per account, ignoring ordinary tags and orphan relations as marks change', async () => {
  const a = await seed(); await seed('sample', '2'); await seed('sample', '3');
  const b = await seed('another'); await seed('another', '2');
  const one = await saveMark(a.id, '資料', 'book', undefined, store);
  const two = await saveMark(a.id, '仕事', 'flag', undefined, store);
  const other = await saveMark(b.id, '資料', 'book', undefined, store);
  await togglePostMark(a.id, '1', one.id, store); await togglePostMark(a.id, '1', two.id, store);
  await togglePostMark(a.id, '2', one.id, store); await togglePostMark(b.id, '1', other.id, store);
  await store.tags.put({ id: 'ordinary', accountId: a.id, name: '通常タグ' });
  await store.postTags.bulkPut([
    { accountId: a.id, postId: '3', tagId: 'ordinary' },
    { accountId: a.id, postId: '3', tagId: 'missing-tag' },
    { accountId: a.id, postId: 'missing-post', tagId: one.id },
  ]);
  await store.userStates.put({ accountId: a.id, postId: '3', read: true, favorite: true });
  async function checkCounts(all: number, first: number, second: number) {
    for (const [accountId, expected] of [['', all], [a.id, first], [b.id, second]] as const) {
      expect((await libraryMetadata(accountId, store)).unmarked).toBe(expected);
      expect((await pagePosts(accountId, '', 0, { mark: 'without' }, store)).total).toBe(expected);
    }
  }
  await checkCounts(2, 1, 1);
  await removeMark(one.id, store); // Its relations remain ordinary tags; the second mark still classifies post 1.
  await checkCounts(3, 2, 1);
  await togglePostMark(a.id, '1', two.id, store);
  await checkCounts(4, 3, 1);
  expect((await libraryMetadata('empty-account', store)).unmarked).toBe(0);
  expect(await store.userStates.get([a.id, '3'])).toMatchObject({ read: true, favorite: true });
  expect(await store.postTags.get([a.id, '3', 'ordinary'])).toBeDefined();
});

it('supports all 30 symbols and rejects a 31st mark or invalid order before restore writes', async () => {
  const a = await seed();
  expect(MAX_MARKS).toBe(30); expect(new Set(MARK_SYMBOLS).size).toBe(30);
  for (const [i, symbol] of MARK_SYMBOLS.entries()) await saveMark(a.id, `図柄${i}`, symbol, undefined, store);
  const backup = await createBackup(store); const validated = validateBackup(backup);
  expect(validated.tags).toHaveLength(30); expect(validated.tags.map(t => t.mark).sort()).toEqual([...MARK_SYMBOLS].sort());
  await expect(saveMark(a.id, '上限超過', 'rocket', undefined, store)).rejects.toThrow('30個');
  for (const order of [-1, 30, 0.5, '0', null, Infinity]) {
    expect(() => validateBackup({ ...backup, tags: [{ ...backup.tags[0], markOrder: order }] })).toThrow('順序');
  }
  expect(() => validateBackup({ ...backup, tags: [{ ...backup.tags[0], mark: undefined, markOrder: 0 }] })).toThrow('順序');
  const destination = new LibraryDB(`symbol-restore-${crypto.randomUUID()}`);
  try {
    await restoreBackup(backup, destination);
    expect((await destination.tags.toArray()).map(t => t.mark).sort()).toEqual([...MARK_SYMBOLS].sort());
  } finally { await destination.delete(); }
});

it('saves account-scoped order atomically and keeps names, relations and user states on reorder or demotion', async () => {
  const a = await seed(); const b = await seed('another');
  await store.tags.bulkPut([
    { id: 'z', accountId: a.id, name: 'Z', mark: 'book' },
    { id: 'a', accountId: a.id, name: 'A', mark: 'flag' },
    { id: 'b', accountId: a.id, name: 'B', mark: 'rocket' },
    { id: 'other', accountId: b.id, name: '別', mark: 'star' },
  ]);
  await store.postTags.put({ accountId: a.id, postId: '1', tagId: 'z' });
  await store.userStates.put({ accountId: a.id, postId: '1', read: true, favorite: true });
  const names = async () => orderedMarks(await store.tags.where('accountId').equals(a.id).toArray()).map(t => t.name);
  expect(await names()).toEqual(['A', 'B', 'Z']);
  await moveMark(a.id, 'z', 'up', store); expect(await names()).toEqual(['A', 'Z', 'B']);
  await moveMark(a.id, 'z', 'up', store); expect(await names()).toEqual(['Z', 'A', 'B']);
  await moveMark(a.id, 'z', 'up', store); expect(await names()).toEqual(['Z', 'A', 'B']);
  await saveMark(a.id, 'Changed', 'camera', 'z', store); expect(await names()).toEqual(['Changed', 'A', 'B']);
  await saveMark(a.id, 'New', 'coffee', undefined, store); expect(await names()).toEqual(['Changed', 'A', 'B', 'New']);
  await expect(moveMark(b.id, 'z', 'down', store)).rejects.toThrow('アカウント');
  const before = await store.tags.toArray(); const originalPut = store.tags.bulkPut.bind(store.tags);
  const fail = vi.spyOn(store.tags, 'bulkPut').mockImplementationOnce((...args: Parameters<typeof originalPut>) => originalPut(...args).then(() => { throw new Error('write failed'); }));
  await expect(moveMark(a.id, 'z', 'down', store)).rejects.toThrow('write failed');
  fail.mockRestore(); expect(await store.tags.toArray()).toEqual(before);
  await removeMark('z', store); expect((await store.tags.get('z'))?.markOrder).toBeUndefined();
  await saveMark(a.id, 'Changed', 'camera', undefined, store); expect(await names()).toEqual(['A', 'B', 'New', 'Changed']);
  expect(await store.tags.get('other')).toEqual({ id: 'other', accountId: b.id, name: '別', mark: 'star' });
  expect(await store.postTags.count()).toBe(1); expect(await store.userStates.get([a.id, '1'])).toMatchObject({ read: true, favorite: true });
});

it('round-trips order, accepts old orderless v2 and preserves local order on repeated or partial restore', async () => {
  const a = await seed(); const one = await saveMark(a.id, 'A', 'archive', undefined, store);
  const two = await saveMark(a.id, 'B', 'rocket', undefined, store); await saveMark(a.id, 'C', 'coffee', undefined, store);
  await moveMark(a.id, two.id, 'up', store); await togglePostMark(a.id, '1', one.id, store);
  const backup = await createBackup(store); expect(orderedMarks(validateBackup(backup).tags).map(t => t.name)).toEqual(['B', 'A', 'C']);
  const destination = new LibraryDB(`order-restore-${crypto.randomUUID()}`);
  try {
    await restoreBackup(backup, destination);
    const names = async () => orderedMarks(await destination.tags.toArray()).map(t => t.name);
    expect(await names()).toEqual(['B', 'A', 'C']);
    const localA = (await destination.tags.toArray()).find(t => t.name === 'A')!;
    await moveMark(a.id, localA.id, 'up', destination);
    await restoreBackup(backup, destination); expect(await names()).toEqual(['A', 'B', 'C']);
    const newer = await saveMark(a.id, 'D', 'palette', undefined, store); await moveMark(a.id, newer.id, 'up', store);
    await restoreBackup(await createBackup(store), destination); expect(await names()).toEqual(['A', 'B', 'C', 'D']);
    const orderless = { ...backup, tags: backup.tags.map(({ markOrder: _order, ...t }) => t) };
    await restoreBackup(orderless, destination); expect(await names()).toEqual(['A', 'B', 'C', 'D']);
    const legacy = { ...orderless, formatVersion: 1, tags: backup.tags.map(({ mark: _mark, markOrder: _order, ...t }) => t) };
    await restoreBackup(legacy, destination); expect(await names()).toEqual(['A', 'B', 'C', 'D']);
    expect(await destination.postTags.count()).toBe(1);
  } finally { await destination.delete(); }
});
