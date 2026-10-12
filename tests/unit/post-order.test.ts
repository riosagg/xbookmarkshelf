import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { LibraryDB, windowPosts } from '../../src/db';
import { EMPTY_VIEWER_FILTERS, filterViewerPosts, parseViewerText } from '../../src/viewer-data';
import { sortByPostedDate } from '../../src/post-order';
import { observation } from './helpers';
import { viewerBackup } from '../viewer-fixtures';

it('orders actual instants, keeps ties and unknown dates stable and never mutates source records', () => {
  const posts = [
    { id: 'unknown-first', postedAt: null }, { id: 'same-first', postedAt: '2026-10-10T09:00:00+09:00' },
    { id: 'newest', postedAt: '2026-10-11T00:00:00Z' }, { id: 'same-second', postedAt: '2026-10-10T00:00:00Z' },
    { id: 'invalid', postedAt: 'unavailable' }, { id: 'oldest', postedAt: '2026-10-09T00:00:00Z' },
  ];
  const before = structuredClone(posts);
  expect(sortByPostedDate(posts, 'posted-newest').map(p => p.id)).toEqual(['newest', 'same-first', 'same-second', 'oldest', 'unknown-first', 'invalid']);
  expect(sortByPostedDate(posts, 'posted-oldest').map(p => p.id)).toEqual(['oldest', 'same-first', 'same-second', 'newest', 'unknown-first', 'invalid']);
  expect(posts).toEqual(before);
  expect(sortByPostedDate(posts.filter(p => p.postedAt === null || p.postedAt === 'unavailable'), 'posted-oldest').map(p => p.id)).toEqual(['unknown-first', 'invalid']);
});

it('retains file/reverse order and applies date sorting with filters, preserving missing dates and classification', () => {
  const backup = viewerBackup();
  backup.posts[0]!.postedAt = null; backup.posts[1]!.postedAt = '2026-10-11T00:00:00Z'; backup.posts[2]!.postedAt = '2026-10-09T00:00:00Z';
  const data = parseViewerText(JSON.stringify(backup)); const before = structuredClone(data);
  expect(filterViewerPosts(data.posts, EMPTY_VIEWER_FILTERS).map(p => p.key)).toEqual(['a:1', 'a:2', 'b:1']);
  expect(filterViewerPosts(data.posts, { ...EMPTY_VIEWER_FILTERS, reverse: true }).map(p => p.key)).toEqual(['b:1', 'a:2', 'a:1']);
  expect(filterViewerPosts(data.posts, { ...EMPTY_VIEWER_FILTERS, postedOrder: 'posted-newest' }).map(p => p.key)).toEqual(['a:2', 'b:1', 'a:1']);
  expect(filterViewerPosts(data.posts, { ...EMPTY_VIEWER_FILTERS, postedOrder: 'posted-oldest' }).map(p => p.key)).toEqual(['b:1', 'a:2', 'a:1']);
  expect(filterViewerPosts(data.posts, { ...EMPTY_VIEWER_FILTERS, account: 'a', postedOrder: 'posted-oldest' }).map(p => p.key)).toEqual(['a:2', 'a:1']);
  expect(filterViewerPosts(data.posts, { ...EMPTY_VIEWER_FILTERS, read: 'read', postedOrder: 'posted-newest' }).map(p => p.key)).toEqual(['a:1']);
  expect(data).toEqual(before);
});

for (const source of ['bookmarks', 'likes'] as const) it(`${source}: date ordering keeps unknowns last across bounded windows and preserves schema/data/legacy ordering`, async () => {
  const store = new LibraryDB(`date-sort-${crypto.randomUUID()}`, source);
  try {
    await store.posts.bulkPut(Array.from({ length: 120 }, (_, i) => ({ ...observation(String(i), `Sort ${i}`), accountId: 'a',
      postedAt: i < 60 ? new Date(Date.UTC(2026, 0, 60 - i)).toISOString() : null,
      firstImportedAt: new Date(Date.UTC(2025, 0, 1, 0, i)).toISOString(), lastImportedAt: '2026-10-10T00:00:00Z' })));
    await store.posts.put({ ...observation('0', 'Other account'), accountId: 'b', firstImportedAt: '2026-10-10T00:00:00Z', lastImportedAt: '2026-10-10T00:00:00Z' });
    await store.userStates.put({ accountId: 'a', postId: '119', read: true, favorite: true });
    await store.tags.put({ accountId: 'a', id: 'mark', name: 'Saved', mark: 'star' });
    await store.postTags.put({ accountId: 'a', postId: '119', tagId: 'mark' });
    const before = await Promise.all(store.tables.map(table => table.toArray()));
    const rows = (offset: number, order: 'posted-newest' | 'posted-oldest') => windowPosts('a', 'Sort', offset, 20, { postedOrder: order }, store);
    expect((await rows(0, 'posted-newest')).rows.map(p => p.postId)).toEqual(Array.from({ length: 20 }, (_, i) => String(i)));
    expect((await rows(0, 'posted-oldest')).rows.map(p => p.postId)).toEqual(Array.from({ length: 20 }, (_, i) => String(59 - i)));
    const boundary = await rows(55, 'posted-newest');
    expect(boundary.total).toBe(120);
    expect(boundary.rows.map(p => p.postId)).toEqual([...Array.from({ length: 5 }, (_, i) => String(55 + i)), ...Array.from({ length: 15 }, (_, i) => String(119 - i))]);
    expect((await rows(60, 'posted-oldest')).rows.map(p => p.postId)).toEqual(Array.from({ length: 20 }, (_, i) => String(119 - i)));
    expect((await rows(115, 'posted-newest')).rows.map(p => p.postId)).toEqual(['64', '63', '62', '61', '60']);
    expect((await windowPosts('a', '', 0, 50, { tagId: 'mark', read: true, postedOrder: 'posted-oldest' }, store)).rows.map(p => p.postId)).toEqual(['119']);
    expect((await windowPosts('a', '', 0, 50, {}, store)).rows[0]?.postId).toBe('119');
    expect((await windowPosts('a', '', 0, 50, { oldestFirst: true }, store)).rows[0]?.postId).toBe('0');
    expect(store.verno).toBe(1); expect(await Promise.all(store.tables.map(table => table.toArray()))).toEqual(before);
    await store.posts.update(['a', '119'], { postedAt: '2026-10-12T00:00:00Z' });
    expect((await rows(0, 'posted-newest')).rows[0]?.postId).toBe('119');
    await store.posts.delete(['a', '119']); expect((await rows(0, 'posted-newest')).total).toBe(119);
  } finally { await store.delete(); }
});
