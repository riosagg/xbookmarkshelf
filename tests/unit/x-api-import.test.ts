import { describe, expect, it } from 'vitest';
import { convertXApiPages, parseXApiPage, type XApiPage } from '../../src/x-api-import';
import { emptyLocalLibrary, mergeLocalImport, mergeLocalImports, parseLocalImport, parseLocalLibrary, serializeLocalLibrary, setLocalRead, saveLocalMark, toggleLocalMark } from '../../src/local-data';
import { apiResponse } from '../x-api-fixtures';
import { likesScript, viewerBackup } from '../viewer-fixtures';

const page = (raw: unknown): XApiPage => parseXApiPage(JSON.stringify(raw))!;
const owner = { id: 'a', handle: 'sample_a' };
describe('offline X API v2 import', () => {
  it('converts authors, full text, dates, images, video covers, links and quoted posts without using author as owner', () => {
    const raw = apiResponse(['1']);
    Object.assign(raw.data[0]!, { note_tweet: { text: 'Full note text', entities: raw.data[0]!.entities } });
    const { input, warnings } = convertXApiPages([page(raw)], 'bookmarks', owner);
    const p = input.collections.bookmarks!.posts[0]!;
    expect(p).toMatchObject({ accountId: 'a', postId: '1', authorHandle: 'synthetic', authorName: 'Synthetic author', text: 'Full note text\nhttps://example.com/article',
      postedAt: '2026-10-01T12:00:00.000Z', dateSource: 'provided', read: false, favorite: false, tagIds: [], mediaStatus: 'observed', partial: false,
      media: [{ kind: 'image', url: 'https://pbs.twimg.com/media/api-photo.jpg' }, { kind: 'video', url: 'https://pbs.twimg.com/ext_tw_video_thumb/api-video.jpg' }],
      quote: { postId: '10', authorHandle: 'quoted', text: 'Synthetic quoted text' }, linkCards: [{ url: 'https://example.com/article', title: 'Synthetic article', imageUrl: 'https://pbs.twimg.com/card_img/api-card.jpg' }] });
    expect(warnings).toEqual({ authors: 0, media: 0, quotes: 0, errors: 0, more: true });
  });
  it('supports post field aliases as well as tweet field names', () => {
    const raw = apiResponse(['1']); const p = raw.data[0]!;
    Object.assign(p, { note_post: { text: 'New note alias' }, referenced_posts: p.referenced_tweets }); Reflect.deleteProperty(p, 'referenced_tweets');
    Object.assign(raw.includes, { posts: raw.includes.tweets }); Reflect.deleteProperty(raw.includes, 'tweets');
    const converted = convertXApiPages([page(raw)], 'likes', owner).input.collections.likes!.posts[0]!;
    expect(converted.text).toBe('New note alias\nhttps://example.com/article'); expect(converted.quote?.text).toBe('Synthetic quoted text');
  });
  it('resolves metadata across pages, merges overlapping posts in file order, and reports duplicates', () => {
    const first = apiResponse(['1', '3']); first.includes = { users: [], media: [], tweets: [] };
    const second = apiResponse(['3', '4']); second.data[0]!.text += ' with more content';
    const result = convertXApiPages([page(first), page(second)], 'bookmarks', owner);
    expect(result.input.collections.bookmarks!.posts.map(p => p.postId)).toEqual(['1', '3', '4']);
    expect(result.input.duplicates).toBe(1); expect(result.input.collections.bookmarks!.posts[1]!.text).toContain('with more content');
    expect(result.warnings).toMatchObject({ authors: 0, media: 0, quotes: 0 });
  });
  it('preserves local marks, order, tags, read/favorite, first import, settings, and other source/account records on repeats', () => {
    let lib = mergeLocalImport(emptyLocalLibrary(), parseLocalImport(JSON.stringify(viewerBackup()))).library;
    lib = mergeLocalImport(lib, parseLocalImport(likesScript())).library; lib.settings.theme = 'dark';
    const before = structuredClone(lib); const input = convertXApiPages([page(apiResponse())], 'bookmarks', owner).input;
    const result = mergeLocalImports(lib, [input, input]); const p = result.library.libraries.bookmarks.posts.find(p => p.accountId === 'a' && p.postId === '1')!;
    expect(result.added).toBe(1); expect(result.existing).toBe(3);
    expect(p).toMatchObject({ read: true, favorite: true, tagIds: ['mark-a', 'tag-a'], firstImportedAt: before.libraries.bookmarks.posts[0]!.firstImportedAt });
    expect(p.text).toContain('API synthetic'); expect(result.library.libraries.bookmarks.tags).toEqual(before.libraries.bookmarks.tags);
    expect(result.library.libraries.likes).toEqual(before.libraries.likes);
    expect(result.library.libraries.bookmarks.posts.find(p => p.accountId === 'b' && p.postId === '1')).toEqual(before.libraries.bookmarks.posts[2]);
    expect(result.library.settings).toEqual(before.settings); expect(lib).toEqual(before);
    expect(parseLocalLibrary(serializeLocalLibrary(result.library))).toEqual(result.library);
  });
  it('can enrich the special likes archive while preserving its read state and marks', () => {
    const archive = [{ like: { tweetId: '1', fullText: 'Short', expandedUrl: 'https://x.com/i/status/1' } }];
    let lib = mergeLocalImport(emptyLocalLibrary(), parseLocalImport(JSON.stringify(archive))).library;
    lib = saveLocalMark(lib, 'likes', 'likes', 'Saved mark', 'star'); const tag = lib.libraries.likes.tags[0]!;
    lib = toggleLocalMark(setLocalRead(lib, 'likes', 'likes:1', true), 'likes', 'likes:1', tag.id);
    const input = convertXApiPages([page(apiResponse(['1']))], 'likes', { id: 'likes', handle: '' }).input;
    const result = mergeLocalImports(lib, [input]); expect(result.added).toBe(0);
    expect(result.library.libraries.likes.posts[0]).toMatchObject({ read: true, tagIds: [tag.id], authorHandle: 'synthetic', mediaStatus: 'observed' });
  });
  it('keeps sources and owner accounts separate, including a conflicting incoming account id', () => {
    let lib = emptyLocalLibrary();
    const responses = [page(apiResponse(['1']))];
    for (const source of ['bookmarks', 'likes'] as const) for (const handle of ['first_owner', 'second_owner']) {
      lib = mergeLocalImport(lib, convertXApiPages(responses, source, { id: 'same', handle }).input).library;
    }
    for (const source of ['bookmarks', 'likes'] as const) { const c = lib.libraries[source]; expect(c.posts).toHaveLength(2); expect(new Set(c.posts.map(p => p.accountId)).size).toBe(2); }
  });
  it('keeps missing media unknown, derives only posting dates, and permits missing authors for likes only', () => {
    const response = page({ data: [{ id: '1900000000000000000', text: 'Minimal text', referenced_tweets: [{ type: 'quoted', id: '2' }] }] });
    const result = convertXApiPages([response], 'likes', owner);
    expect(result.input.collections.likes!.posts[0]).toMatchObject({ authorHandle: '', url: 'https://x.com/i/status/1900000000000000000', dateSource: 'id', mediaStatus: 'unknown', partial: true, media: [] });
    expect(result.warnings).toMatchObject({ authors: 1, media: 1, quotes: 1 });
    expect(() => convertXApiPages([response], 'bookmarks', owner)).toThrow('apiAuthor');
    const emptyMedia = convertXApiPages([page({ data: [{ id: '1', text: '', username: 'synthetic', attachments: { media_keys: [] } }] })], 'bookmarks', owner);
    expect(emptyMedia.input.collections.bookmarks!.posts[0]).toMatchObject({ postedAt: null, dateSource: 'unknown', mediaStatus: 'observed' });
  });
  it('drops unsafe image and link references, ignores credentials and video variants, and renders text as plain data', () => {
    const raw = apiResponse(['1']); raw.data[0]!.text = '<img src=x onerror=alert(1)>';
    raw.includes.media[0]!.url = 'https://evil.example/photo.jpg'; raw.includes.media[1]!.preview_image_url = 'https://user:secret@pbs.twimg.com/video.jpg';
    raw.data[0]!.entities.urls[0]!.expanded_url = 'javascript:alert(1)'; raw.data[0]!.entities.urls[0]!.url = 'file:///private/synthetic';
    raw.data[0]!.entities.urls[0]!.images[0]!.url = 'https://evil.example/card.jpg';
    Object.assign(raw, { access_token: 'synthetic-should-be-discarded' }); Object.assign(raw.includes.media[1]!, { variants: [{ url: 'https://video.twimg.com/movie.mp4' }] });
    const input = convertXApiPages([page(raw)], 'bookmarks', owner).input; const p = input.collections.bookmarks!.posts[0]!;
    expect(p.media).toEqual([]); expect(p.mediaStatus).toBe('unknown'); expect(p.linkCards).toEqual([]); expect(p.text).toBe('<img src=x onerror=alert(1)>');
    expect(JSON.stringify(input)).not.toMatch(/synthetic-should-be-discarded|evil\.example|secret|movie\.mp4/);
  });
  it('rejects malformed ids, dates, nested shapes, huge text, error-only results and single-post responses', () => {
    for (const raw of [{ data: [{ id: 9007199254740993, text: 'x' }] }, { data: [{ id: '1', text: 'x', created_at: 'invalid' }] },
      { data: [{ id: '1', text: 'x'.repeat(50001) }] }, { data: { id: '1', text: 'single' } }, { data: [], includes: [] },
      { errors: [{ detail: 'synthetic error' }] }, { data: [], errors: [{}] }, { data: [{ id: '1', attachments: [] }] }, { data: [{ id: '1', author_id: 123 }] }]) {
      expect(() => page(raw)).toThrow('apiFormat');
    }
  });
  it('accepts a successful empty response and reports partial API errors without importing error messages', () => {
    expect(page({ meta: { result_count: 0 } }).posts).toEqual([]);
    const raw = apiResponse(['1']); Object.assign(raw, { errors: [{ detail: 'synthetic-private-message' }] });
    const result = convertXApiPages([page(raw)], 'bookmarks', owner);
    expect(result.warnings.errors).toBe(1); expect(JSON.stringify(result)).not.toContain('synthetic-private-message');
  });
  it('leaves library untouched if a later file merge fails', () => {
    const lib = emptyLocalLibrary(); const before = JSON.stringify(lib);
    const valid = convertXApiPages([page(apiResponse(['1']))], 'bookmarks', owner).input;
    const invalid = structuredClone(valid); invalid.collections.bookmarks!.posts[0]!.postId = '2'; invalid.collections.bookmarks!.posts[0]!.url = 'javascript:alert(1)';
    expect(() => mergeLocalImports(lib, [valid, invalid])).toThrow(); expect(JSON.stringify(lib)).toBe(before);
  });
  it('applies the final post limit after deduplicating overlapping pages', () => {
    const minimal = page({ data: [{ id: '1', text: 'Same post', username: 'synthetic', attachments: { media_keys: [] } }] });
    const repeated = { ...minimal, posts: Array.from({ length: 40001 }, () => minimal.posts[0]!) };
    const result = convertXApiPages([repeated, repeated, repeated, repeated, repeated], 'bookmarks', owner);
    expect(result.input.collections.bookmarks!.posts).toHaveLength(1); expect(result.input.duplicates).toBe(200004);
  });
  it('enforces API file size/count and leaves archive, backup and library detection to their current parsers', () => {
    expect(() => parseXApiPage(JSON.stringify({ data: [{ id: '1', text: 'x' }] }) + ' '.repeat(20 * 1024 * 1024))).toThrow('size');
    expect(() => page({ data: Array.from({ length: 50001 }, () => ({ id: '1', text: '' })) })).toThrow('apiFormat');
    for (const text of [likesScript(), JSON.stringify(viewerBackup()), serializeLocalLibrary(emptyLocalLibrary())]) expect(parseXApiPage(text)).toBeNull();
    expect(parseXApiPage('\uFEFF' + JSON.stringify(apiResponse(['1'])))!.posts).toHaveLength(1);
  });
});
