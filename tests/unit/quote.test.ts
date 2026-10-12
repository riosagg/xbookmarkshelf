// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { readArticle } from '../../src/dom';
import { mergePost } from '../../src/db';
import { validateQuote, validatePosts, type QuotedPost } from '../../src/model';
import { prepareBackupFiles } from '../../src/backup-parts';
import { parseViewerText, filterViewerPosts, EMPTY_VIEWER_FILTERS } from '../../src/viewer-data';
import { emptyLocalLibrary, mergeLocalImport, parseLocalImport, parseLocalLibrary, serializeLocalLibrary } from '../../src/local-data';
import { observation, timestamp } from './helpers';
import { runReader, type ReaderPort } from '../../src/reader';
import { newRun } from '../../src/db';
import { DEFAULT_OPTIONS } from '../../src/model';
function article(own = '') {
  document.body.innerHTML = `<article><div data-testid="quoteTweet"><div data-testid="User-Name"><span>Quoted author</span></div><a href="/quoted/status/456"><time datetime="2026-10-10T09:00:00Z"></time></a><div data-testid="tweetText">引用だけ &lt;script&gt; <a href="https://t.co/a" title="https://example.invalid/full">短いURL</a></div><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/quote.jpg"></div></div><div data-testid="User-Name"><span>Outer</span></div><a href="/outer/status/123"><time datetime="2026-10-10T08:00:00Z"></time></a>${own ? `<div data-testid="tweetText">${own}</div>` : ''}</article>`;
  return document.querySelector('article')!;
}
it('keeps quote-only text, author, time, links and media separate from the outer post even when quote comes first', () => {
  const node = article(); const original = node.innerHTML; const p = readArticle(node, timestamp)!;
  expect(p).toMatchObject({ postId: '123', authorHandle: 'outer', authorName: 'Outer', text: '', postedAt: timestamp, media: [] });
  expect(p.quote).toMatchObject({ postId: '456', authorHandle: 'quoted', authorName: 'Quoted author', text: '引用だけ <script> https://example.invalid/full',
    media: [{ kind: 'image', url: 'https://pbs.twimg.com/media/quote.jpg' }] });
  expect(validatePosts([p])[0]?.quote).toEqual(p.quote); expect(node.innerHTML).toBe(original);
});
it('preserves both texts and never treats a body status link as the quote identity', () => {
  const node = article('元本文'); const p = readArticle(node)!; expect(p.text).toBe('元本文'); expect(p.quote?.text).toContain('引用だけ');
  node.querySelector('[data-testid="quoteTweet"] a')!.remove(); node.querySelector('[data-testid="quoteTweet"] [data-testid="tweetText"]')!.innerHTML = '別のリンク <a href="/other/status/999">link</a>';
  expect(readArticle(node)?.quote).toMatchObject({ postId: null, authorHandle: '', url: null });
});
it('bounds quote fields, forbids unsafe URLs and drops recursive or unknown input fields', () => {
  const q = readArticle(article())!.quote!;
  for (const bad of [{ ...q, text: 'x'.repeat(50001) }, { ...q, authorName: 'x'.repeat(201) }, { ...q, url: 'javascript:alert(1)' },
    { ...q, media: [{ kind: 'image', url: 'https://other.invalid/track.jpg' }] }, { ...q, postedAt: 'invalid' }]) expect(() => validateQuote(bad)).toThrow();
  expect(validateQuote({ ...q, quote: q, privateField: 'ignored' })).not.toHaveProperty('quote');
});
it('retains a saved quote through missing/partial observations and keeps different quoted posts separate', () => {
  const p = readArticle(article())!; const saved = mergePost(undefined, p, 'a', timestamp);
  expect(mergePost(saved, { ...p, quote: undefined }, 'a', timestamp).quote).toEqual(p.quote);
  expect(mergePost(saved, { ...p, quote: { ...p.quote!, text: '短い', media: [] } }, 'a', timestamp).quote?.text).toBe(p.quote?.text);
  const changed: QuotedPost = { ...p.quote!, postId: '789', url: 'https://x.com/quoted/status/789', text: '別の引用', media: [] };
  expect(mergePost(saved, { ...p, quote: changed }, 'a', timestamp).quote?.text).toBe('別の引用');
});
it('round-trips optional quotes through backups, viewer search and local JSON while keeping old posts readable', () => {
  const p = mergePost(undefined, readArticle(article())!, 'a', timestamp);
  const value = { format: 'x-bookmark-library' as const, formatVersion: 2 as const, exportedAt: timestamp, accounts: [{ id: 'a', handle: 'sample' }], posts: [p], userStates: [], tags: [], postTags: [] };
  const file = prepareBackupFiles(value)[0]!; const view = parseViewerText(file.text);
  expect(filterViewerPosts(view.posts, { ...EMPTY_VIEWER_FILTERS, query: '引用だけ', media: 'with', links: 'with' })).toHaveLength(1);
  const lib = mergeLocalImport(emptyLocalLibrary(), parseLocalImport(file.text)).library;
  expect(parseLocalLibrary(serializeLocalLibrary(lib)).libraries.bookmarks.posts[0]?.quote).toEqual(p.quote);
  expect(validatePosts([observation()])[0]).not.toHaveProperty('quote');
});
it('retains the quoted observation during the DOM settle wait when the quote disappears', async () => {
  const post = readArticle(article())!; let visible = [post]; const run = newRun({ id: 'a', handle: 'sample' }, 1, 'doc', DEFAULT_OPTIONS); let saved;
  const port: ReaderPort = { observe: () => visible, guard: () => null, watch: () => () => {},
    wait: async () => { visible = [{ ...post, quote: undefined }]; }, commit: async (_sequence, posts) => { saved = posts[0]; return { ...run, nextSequence: 1, observed: 1, state: 'stopped' }; },
    heartbeat: async () => run, finish: async () => {}, scroll: () => {} };
  await runReader(run, port, new AbortController().signal); expect(saved).toHaveProperty('quote', post.quote);
});
