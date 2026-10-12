import { describe, expect, it } from 'vitest';
import { emptyLocalLibrary, mergeLocalImport, parseLocalImport, parseLocalLibrary, serializeLocalLibrary, saveLocalMark, toggleLocalMark, setLocalRead, moveLocalMark, demoteLocalMark,
  setLocalTags, localBackup, localBookmarksBackup, localView, dateFromPostId, validateLocalLibrary, type LocalLibrary } from '../../src/local-data';
import { EMPTY_VIEWER_FILTERS, filterViewerPosts } from '../../src/viewer-data';
import { openLocalFile, newLocalTarget, saveLocalFile, type LocalFileHandle } from '../../src/local-files';
import { likesScript, syntheticLikes, viewerBackup } from '../viewer-fixtures';
import { validateBackup } from '../../src/backup-format';

const importBackup = () => mergeLocalImport(emptyLocalLibrary(), parseLocalImport(JSON.stringify(viewerBackup()))).library;
function memoryFile(text = '') {
  let contents = text; let staged = ''; const calls: string[] = []; let failWrite = false; let failClose = false;
  const handle: LocalFileHandle = { name: 'synthetic-library.json', async getFile() { return new File([contents], handle.name); },
    async createWritable() { calls.push('create'); return { async write(text) { calls.push('write'); staged = text; if (failWrite) throw new Error('Synthetic write failure'); },
      async close() { calls.push('close'); if (failClose) throw new Error('Synthetic close failure'); contents = staged; }, async abort() { calls.push('abort'); staged = ''; } }; } };
  return { handle, calls, contents: () => contents, external: (text: string) => { contents = text; }, failures: (write: boolean, close: boolean) => { failWrite = write; failClose = close; } };
}
describe('local file library', () => {
  it('accumulates sources, separates same IDs/accounts, and preserves editing on repeat imports', () => {
    let lib = importBackup(); const likes = [{ like: { tweetId: '1', fullText: 'Like', expandedUrl: 'https://x.com/i/status/1' } }];
    lib = mergeLocalImport(lib, parseLocalImport(JSON.stringify(likes))).library;
    lib = saveLocalMark(lib, 'likes', 'likes', '資料', 'heart'); const mark = lib.libraries.likes.tags[0]!;
    lib = toggleLocalMark(lib, 'likes', 'likes:1', mark.id); lib = setLocalRead(lib, 'likes', 'likes:1', true);
    const next = mergeLocalImport(lib, parseLocalImport(JSON.stringify(likes)));
    expect(next.added).toBe(0); expect(next.existing).toBe(1); expect(next.library.libraries.bookmarks.posts).toHaveLength(3);
    expect(next.library.libraries.likes.posts[0]).toMatchObject({ authorHandle: '', read: true, tagIds: [mark.id] });
    const again = mergeLocalImport(next.library, parseLocalImport(JSON.stringify(viewerBackup())));
    expect(again.library.libraries.bookmarks.posts[0]).toMatchObject({ accountId: 'a', read: true, favorite: true, tagIds: ['mark-a', 'tag-a'] });
    expect(again.library.libraries.likes.tags).toEqual(next.library.libraries.likes.tags);
  });
  it('round trips local settings, source boundaries, marks and extension v1/v2 metadata', () => {
    let lib = importBackup(); lib.settings = { language: 'en', theme: 'dark', layout: 'list', columns: 5 };
    expect(parseLocalLibrary(serializeLocalLibrary(lib))).toEqual(validateLocalLibrary(lib));
    const b = localBookmarksBackup(lib); expect(validateBackup(b)).toEqual(b);
    expect(b.posts).toEqual(viewerBackup().posts); expect(b.userStates[0]).toMatchObject({ favorite: true, read: true });
    const old = viewerBackup(); old.formatVersion = 1; lib = mergeLocalImport(emptyLocalLibrary(), parseLocalImport(JSON.stringify(old))).library;
    expect(lib.libraries.bookmarks.tags.every(t => !t.mark)).toBe(true);
  });
  it('keeps incoming order, local order, same-name tags and account remapping when merging', () => {
    const b = viewerBackup(); b.tags = [{ id: 's', accountId: 'a', name: 'Second', mark: 'star', markOrder: 1 }, { id: 'f', accountId: 'a', name: 'First', mark: 'book', markOrder: 0 }]; b.postTags = [];
    let lib = mergeLocalImport(emptyLocalLibrary(), parseLocalImport(JSON.stringify(b))).library;
    expect(localView(lib.libraries.bookmarks).tags.map(t => t.name)).toEqual(['First', 'Second']);
    lib = moveLocalMark(lib, 'bookmarks', 'a', 's', -1);
    b.accounts[0]!.id = 'different-id'; b.posts = b.posts.filter(p => p.accountId === 'a').map(p => ({ ...p, accountId: 'different-id' })); b.tags = b.tags.map(t => ({ ...t, accountId: 'different-id' })); b.userStates = [];
    lib = mergeLocalImport(lib, parseLocalImport(JSON.stringify(b))).library;
    expect(lib.libraries.bookmarks.posts).toHaveLength(3); expect(localView(lib.libraries.bookmarks).tags.map(t => t.name)).toEqual(['Second', 'First']);
    expect(lib.libraries.bookmarks.tags.every(t => t.accountId === 'a')).toBe(true);
    const unranked = structuredClone(lib); for (const t of unranked.libraries.bookmarks.tags) delete t.markOrder;
    const reopened = parseLocalLibrary(JSON.stringify(unranked));
    const renamed = saveLocalMark(reopened, 'bookmarks', 'a', 'Renamed', 'book', 's');
    expect(localView(renamed.libraries.bookmarks).tags.map(t => t.id)).toEqual(['f', 's']);
  });
  it('limits 30 marks and 20 assignments without changing prior objects, with edit/demotion association protection', () => {
    let lib = mergeLocalImport(emptyLocalLibrary(), parseLocalImport(likesScript())).library;
    for (let i = 0; i < 30; i++) lib = saveLocalMark(lib, 'likes', 'likes', `mark${i}`, 'star');
    expect(() => saveLocalMark(lib, 'likes', 'likes', '31', 'star')).toThrow();
    const p = lib.libraries.likes.posts[0]!; const k = `likes:${p.postId}`;
    for (const t of lib.libraries.likes.tags.slice(0, 20)) lib = toggleLocalMark(lib, 'likes', k, t.id);
    expect(() => toggleLocalMark(lib, 'likes', k, lib.libraries.likes.tags[20]!.id)).toThrow();
    const t = lib.libraries.likes.tags[0]!; lib = saveLocalMark(lib, 'likes', 'likes', 'Renamed', 'book', t.id);
    lib = demoteLocalMark(lib, 'likes', t.id); expect(lib.libraries.likes.posts[0]!.tagIds).toContain(t.id); expect(lib.libraries.likes.tags.find(item => item.id === t.id)?.mark).toBeUndefined();
    expect(() => toggleLocalMark(lib, 'bookmarks', k, t.id)).toThrow();
  });
  it('rejects a merged assignment overflow atomically and preserves both states and mark definitions', () => {
    const lib = importBackup(); const next = setLocalTags(lib, 'bookmarks', 'a:1', Array.from({ length: 20 }, (_, i) => `local${i}`)); const before = JSON.stringify(next);
    expect(() => mergeLocalImport(next, parseLocalImport(JSON.stringify(viewerBackup())))).toThrow(); expect(JSON.stringify(next)).toBe(before);
  });
  it('exports only selected mark dependencies and keeps whole-library backup distinct from extension format', () => {
    let lib = importBackup(); lib = mergeLocalImport(lib, parseLocalImport(likesScript(2))).library;
    const selected = localBackup(lib, 'bookmarks', 'mark-a'); expect(selected.libraries.bookmarks.posts).toHaveLength(1); expect(selected.libraries.likes.posts).toHaveLength(0);
    expect(selected.libraries.bookmarks.tags.map(t => t.id)).toEqual(['mark-a', 'tag-a']); expect(selected.libraries.bookmarks.accounts).toEqual([{ id: 'a', handle: 'sample_a' }]);
    expect(localBookmarksBackup(lib, 'mark-a').posts).toHaveLength(1); expect(() => localBackup(lib, 'bookmarks', 'tag-a')).toThrow();
    const added = mergeLocalImport(emptyLocalLibrary(), parseLocalImport(serializeLocalLibrary(localBackup(lib)))); expect(added.added).toBe(5);
  });
  it('distinguishes unknown media from observed empty and infers only a plausible posting date', () => {
    const ms = Date.UTC(2026, 0, 2, 3, 4, 5); const id = ((BigInt(ms) - 1288834974657n) << 22n).toString();
    expect(dateFromPostId(id, ms + 1)).toBe(new Date(ms).toISOString()); expect(dateFromPostId('20')).toBeNull(); expect(dateFromPostId('99999999999999999999')).toBeNull();
    const lib = mergeLocalImport(emptyLocalLibrary(), parseLocalImport(JSON.stringify([{ like: { tweetId: id, expandedUrl: `https://twitter.com/i/web/status/${id}` } }]))).library;
    const posts = localView(lib.libraries.likes).posts; expect(posts[0]).toMatchObject({ dateSource: 'id', text: '', mediaStatus: 'unknown', read: false });
    expect(filterViewerPosts(posts, { ...EMPTY_VIEWER_FILTERS, media: 'without' })).toHaveLength(0);
    expect(filterViewerPosts(posts, { ...EMPTY_VIEWER_FILTERS, media: 'unknown' })).toHaveLength(1);
  });
  it('does not apply imported library settings and keeps existing favorites/read state', () => {
    const lib = importBackup(); const incoming = structuredClone(lib); incoming.settings.language = 'en'; incoming.libraries.bookmarks.posts[0]!.favorite = false;
    const next = mergeLocalImport(lib, parseLocalImport(serializeLocalLibrary(incoming))).library;
    expect(next.settings.language).toBe('system'); expect(next.libraries.bookmarks.posts[0]!.favorite).toBe(true);
  });
  it('rejects malformed versions, relations, cross-account tags, hostile media/URLs and executable source', () => {
    const base = importBackup();
    for (const edit of [(lib: LocalLibrary) => { lib.formatVersion = 2 as 1; }, (lib: LocalLibrary) => { lib.libraries.bookmarks.posts[0]!.tagIds = ['mark-b']; },
      (lib: LocalLibrary) => { lib.libraries.bookmarks.posts[0]!.media[0]!.url = 'https://evil.example/synthetic.jpg'; },
      (lib: LocalLibrary) => { lib.libraries.bookmarks.posts[0]!.url = 'javascript:alert(1)'; }]) {
      const bad = structuredClone(base); edit(bad); expect(() => parseLocalLibrary(JSON.stringify(bad))).toThrow();
    }
    expect(() => parseLocalImport('window.YTD.like.part0 = []; alert(1)')).toThrow();
    expect(() => parseLocalImport(' '.repeat(20 * 1024 * 1024 + 1))).toThrow('size');
  });
  it('searches and pages 20,838 synthetic likes after accumulation and local round-trip', () => {
    const lib = mergeLocalImport(emptyLocalLibrary(), parseLocalImport(likesScript(20838))).library;
    const loaded = parseLocalLibrary(serializeLocalLibrary(lib)); const view = localView(loaded.libraries.likes);
    expect(view.posts).toHaveLength(20838); expect(filterViewerPosts(view.posts, { ...EMPTY_VIEWER_FILTERS, query: 'shelf 日本語' })).toHaveLength(1);
  });
  it('round trips 200,000 posts above 64 MiB and rejects a cumulative overflow without losing edits', () => {
    const lib = importBackup(); const template = lib.libraries.bookmarks.posts[0]!;
    for (const source of ['bookmarks', 'likes'] as const) {
      lib.libraries[source] = { accounts: lib.libraries.bookmarks.accounts, tags: lib.libraries.bookmarks.tags,
        posts: Array.from({ length: 100000 }, (_, i) => ({ ...template, postId: String(i + 1), url: `https://x.com/${template.authorHandle}/status/${i + 1}`, text: `合成の容量測定 ${i} ` + '資料'.repeat(50) })) };
    }
    const edited = toggleLocalMark(setLocalRead(lib, 'likes', 'a:1', false), 'likes', 'a:1', 'mark-a');
    const text = serializeLocalLibrary(edited); expect(new TextEncoder().encode(text).length).toBeGreaterThan(64 * 1024 * 1024);
    const restored = parseLocalLibrary(text);
    expect(restored.formatVersion).toBe(1);
    expect(restored.libraries.bookmarks.posts).toHaveLength(100000); expect(restored.libraries.likes.posts).toHaveLength(100000);
    expect(restored.libraries.likes.posts[0]).toMatchObject({ read: false, favorite: true, tagIds: ['tag-a'] });
    expect(restored.libraries.bookmarks.posts[0]).toMatchObject({ read: true, favorite: true, tagIds: ['mark-a', 'tag-a'] });
    const incoming = { ...restored.libraries.bookmarks, posts: [{ ...restored.libraries.bookmarks.posts[0]!, postId: '100001', url: `https://x.com/${template.authorHandle}/status/100001` }] };
    expect(() => mergeLocalImport(restored, { source: 'bookmarks', duplicates: 0, collections: { bookmarks: incoming } })).toThrow('records');
    expect(restored.libraries.likes.posts[0]).toMatchObject({ read: false, favorite: true, tagIds: ['tag-a'] });
    expect(restored.libraries.bookmarks.posts).toHaveLength(100000);
  }, 60000);
});
describe('local file writes', () => {
  it('accepts the 512 MiB file-size boundary and rejects larger files before reading or writing', async () => {
    const text = serializeLocalLibrary(importBackup()); let reads = 0; let writes = 0;
    const handle: LocalFileHandle = { name: 'synthetic-boundary.json', async getFile() {
      const file = new File([], handle.name); Object.defineProperty(file, 'size', { value: 512 * 1024 * 1024 });
      file.text = async () => { reads++; return text; }; return file;
    }, async createWritable() { writes++; throw new Error('Unexpected write'); } };
    expect((await openLocalFile(handle)).bytes).toBe(512 * 1024 * 1024); expect(reads).toBe(1);
    handle.getFile = async () => { const file = new File([], handle.name); Object.defineProperty(file, 'size', { value: 512 * 1024 * 1024 + 1 }); file.text = async () => { reads++; return text; }; return file; };
    await expect(openLocalFile(handle)).rejects.toThrow('size'); expect(reads).toBe(1); expect(writes).toBe(0);
  });
  it('saves, closes and reopens exact edits without any browser store', async () => {
    const file = memoryFile(); const lib = importBackup(); const target = await newLocalTarget(file.handle); const saved = await saveLocalFile(target, lib);
    expect(file.calls).toEqual(['create', 'write', 'close']); expect((await openLocalFile(saved.handle)).library).toEqual(validateLocalLibrary(lib));
  });
  it('rejects source archive/backup as save targets before opening a writer', async () => {
    for (const contents of [likesScript(), JSON.stringify(viewerBackup())]) { const file = memoryFile(contents); await expect(newLocalTarget(file.handle)).rejects.toThrow(); expect(file.calls).toEqual([]); expect(file.contents()).toBe(contents); }
  });
  it('aborts failed writes/close and keeps the committed file and in-memory changes', async () => {
    for (const closeFailure of [false, true]) {
      const original = serializeLocalLibrary(importBackup()); const file = memoryFile(original); const target = (await openLocalFile(file.handle)).target;
      const edited = setLocalRead(importBackup(), 'bookmarks', 'a:2', true); file.failures(!closeFailure, closeFailure);
      await expect(saveLocalFile(target, edited)).rejects.toThrow(); expect(file.contents()).toBe(original); expect(file.calls).toContain('abort');
      file.failures(false, false); await saveLocalFile(target, edited); expect(parseLocalLibrary(file.contents()).libraries.bookmarks.posts[1]!.read).toBe(true);
    }
  });
  it('detects external modifications before writing and after commit', async () => {
    const file = memoryFile(serializeLocalLibrary(importBackup())); const target = (await openLocalFile(file.handle)).target;
    file.external(serializeLocalLibrary(emptyLocalLibrary())); await expect(saveLocalFile(target, importBackup())).rejects.toThrow('conflict'); expect(file.calls).toEqual([]);
  });
});
