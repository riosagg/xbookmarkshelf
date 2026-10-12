import { expect, it } from 'vitest';
import { parseViewerText, filterViewerPosts, EMPTY_VIEWER_FILTERS, VIEWER_MAX_BYTES, VIEWER_PAGE_SIZE, ViewerInputError } from '../../src/viewer-data';
import { likesScript, syntheticLikes, viewerBackup } from '../viewer-fixtures';

it('parses the actual archive assignment shape as JSON and preserves large IDs', () => {
  const rows = syntheticLikes(2); rows[0]!.like.fullText = '<script>globalThis.syntheticViewerExecuted = true</script>';
  const data = parseViewerText(`\uFEFF  window.YTD.like.part12 = ${JSON.stringify(rows)};\n`);
  expect(data.kind).toBe('likes'); expect(data.posts[0]!.postId).toBe('9007199254740993123');
  expect(data.posts[0]!.text).toContain('<script>'); expect(data.posts[0]!.authorHandle).toBe('');
  expect(data.posts[0]!.read).toBeNull(); expect(data.posts[0]!.media).toEqual([]);
  expect('syntheticViewerExecuted' in globalThis).toBe(false);
});
it('rejects executable expressions, extra statements and other archive datasets', () => {
  for (const text of ['window.YTD.like.part0 = (() => [])();', 'window.YTD.like.part0 = [];globalThis.syntheticViewerExecuted = true;', 'window.YTD.tweets.part0 = [];', 'window.YTD.like.part0 = [];;', '<script>alert(1)</script>']) expect(() => parseViewerText(text)).toThrow(ViewerInputError);
  expect('syntheticViewerExecuted' in globalThis).toBe(false);
});
it('rejects hostile URLs, ID mismatch, non-string IDs, oversized text and incomplete records', () => {
  for (const patch of [{ expandedUrl: 'javascript:alert(1)' }, { expandedUrl: 'https://evil.example/i/web/status/9007199254740993123' }, { expandedUrl: 'https://twitter.com@evil.example/i/web/status/9007199254740993123' }, { expandedUrl: 'https://twitter.com:444/i/web/status/9007199254740993123' }, { expandedUrl: 'https://twitter.com/i/web/status/1' }, { tweetId: 123 }, { fullText: 'x'.repeat(50001) }, { fullText: null }]) {
    const entry = { like: { ...syntheticLikes()[0]!.like, ...patch } };
    expect(() => parseViewerText(JSON.stringify([entry]))).toThrow(ViewerInputError);
  }
});
it('supports empty likes, raw likes JSON, safe named-author links and duplicate removal', () => {
  expect(parseViewerText('window.YTD.like.part0 = []').posts).toEqual([]);
  const item = syntheticLikes()[0]!; item.like.expandedUrl = `https://x.com/synthetic/status/${item.like.tweetId}`;
  const data = parseViewerText(JSON.stringify([item, item]));
  expect(data.posts).toHaveLength(1); expect(data.duplicates).toBe(1); expect(data.posts[0]!.authorHandle).toBe('synthetic');
});
it('keeps ID and URL when the archive omits fullText for an unavailable post', () => {
  const item = syntheticLikes()[0]!.like;
  const data = parseViewerText(JSON.stringify([{ like: { tweetId: item.tweetId, expandedUrl: item.expandedUrl } }]));
  expect(data.posts).toHaveLength(1); expect(data.posts[0]!.text).toBe('');
  expect(data.posts[0]!.url).toBe(item.expandedUrl); expect(data.posts[0]!.hasLinks).toBe(false);
});
it('accepts v1/v2 backups with account isolation, marks, read state and references', () => {
  const backup = viewerBackup(); const data = parseViewerText(JSON.stringify(backup));
  expect(data.posts.map(p => p.key)).toEqual(['a:1', 'a:2', 'b:1']);
  expect(data.posts[0]!.tags.map(t => t.id)).toEqual(['mark-a', 'tag-a']); expect(data.posts[2]!.tags.map(t => t.id)).toEqual(['mark-b']);
  expect(data.posts.map(p => p.read)).toEqual([true, false, false]); expect(data.posts[0]!.linkCards).toEqual(backup.posts[0]!.linkCards);
  expect(backup).toEqual(viewerBackup());
  backup.formatVersion = 1;
  expect(parseViewerText(JSON.stringify(backup)).tags.every(t => !t.mark)).toBe(true);
});
it('keeps backup validation boundaries including settings confusion, unknown versions and cross-account tags', () => {
  for (const patch of [{ format: 'xbookmarkshelf-settings' }, { formatVersion: 3 }, { postTags: [{ accountId: 'a', postId: '1', tagId: 'mark-b' }] }, { posts: viewerBackup().posts.map(p => ({ ...p, media: [{ kind: 'image', url: 'https://evil.example/image.jpg' }] })) }]) expect(() => parseViewerText(JSON.stringify({ ...viewerBackup(), ...patch }))).toThrow(ViewerInputError);
});
it('combines mark/account/read/media/author/link filters and reverses without mutating the source', () => {
  const data = parseViewerText(JSON.stringify(viewerBackup()));
  const filter = (patch: Partial<typeof EMPTY_VIEWER_FILTERS>) => filterViewerPosts(data.posts, { ...EMPTY_VIEWER_FILTERS, ...patch }).map(p => p.key);
  expect(filter({ tag: 'mark-b', account: 'a' })).toEqual([]);
  expect(filter({ tag: ':without', read: 'unread' })).toEqual(['a:2']);
  expect(filter({ media: 'video', query: '合成', author: '@test_author', links: 'with' })).toEqual(['b:1']);
  expect(filter({ reverse: true })).toEqual(['b:1', 'a:2', 'a:1']); expect(data.posts.map(p => p.key)).toEqual(['a:1', 'a:2', 'b:1']);
});
it('indexes and searches 20,838 synthetic likes with Unicode normalization and only a page slice', () => {
  const data = parseViewerText(likesScript(20838));
  const results = filterViewerPosts(data.posts, { ...EMPTY_VIEWER_FILTERS, query: 'shelf 日本語' });
  expect(data.posts).toHaveLength(20838); expect(results).toHaveLength(1); expect(results[0]!.text).toContain('最後');
  expect(data.posts.slice(0, VIEWER_PAGE_SIZE)).toHaveLength(50);
});
it('enforces UTF-8 byte and 50,000 record limits before accepting the data', () => {
  expect(() => parseViewerText('あ'.repeat(Math.floor(VIEWER_MAX_BYTES / 3) + 1))).toThrow(ViewerInputError);
  expect(parseViewerText('[]' + ' '.repeat(VIEWER_MAX_BYTES - 2)).posts).toEqual([]);
  expect(() => parseViewerText('[]' + ' '.repeat(VIEWER_MAX_BYTES - 1))).toThrow(ViewerInputError);
  expect(() => parseViewerText(JSON.stringify(Array(50001).fill(syntheticLikes()[0])))).toThrow(ViewerInputError);
  expect(parseViewerText(JSON.stringify(Array(50000).fill(syntheticLikes()[0]))).duplicates).toBe(49999);
});
