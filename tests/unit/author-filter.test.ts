import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { authorMatcher } from '../../src/text';
import { LibraryDB, windowPosts } from '../../src/db';
import { EMPTY_VIEWER_FILTERS, filterViewerPosts, parseViewerText } from '../../src/viewer-data';
import { authorBackup, likesScript } from '../viewer-fixtures';

it('matches @handles exactly, folds case and full-width input, and keeps plain text as a partial name/handle search', () => {
  const value = authorBackup();
  const keys = (query: string) => value.posts.filter(authorMatcher(query)).map(p => `${p.accountId}:${p.postId}`);
  for (const query of ['@x', '@X', '  @x  ', '　＠Ｘ　']) expect(keys(query)).toEqual(['a:1', 'b:2']);
  for (const query of ['x', 'Ｘ']) expect(keys(query)).toEqual(['a:1', 'a:2', 'b:1', 'a:3', 'b:2']);
  expect(keys('display')).toEqual(['a:3']); expect(keys('@Display x')).toEqual([]);
  expect(keys('@x_extra')).toEqual(['a:2']); expect(keys('@prefix_x')).toEqual(['b:1']);
  for (const query of ['@', '@@x', '@ x', '@missing', '@x.*']) expect(keys(query)).toEqual([]);
  for (const query of ['', '　 ']) expect(keys(query)).toHaveLength(6);
});

it('local filters preserve data, exclude unknown/quoted authors and combine exact handles with other filters', () => {
  const data = parseViewerText(JSON.stringify(authorBackup())); const before = structuredClone(data);
  const filter = (patch: Partial<typeof EMPTY_VIEWER_FILTERS>) => filterViewerPosts(data.posts, { ...EMPTY_VIEWER_FILTERS, ...patch }).map(p => p.key);
  expect(filter({ author: '@x' })).toEqual(['a:1', 'b:2']);
  expect(filter({ author: 'x' })).toEqual(['a:1', 'a:2', 'b:1', 'a:3', 'b:2']);
  expect(filter({ author: '@x', account: 'a', tag: 'mark-a', read: 'read', media: 'without', postedOrder: 'posted-newest' })).toEqual(['a:1']);
  expect(filter({ author: '@x', account: 'a', read: 'unread' })).toEqual([]);
  expect(filter({ query: '@x' })).toEqual(['a:2', 'a:4']); expect(data).toEqual(before);
  const unknown = parseViewerText(likesScript()).posts;
  expect(filterViewerPosts(unknown, { ...EMPTY_VIEWER_FILTERS, author: '@' })).toEqual([]);
  expect(filterViewerPosts(unknown, { ...EMPTY_VIEWER_FILTERS, author: '@x' })).toEqual([]);
  expect(filterViewerPosts(unknown, EMPTY_VIEWER_FILTERS)).toHaveLength(1);
});

for (const source of ['bookmarks', 'likes'] as const) it(`${source}: exact author filtering keeps bounded totals, other filters, schema and saved data`, async () => {
  const value = authorBackup(); const store = new LibraryDB(`author-filter-${crypto.randomUUID()}`, source);
  try {
    await store.posts.bulkPut(value.posts); await store.tags.bulkPut(value.tags); await store.postTags.bulkPut(value.postTags); await store.userStates.bulkPut(value.userStates);
    const before = await Promise.all(store.tables.map(t => t.toArray()));
    const first = await windowPosts('', '', 0, 1, { author: '@x' }, store);
    expect(first.total).toBe(2); expect(first.rows.map(p => `${p.accountId}:${p.postId}`)).toEqual(['b:2']);
    expect((await windowPosts('', '', 1, 1, { author: '　＠Ｘ　' }, store)).rows.map(p => `${p.accountId}:${p.postId}`)).toEqual(['a:1']);
    expect((await windowPosts('', '', 0, 50, { author: 'x' }, store)).total).toBe(5);
    expect((await windowPosts('a', '', 0, 50, { author: '@X', tagId: 'mark-a', read: true, media: 'without', postedOrder: 'posted-oldest' }, store)).rows.map(p => p.postId)).toEqual(['1']);
    expect((await windowPosts('a', '', 0, 50, { author: '@x', read: false }, store)).total).toBe(0);
    for (const author of ['@', '@ x', '@Display x', '@missing']) expect((await windowPosts('', '', 0, 50, { author }, store)).total).toBe(0);
    expect((await windowPosts('', '@x', 0, 50, {}, store)).total).toBe(2);
    expect(store.verno).toBe(1); expect(await Promise.all(store.tables.map(t => t.toArray()))).toEqual(before);
  } finally { await store.delete(); }
});
