import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { LibraryDB } from '../../src/db';
import { restoreBackup, validateBackup, createBackup, type Backup } from '../../src/backup';
import { togglePostMark } from '../../src/marks';
import { observation, timestamp } from './helpers';

let store: LibraryDB;
beforeEach(() => { store = new LibraryDB(`synthetic-limits-${crypto.randomUUID()}`); });
afterEach(async () => { await store.delete(); });
function backup(count: number, prefix = 'tag', accountId = 'remote'): Backup {
  return { format: 'x-bookmark-library', formatVersion: 2, exportedAt: timestamp,
    accounts: [{ id: accountId, handle: 'sample' }],
    posts: [{ ...observation('1'), accountId, firstImportedAt: timestamp, lastImportedAt: timestamp }],
    userStates: [{ accountId, postId: '1', read: false, favorite: false }],
    tags: Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i}`, accountId, name: `${prefix} ${i}`, ...(i === 0 ? { mark: 'flag' as const, markOrder: 0 } : {}) })),
    postTags: Array.from({ length: count }, (_, i) => ({ accountId, postId: '1', tagId: `${prefix}-${i}` })) };
}
async function snapshot() { return Promise.all(store.tables.map(async table => [table.name, await table.toArray()])); }

it('accepts 20 mixed tags/marks and rejects 21 incoming relations without writes', async () => {
  const original = await snapshot();
  await expect(restoreBackup(backup(21), store)).rejects.toThrow('タグとマークは合計20個までです');
  expect(await snapshot()).toEqual(original);
  await expect(restoreBackup(backup(20), store)).resolves.toEqual({ added: 1, existing: 0 });
  await expect(restoreBackup(await createBackup(store), store)).resolves.toEqual({ added: 0, existing: 1 });
  expect(await store.postTags.count()).toBe(20);
});
it('rolls back all tables if mapped existing and incoming assignments exceed 20', async () => {
  await restoreBackup(backup(15, 'local', 'local-account'), store);
  await store.userStates.put({ accountId: 'local-account', postId: '1', read: true, favorite: true });
  await store.settings.put({ key: 'previews', value: true });
  const original = await snapshot();
  const input = backup(10, 'incoming');
  input.accounts.push({ id: 'new-account', handle: 'other' });
  input.posts[0]!.text = '変更された本文';
  input.posts[0]!.media = [{ kind: 'image', url: 'https://pbs.twimg.com/media/synthetic.png' }];
  input.posts.push({ ...observation('2'), accountId: 'new-account', firstImportedAt: timestamp, lastImportedAt: timestamp });
  input.userStates.push({ accountId: 'new-account', postId: '2', read: true, favorite: true });
  await expect(restoreBackup(input, store)).rejects.toThrow('タグとマークは合計20個までです');
  expect(await snapshot()).toEqual(original);
});
it('counts mapped identities and v1 trimmed-name aliases without losing local classification', async () => {
  await restoreBackup(backup(20, 'shared', 'local-account'), store);
  await store.userStates.put({ accountId: 'local-account', postId: '1', read: true, favorite: true });
  const input = backup(20, 'shared');
  input.tags = input.tags.map(t => ({ ...t, id: `new-${t.id}` }));
  input.postTags = input.postTags.map(t => ({ ...t, tagId: `new-${t.tagId}` }));
  await expect(restoreBackup(input, store)).resolves.toEqual({ added: 0, existing: 1 });
  expect(await store.postTags.count()).toBe(20);
  expect(await store.userStates.get(['local-account', '1'])).toMatchObject({ read: true, favorite: true });
  const legacy = backup(21, 'alias'); legacy.formatVersion = 1;
  legacy.tags = legacy.tags.map(t => ({ id: t.id, accountId: t.accountId, name: ' shared 0 ' }));
  await expect(restoreBackup(legacy, store)).resolves.toEqual({ added: 0, existing: 1 });
  expect(await store.postTags.count()).toBe(20);
});
it('enforces capacity independently for the same post ID in different accounts', async () => {
  const input = backup(20);
  const other = backup(20, 'other', 'other-account'); other.accounts[0]!.handle = 'other';
  input.accounts.push(...other.accounts); input.posts.push(...other.posts); input.tags.push(...other.tags); input.postTags.push(...other.postTags);
  await restoreBackup(input, store);
  expect(await store.postTags.count()).toBe(40);
});
it.each([1, ['1']])('rejects non-string related post IDs %j without coercion', postId => {
  const input = backup(1);
  expect(() => validateBackup({ ...input, postTags: [{ ...input.postTags[0], postId }] })).toThrow('タグの関連が不正です');
  expect(() => validateBackup({ ...input, userStates: [{ ...input.userStates[0], postId }] })).toThrow('ユーザー状態が不正です');
});
it('serializes competing restores and mark additions at the 19-to-20 boundary', async () => {
  await restoreBackup(backup(19, 'local', 'local-account'), store);
  await store.tags.put({ id: 'another-mark', accountId: 'local-account', name: 'Another', mark: 'star', markOrder: 1 });
  const results = await Promise.allSettled([
    restoreBackup(backup(1, 'first'), store), restoreBackup(backup(1, 'second'), store),
    togglePostMark('local-account', '1', 'another-mark', store),
  ]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(r => r.status === 'rejected')).toHaveLength(2);
  expect(await store.postTags.count()).toBe(20);
});
it('preserves already over-limit stored assignments when restoration is rejected', async () => {
  await restoreBackup(backup(20, 'local', 'local-account'), store);
  await store.tags.put({ id: 'legacy-extra', accountId: 'local-account', name: 'Legacy extra' });
  await store.postTags.put({ accountId: 'local-account', postId: '1', tagId: 'legacy-extra' });
  const original = await snapshot();
  await expect(restoreBackup(backup(0), store)).rejects.toThrow('タグとマークは合計20個までです');
  await expect(restoreBackup(backup(1, 'local'), store)).rejects.toThrow('タグとマークは合計20個までです');
  expect(await snapshot()).toEqual(original);
});
