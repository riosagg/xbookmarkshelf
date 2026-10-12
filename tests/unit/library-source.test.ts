import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { LibraryDB, commitBatch, newRun, markPostRead, libraryMetadata } from '../../src/db';
import { DEFAULT_OPTIONS } from '../../src/model';
import { createBackup, createMarkedBackup, restoreBackup, validateBackup } from '../../src/backup';
import { validateLikesBackup } from '../../src/backup-format';
import { saveMark, togglePostMark, moveMark } from '../../src/marks';
import { prepareDeletion, deletePosts } from '../../src/post-data';
import { parseViewerText } from '../../src/viewer-data';
import { emptyLocalLibrary, mergeLocalImport, parseLocalImport } from '../../src/local-data';
import { observation } from './helpers';

let books: LibraryDB; let likes: LibraryDB;
const account = { id: 'same-account', handle: 'sample' };
beforeEach(async () => {
  books = new LibraryDB(`books-${crypto.randomUUID()}`);
  likes = new LibraryDB(`likes-${crypto.randomUUID()}`, 'likes');
  for (const store of [books, likes]) {
    await store.settings.put({ key: 'accounts', value: [account] });
    const run = newRun(account, 1, 'doc', { ...DEFAULT_OPTIONS, maxPosts: 10 }, store.source);
    await store.importRuns.add(run);
    await commitBatch(run.id, 0, Array.from({ length: 10 }, (_, i) => ({ ...observation(String(i + 1), `${store.source} synthetic ${i + 1}`), media: i === 0 ? [{ kind: 'image' as const, url: 'https://pbs.twimg.com/media/synthetic-source.jpg' }, { kind: 'video' as const, url: 'https://pbs.twimg.com/amplify_video_thumb/123/img/synthetic.jpg' }] : [] })), store);
  }
});
afterEach(async () => { await books.delete(); await likes.delete(); });

it('isolates matching account/post/mark keys and deletion, including definitions and settings', async () => {
  for (const store of [books, likes]) await store.tags.put({ id: 'same-mark', accountId: account.id, name: store.source, mark: 'book' });
  await markPostRead(account.id, '1', likes);
  await togglePostMark(account.id, '1', 'same-mark', likes);
  expect(await books.userStates.count()).toBe(0); expect(await books.postTags.count()).toBe(0);
  expect((await libraryMetadata('', likes)).unread).toBe(9);
  await deletePosts(await prepareDeletion('all', [], likes), likes);
  expect(await likes.posts.count()).toBe(0); expect(await books.posts.count()).toBe(10);
  expect(await likes.tags.get('same-mark')).toMatchObject({ name: 'likes' });
  expect((await likes.settings.get('accounts'))?.value).toEqual([account]);
});
it('round-trips likes with read/mark order/media and preserves edits on repeated import', async () => {
  const one = await saveMark(account.id, 'One', 'heart', undefined, likes);
  const two = await saveMark(account.id, 'Two', 'film', undefined, likes);
  await moveMark(account.id, two.id, 'up', likes);
  await togglePostMark(account.id, '1', one.id, likes);
  await togglePostMark(account.id, '1', two.id, likes); await markPostRead(account.id, '1', likes);
  const backup = await createMarkedBackup(one.id, likes);
  expect(backup.format).toBe('xbookmarkshelf-likes'); expect(backup.posts).toHaveLength(1);
  expect(validateLikesBackup(backup).tags.map(t => t.name)).toContain('Two');
  const target = new LibraryDB(`restore-${crypto.randomUUID()}`, 'likes');
  try {
    await restoreBackup(backup, target);
    const tags = await target.tags.toArray(); const restored = tags.find(t => t.name === 'One')!;
    await saveMark(account.id, 'One', 'flag', restored.id, target);
    await restoreBackup(backup, target);
    expect((await target.posts.toArray())[0]?.media).toHaveLength(2);
    expect(await target.posts.count()).toBe(1); expect(await target.postTags.count()).toBe(2);
    expect(await target.userStates.get([account.id, '1'])).toMatchObject({ read: true });
    expect(await target.tags.get(restored.id)).toMatchObject({ mark: 'flag' });
  } finally { await target.delete(); }
  expect(await books.tags.count()).toBe(0);
});
it('rejects wrong-source restores before any writes and keeps legacy bookmark v1/v2', async () => {
  const book = await createBackup(books); const like = await createBackup(likes);
  await expect(restoreBackup(like, books)).rejects.toThrow();
  await expect(restoreBackup(book, likes)).rejects.toThrow();
  expect(await books.posts.count()).toBe(10); expect(await likes.posts.count()).toBe(10);
  expect(validateBackup({ ...book, formatVersion: 1 }).formatVersion).toBe(1);
  expect(() => validateBackup(like)).toThrow();
  expect(() => validateLikesBackup({ ...like, formatVersion: 2 })).toThrow();
  expect(() => validateLikesBackup({ ...like, posts: [{ ...like.posts[0], url: 'javascript:alert(1)' }] })).toThrow();
});
it('moves full likes metadata to local Likes and viewer without mixing Bookmarks', async () => {
  const tag = await saveMark(account.id, 'Saved', 'heart', undefined, likes);
  await togglePostMark(account.id, '1', tag.id, likes); await markPostRead(account.id, '1', likes);
  const text = JSON.stringify(await createBackup(likes));
  const view = parseViewerText(text);
  expect(view.source).toBe('likes'); expect(view.kind).toBe('backup'); expect(view.posts[0]?.authorHandle).toBe('test_author');
  const input = parseLocalImport(text); expect(input.source).toBe('likes');
  const result = mergeLocalImport(emptyLocalLibrary(), input);
  expect(result.library.libraries.bookmarks.posts).toHaveLength(0);
  expect(result.library.libraries.likes.posts).toHaveLength(10);
  expect(result.library.libraries.likes.posts.find(p => p.postId === '1')).toMatchObject({ read: true, mediaStatus: 'observed', dateSource: 'provided' });
});
