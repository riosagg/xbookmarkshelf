import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { LibraryDB } from '../../src/db';
import { createBackup, createMarkedBackup, markedBackupCount, restoreBackup, validateBackup } from '../../src/backup';
import { postBackupFilename } from '../../src/backup-export';
import { observation, timestamp } from './helpers';

let store: LibraryDB;
beforeEach(async () => {
  store = new LibraryDB(`mark-backup-${crypto.randomUUID()}`);
  await store.settings.bulkPut([{ key: 'accounts', value: [{ id: 'a', handle: 'sample_a' }, { id: 'b', handle: 'sample_b' }] }, { key: 'theme', value: 'dark' }]);
  await store.tags.bulkPut([
    { id: 'target', accountId: 'a', name: '選ぶマーク', mark: 'book', markOrder: 1 },
    { id: 'also', accountId: 'a', name: '他のマーク', mark: 'star', markOrder: 0 },
    { id: 'tag', accountId: 'a', name: '通常タグ' },
    { id: 'unused', accountId: 'a', name: '関係ない分類', mark: 'flag', markOrder: 2 },
    { id: 'empty', accountId: 'a', name: '空のマーク', mark: 'heart', markOrder: 3 },
    { id: 'other', accountId: 'b', name: '選ぶマーク', mark: 'book', markOrder: 0 },
  ]);
  for (const [accountId, postId] of [['a', '9007199254740993123'], ['a', '2'], ['a', '3'], ['b', '9007199254740993123']]) {
    const post = { ...observation(postId), accountId: accountId!, firstImportedAt: timestamp, lastImportedAt: timestamp,
      media: [{ kind: 'video' as const, url: 'https://pbs.twimg.com/ext_tw_video_thumb/synthetic/cover.jpg' }],
      linkCards: [{ url: 'https://example.invalid/article', title: '合成カード', imageUrl: 'https://pbs.twimg.com/card_img/synthetic/cover.jpg' }] };
    await store.posts.put(post);
    await store.userStates.put({ accountId: accountId!, postId: postId!, read: true, favorite: true });
  }
  await store.postTags.bulkPut([
    { accountId: 'a', postId: '9007199254740993123', tagId: 'target' },
    { accountId: 'a', postId: '9007199254740993123', tagId: 'also' },
    { accountId: 'a', postId: '9007199254740993123', tagId: 'tag' },
    { accountId: 'a', postId: '2', tagId: 'target' },
    { accountId: 'a', postId: '3', tagId: 'unused' },
    { accountId: 'b', postId: '9007199254740993123', tagId: 'other' },
  ]);
});
afterEach(async () => { await store.delete(); });
async function snapshot() { return Promise.all(store.tables.map(async table => [table.name, await table.toArray()])); }

it('exports only the selected mark’s posts and their complete dependent records without writes', async () => {
  const before = await snapshot();
  expect(await markedBackupCount('target', store)).toBe(2);
  const backup = await createMarkedBackup('target', store);
  expect(backup.accounts).toEqual([{ id: 'a', handle: 'sample_a' }]);
  expect(backup.posts.map(post => post.postId)).toEqual(['2', '9007199254740993123']);
  expect(backup.userStates).toHaveLength(2); expect(backup.userStates.every(state => state.accountId === 'a' && state.read && state.favorite)).toBe(true);
  expect(backup.tags.map(tag => tag.id).sort()).toEqual(['also', 'tag', 'target']); expect(backup.postTags).toHaveLength(4);
  expect(backup.posts.every(post => post.media.length === 1 && post.linkCards?.length === 1)).toBe(true);
  expect(Object.keys(backup)).not.toContain('settings'); expect(validateBackup(backup)).toEqual(backup);
  expect(await snapshot()).toEqual(before);
  const full = await createBackup(store); expect(full.posts).toHaveLength(4); expect(full.tags).toHaveLength(6);
});
it('restores a mark backup in a new DB with other marks, tags, states and media intact', async () => {
  const backup = await createMarkedBackup('target', store);
  const destination = new LibraryDB(`mark-destination-${crypto.randomUUID()}`);
  try {
    await destination.settings.put({ key: 'theme', value: 'light' });
    expect(await restoreBackup(backup, destination)).toEqual({ added: 2, existing: 0 });
    const restored = await createBackup(destination);
    expect(restored.posts).toEqual(backup.posts); expect(restored.userStates).toEqual(backup.userStates);
    expect(restored.tags.map(tag => tag.name).sort()).toEqual(backup.tags.map(tag => tag.name).sort());
    expect(restored.postTags).toHaveLength(4); expect(await destination.media.count()).toBe(2);
    expect((await destination.settings.get('theme'))?.value).toBe('light');
    expect(await restoreBackup(backup, destination)).toEqual({ added: 0, existing: 2 });
    expect(await destination.postTags.count()).toBe(4);
  } finally { await destination.delete(); }
});
it('excludes orphan and cross-account assignments from the target count and JSON', async () => {
  await store.postTags.bulkPut([{ accountId: 'a', postId: '404', tagId: 'target' }, { accountId: 'b', postId: '9007199254740993123', tagId: 'target' }]);
  expect(await markedBackupCount('target', store)).toBe(2);
  const backup = await createMarkedBackup('target', store);
  expect(backup.posts).toHaveLength(2); expect(backup.postTags).toHaveLength(4);
  expect(backup.posts.every(post => post.accountId === 'a')).toBe(true); expect(validateBackup(backup)).toEqual(backup);
});
it('fails closed for empty, removed or demoted marks instead of exporting all posts', async () => {
  const before = await snapshot();
  expect(await markedBackupCount('empty', store)).toBe(0);
  await expect(createMarkedBackup('empty', store)).rejects.toThrow('投稿はありません');
  await expect(createMarkedBackup('missing', store)).rejects.toThrow('見つかりません');
  await expect(createMarkedBackup('tag', store)).rejects.toThrow('見つかりません');
  expect(await snapshot()).toEqual(before);
  expect(await markedBackupCount('target', store)).toBe(2);
  await store.tags.update('target', { mark: undefined, markOrder: undefined });
  const demoted = await snapshot();
  await expect(createMarkedBackup('target', store)).rejects.toThrow('見つかりません');
  expect(await snapshot()).toEqual(demoted);
});
it('rejects invalid related data rather than silently producing an unrestorable file', async () => {
  await store.postTags.put({ accountId: 'a', postId: '2', tagId: 'missing-definition' });
  const before = await snapshot();
  await expect(createMarkedBackup('target', store)).rejects.toThrow('タグの関連が不正');
  expect(await snapshot()).toEqual(before);
});
it('keeps the full-backup filename and makes hostile or long mark names safe for Windows files', () => {
  expect(postBackupFilename(undefined, '2026-10-11')).toBe('xbookmarkshelf-posts-2026-10-11.json');
  const name = postBackupFilename('../../CON:<script>\\folder\n?*|"', '2026-10-11');
  expect(name).toMatch(/^xbookmarkshelf-posts-mark-/); expect(name).toMatch(/-2026-10-11\.json$/);
  expect(name).not.toMatch(/[<>:"/\\|?*\u0000-\u001f]/);
  expect(postBackupFilename('長'.repeat(100), '2026-10-11')).toContain('長'.repeat(40));
  expect(postBackupFilename('長'.repeat(100), '2026-10-11')).not.toContain('長'.repeat(41));
});
