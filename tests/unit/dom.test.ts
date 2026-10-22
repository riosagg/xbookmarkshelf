// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { readAccount, readArticle, readVisiblePosts, restrictedPage, bookmarkScope, libraryScope } from '../../src/dom';
import { isBookmarkUrl, isLibraryUrl, isMediaUrl, validateOptions, validatePosts } from '../../src/model';
import { observation, timestamp } from './helpers';

beforeEach(() => { document.body.innerHTML = ''; });
it('reads only posts intersecting the viewport, including partial posts and excluding preloaded and hidden articles', () => {
  const rects = [
    { top: -120, left: 0, width: 400, height: 120 },
    { top: -80, left: 0, width: 400, height: 120 },
    { top: 40, left: 0, width: 400, height: 120 },
    { top: 580, left: 0, width: 400, height: 120 },
    { top: 600, left: 0, width: 400, height: 120 },
    { top: 0, left: 0, width: 0, height: 0 },
    { top: 40, left: -400, width: 400, height: 120 },
    { top: 40, left: 800, width: 400, height: 120 },
  ];
  document.body.innerHTML = rects.map((_, i) => `<article data-testid="tweet"><a href="/sample/status/${i + 1}"><time></time></a></article>`).join('');
  document.querySelectorAll('article').forEach((article, i) => {
    const rect = rects[i]!;
    article.getBoundingClientRect = () => ({ ...rect, bottom: rect.top + rect.height, right: rect.left + rect.width }) as DOMRect;
  });
  expect(readVisiblePosts(document, 800, 600).map(post => post.postId)).toEqual(['2', '3', '4']);
  expect(readVisiblePosts(document, 0, 0)).toEqual([]);
});
it('uses the profile navigation to identify the logged-in account, not post authors', () => {
  document.body.innerHTML = '<a data-testid="AppTabBar_Profile_Link" href="/Logged_In">Profile</a><a href="/other">author</a>';
  expect(readAccount(document)).toBe('logged_in'); document.body.innerHTML = '<a href="/other">author</a>'; expect(readAccount(document)).toBeNull();
});
it('extracts rendered text and string IDs without executing or fetching content', () => {
  document.body.innerHTML = '<article><div data-testid="User-Name"><span>Author</span></div><a href="/test_author/status/9007199254740993123"><time datetime="2026-10-10T08:00:00Z"></time></a><div data-testid="tweetText">&lt;script&gt;alert(1)&lt;/script&gt;本文</div><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/test.jpg"></div></article>';
  const p = readArticle(document.querySelector('article')!, timestamp)!;
  expect(p.postId).toBe('9007199254740993123'); expect(p.text).toContain('<script>'); expect(p.partial).toBe(true); expect(p.media).toHaveLength(1); expect(validatePosts([p])).toHaveLength(1);
});
it('does not invent a post without a valid permalink', () => { document.body.innerHTML = '<article><p>宣伝</p></article>'; expect(readArticle(document.querySelector('article')!)).toBeNull(); });
it('rejects non-bookmark pages, unsafe URL data and oversized batches', () => {
  expect(isBookmarkUrl('https://x.com/i/bookmarks')).toBe(true);
  expect(isBookmarkUrl('https://x.com/i/history/')).toBe(true);
  for (const url of ['https://x.com.evil/i/bookmarks', 'https://x.com/home', 'http://x.com/i/bookmarks', 'https://x.com/i/history/likes', 'https://x.com/i/bookmarks/folder/123', 'https://user:password@x.com/i/history']) expect(isBookmarkUrl(url)).toBe(false);
  expect(() => validatePosts([{ ...observation(), url: 'javascript:alert(1)' }])).toThrow();
  expect(() => validatePosts(Array.from({ length: 11 }, (_, i) => observation(String(i))))).toThrow();
  expect(() => validateOptions({ intervalMs: 100, maxPosts: 100, mode: 'full' })).toThrow();
});
it('detects page restrictions without trying to bypass them', () => { document.body.innerHTML = '<div data-testid="error-detail">読み込み制限</div>'; expect(restrictedPage(document)).toBe(true); });
it('requires the selected Bookmarks tab on history, never Likes or an unknown scope', () => {
  expect(bookmarkScope(document, 'https://x.com/i/bookmarks')).toBe(true);
  expect(bookmarkScope(document, 'https://x.com/i/history')).toBe(false);
  for (const label of ['Bookmarks', 'ブックマーク']) {
    document.body.innerHTML = `<div role="tab" aria-selected="true">${label}</div><div role="tab" aria-selected="false">Likes</div>`;
    expect(bookmarkScope(document, 'https://x.com/i/history')).toBe(true);
  }
  document.body.innerHTML = '<div role="tab" aria-selected="false">Bookmarks</div><div role="tab" aria-selected="true">Likes</div><h1>Bookmarks</h1>';
  expect(bookmarkScope(document, 'https://x.com/i/history')).toBe(false);
});
it('parses absolute same-origin profile and post links while rejecting other origins', () => {
  document.body.innerHTML = '<a data-testid="AppTabBar_Profile_Link" href="https://x.com/Logged_In">Profile</a><article><a href="https://x.com/test_author/status/9007199254740993123"><time></time></a><div data-testid="tweetText">本文</div></article>';
  expect(readAccount(document)).toBe('logged_in'); expect(readArticle(document.querySelector('article')!)?.postId).toBe('9007199254740993123');
  document.querySelector('a')!.setAttribute('href', 'https://other.invalid/Logged_In'); expect(readAccount(document)).toBeNull();
  document.querySelector('article a')!.setAttribute('href', 'https://other.invalid/test_author/status/123'); expect(readArticle(document.querySelector('article')!)).toBeNull();
});
it('allows media previews only on the exact HTTPS image origin without URL credentials', () => {
  expect(isMediaUrl('https://pbs.twimg.com/media/test.jpg')).toBe(true);
  for (const url of ['http://pbs.twimg.com/media/test.jpg', 'https://pbs.twimg.com.evil/test.jpg', 'https://pbs.twimg.com:8443/test.jpg', 'https://user:secret@pbs.twimg.com/test.jpg', 'data:image/png;base64,a']) expect(isMediaUrl(url)).toBe(false);
});
it('preserves inline full URLs and link-card URLs without resolving redirects or editing the live DOM', () => {
  document.body.innerHTML = '<article><a href="/test_author/status/123"><time></time></a><div data-testid="tweetText">参照 <a href="https://t.co/short" title="https://example.invalid/full/path">example.invalid/full…</a> <a href="/other">@other</a> <a href="javascript:alert(1)">unsafe</a></div><div data-testid="card.wrapper"><a href="https://t.co/card" title="https://example.invalid/card">外部記事</a><a href="https://example.invalid/card">From</a></div><div data-testid="quoteTweet"><div data-testid="card.wrapper"><a href="https://example.invalid/quoted">Quote</a></div></div></article>';
  const article = document.querySelector('article')!;
  const before = article.innerHTML;
  const p = readArticle(article, timestamp)!;
  expect(p.text).toBe('参照 https://example.invalid/full/path @other unsafe\nhttps://example.invalid/card');
  expect(p.text).not.toContain('quoted'); expect(article.innerHTML).toBe(before);
});
it('recognizes lazy video thumbnails and players, deduplicates posters, and keeps photos as images', () => {
  document.body.innerHTML = '<article><a href="/test_author/status/123"><time></time></a><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/test.jpg"><img src="https://pbs.twimg.com/media/photo.jpg"></div><div data-testid="videoPlayer"><img src="https://pbs.twimg.com/media/poster.jpg"><video poster="https://pbs.twimg.com/media/poster.jpg"></video></div></article>';
  const media = readArticle(document.querySelector('article')!)!.media;
  expect(media).toEqual([{ kind: 'video', url: 'https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/test.jpg' }, { kind: 'image', url: 'https://pbs.twimg.com/media/photo.jpg' }, { kind: 'video', url: 'https://pbs.twimg.com/media/poster.jpg' }]);
  expect(validatePosts([{ ...observation(), media: [{ kind: 'image', url: 'https://pbs.twimg.com/amplify_video_thumb/123/img/test.jpg' }] }])[0]?.media[0]?.kind).toBe('video');
});

it('reads CSS video covers, srcset-only photos and multiple photos without collecting quote/card/avatar media', () => {
  document.body.innerHTML = `<article><a href="/test_author/status/123"><time></time></a>
    <img src="https://pbs.twimg.com/profile_images/avatar.jpg">
    <div data-testid="videoPlayer"><div style="background-image:url('https://pbs.twimg.com/amplify_video_thumb/123/img/cover?format=webp&name=medium')"></div><video src="blob:https://x.com/synthetic" poster="https://pbs.twimg.com/amplify_video_thumb/123/img/cover?format=jpg&name=small"></video></div>
    <div data-testid="tweetPhoto"><img srcset="https://pbs.twimg.com/media/one?format=jpg&name=small 300w, https://pbs.twimg.com/media/one?format=jpg&name=large 900w"></div>
    <div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/two.jpg"></div>
    <div data-testid="tweetPhoto" style="background-image:url(https://pbs.twimg.com/media/three.jpg)"></div>
    <div data-testid="quoteTweet"><div data-testid="videoPlayer" style="background-image:url(https://pbs.twimg.com/media/quote.jpg)"></div></div>
    <div data-testid="card.wrapper"><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/card_img/card.jpg"></div></div>
    <div data-testid="videoPlayer" style="background-image:url(https://other.invalid/track.jpg)"><img src="https://pbs.twimg.com.evil/track.jpg"></div>
  </article>`;
  const article = document.querySelector('article')!; const before = article.innerHTML;
  const post = readArticle(article, timestamp)!;
  expect(post.media).toEqual([
    { kind: 'video', url: 'https://pbs.twimg.com/amplify_video_thumb/123/img/cover?format=webp&name=medium' },
    { kind: 'image', url: 'https://pbs.twimg.com/media/one?format=jpg&name=large' },
    { kind: 'image', url: 'https://pbs.twimg.com/media/two.jpg' }, { kind: 'image', url: 'https://pbs.twimg.com/media/three.jpg' },
  ]);
  expect(validatePosts([post])[0]?.media).toHaveLength(4); expect(article.innerHTML).toBe(before);
});

it('keeps the eight-reference limit and upgrades duplicate covers to video', () => {
  document.body.innerHTML = '<article><a href="/test_author/status/123"><time></time></a>' + Array.from({ length: 9 }, (_, i) => `<div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/photo-${i}?name=small"></div>`).join('') + '<video poster="https://pbs.twimg.com/media/photo-0?name=large"></video></article>';
  const post = readArticle(document.querySelector('article')!, timestamp)!;
  expect(post.media).toHaveLength(8); expect(post.media[0]?.kind).toBe('video');
  expect(post.media.map(item => item.url)).not.toContain('https://pbs.twimg.com/media/photo-8?name=small');
});

it('captures safe link-card images separately from post media without changing the source DOM', () => {
  document.body.innerHTML = '<article><a href="/test_author/status/123"><time></time></a><div data-testid="tweetText">記事</div><a data-testid="card.wrapper" href="https://t.co/card" data-expanded-url="https://example.invalid/story"><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/card_img/123/cover.jpg" alt="記事の見出し"></div></a><div data-testid="card.wrapper"><a href="javascript:alert(1)"><img src="https://pbs.twimg.com/card_img/unsafe.jpg"></a></div><div data-testid="card.wrapper"><a href="https://example.invalid/other"><img src="https://other.invalid/track.jpg"></a></div><div data-testid="quoteTweet"><div data-testid="card.wrapper"><a href="https://example.invalid/quote"><img src="https://pbs.twimg.com/card_img/quote.jpg"></a></div></div></article>';
  const article = document.querySelector('article')!; const before = article.innerHTML;
  const p = readArticle(article, timestamp)!;
  expect(p.linkCards).toEqual([{ url: 'https://example.invalid/story', title: '記事の見出し', imageUrl: 'https://pbs.twimg.com/card_img/123/cover.jpg' }]);
  expect(p.media).toEqual([]); expect(p.text).toContain('https://example.invalid/story');
  expect(validatePosts([p])[0]?.linkCards).toEqual(p.linkCards); expect(article.innerHTML).toBe(before);
});

it('rejects unsafe, duplicate and oversized link cards at the message boundary', () => {
  const card = { url: 'https://example.invalid/story', title: '安全な見出し', imageUrl: 'https://pbs.twimg.com/card_img/123.jpg' };
  for (const linkCards of [
    [{ ...card, url: 'javascript:alert(1)' }], [{ ...card, url: 'https://user:secret@example.invalid/' }],
    [{ ...card, imageUrl: 'https://pbs.twimg.com.evil/track.jpg' }], [{ ...card, imageUrl: 'data:image/svg+xml,a' }],
    [{ ...card, title: 'a'.repeat(301) }], [card, card], Array.from({ length: 5 }, (_, i) => ({ ...card, url: `https://example.invalid/${i}` })),
  ]) expect(() => validatePosts([{ ...observation(), linkCards }])).toThrow('リンクカード');
  expect(validatePosts([observation()])[0]).not.toHaveProperty('linkCards');
});

it('accepts only the exact History Likes route alongside the existing library URLs', () => {
  for (const url of ['https://x.com/i/history/likes', 'https://x.com/i/history/likes/', 'https://x.com/i/history/likes?lang=ja']) {
    expect(isLibraryUrl(url)).toBe(true); expect(isBookmarkUrl(url)).toBe(false);
  }
  for (const url of ['https://x.com.evil/i/history/likes', 'http://x.com/i/history/likes', 'https://x.com:8443/i/history/likes', 'https://user:password@x.com/i/history/likes', 'https://x.com/i/history/likes/other', 'https://x.com/i/history/posts', 'https://x.com/i/history/likes-other']) expect(isLibraryUrl(url)).toBe(false);
});
it('identifies the explicit History Likes route without tab markup and rejects conflicting visible scopes', () => {
  const url = 'https://x.com/i/history/likes';
  document.body.innerHTML = '<a data-testid="AppTabBar_Profile_Link" href="/Sample">Profile</a>';
  expect(libraryScope(document, url)).toBe('likes'); expect(bookmarkScope(document, url)).toBe(false);
  document.body.insertAdjacentHTML('beforeend', '<button role="tab" aria-selected="true">いいね</button>');
  expect(libraryScope(document, url + '/')).toBe('likes');
  document.querySelector('button')!.textContent = 'Bookmarks'; expect(libraryScope(document, url)).toBeNull();
  document.body.insertAdjacentHTML('beforeend', '<button role="tab" aria-selected="true">Likes</button>');
  expect(libraryScope(document, url)).toBeNull();
});
it('recognizes History scopes and only the logged-in owner’s likes URL', () => {
  document.body.innerHTML = '<a data-testid="AppTabBar_Profile_Link" href="/Sample">Profile</a><button role="tab" aria-selected="true">いいね</button>';
  const doc = document;
  expect(libraryScope(doc, 'https://x.com/i/history')).toBe('likes');
  expect(libraryScope(doc, 'https://x.com/sample/likes')).toBe('likes');
  expect(libraryScope(doc, 'https://x.com/another/likes')).toBeNull();
  expect(libraryScope(doc, 'https://x.com/i/bookmarks')).toBe('bookmarks');
  doc.querySelector('button')!.textContent = 'Posts'; expect(libraryScope(doc, 'https://x.com/i/history')).toBeNull();
  doc.body.insertAdjacentHTML('beforeend', '<button role="tab" aria-selected="true">Likes</button><button role="tab" aria-selected="true">Bookmarks</button>');
  expect(libraryScope(doc, 'https://x.com/i/history')).toBeNull();
  for (const url of ['https://x.com.evil/sample/likes', 'http://x.com/sample/likes', 'https://evil@x.com/sample/likes', 'https://x.com/sample/likes/other']) expect(isLibraryUrl(url)).toBe(false);
});
