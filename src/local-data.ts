import { validateBackup, validateLikesBackup, type CollectionBackup, type Backup } from './backup-format';
import { MAX_MARKS, MAX_POST_TAGS, isMarkSymbol, isMarkOrder, isMediaUrl, validHandle, orderedMarks, mergeMedia, mergeQuote, validateQuote, type Tag, type MarkSymbol, type Post } from './model';
import { validateBackupSnapshot, verifyBackupParts } from './backup-parts';
import { parseViewerText, normalizeSearch, type ViewerData, ViewerInputError } from './viewer-data';
import { textLinks, webUrl } from './text';

export const LOCAL_MAX_BYTES = 512 * 1024 * 1024;
export const LOCAL_MAX_POSTS = 200000;
export type LocalSource = 'bookmarks' | 'likes';
export interface LocalPost extends Post {
  mediaStatus: 'unknown' | 'observed'; dateSource: 'unknown' | 'provided' | 'id';
  read: boolean; favorite: boolean; tagIds: string[];
}
export interface LocalCollection { accounts: { id: string; handle: string }[]; posts: LocalPost[]; tags: Tag[] }
export interface LocalSettings { language: 'system' | 'ja' | 'en'; theme: 'system' | 'light' | 'dark'; columns: number; layout: 'grid' | 'list' }
export interface LocalLibrary {
  format: 'xbookmarkshelf-local'; formatVersion: 1; updatedAt: string;
  libraries: Record<LocalSource, LocalCollection>; settings: LocalSettings;
}
export type LocalError = 'format' | 'size' | 'records' | 'marks' | 'tags' | 'empty' | 'conflict' | 'save' | 'parts' | 'apiFormat' | 'apiAuthor';
export class LocalDataError extends Error { constructor(readonly code: LocalError) { super(code); } }
function fail(code: LocalError = 'records'): never { throw new LocalDataError(code); }
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(v);
const date = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v));
const array = (v: unknown, max: number): unknown[] => Array.isArray(v) && v.length <= max ? v : fail();
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : fail();
const key = (p: Pick<LocalPost, 'accountId' | 'postId'>) => `${p.accountId}:${p.postId}`;
export const localCount = (lib: LocalLibrary) => lib.libraries.bookmarks.posts.length + lib.libraries.likes.posts.length;
export function emptyLocalLibrary(): LocalLibrary {
  return { format: 'xbookmarkshelf-local', formatVersion: 1, updatedAt: new Date().toISOString(),
    libraries: { bookmarks: { accounts: [], posts: [], tags: [] }, likes: { accounts: [{ id: 'likes', handle: '' }], posts: [], tags: [] } },
    settings: { language: 'system', theme: 'system', columns: 3, layout: 'grid' } };
}
function validPostUrl(value: unknown, postId: string, handle: string) {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) return false;
  try {
    const u = new URL(value); const match = /^\/(?:([a-zA-Z0-9_]{1,15})\/status|i\/web\/status|i\/status)\/(\d{1,30})\/?$/.exec(u.pathname);
    return ['https://x.com', 'https://twitter.com'].includes(u.origin) && !u.username && !u.password && !!match && match[2] === postId && (/^\/i\/status\//.test(u.pathname) || !match[1] || match[1].toLowerCase() === handle.toLowerCase());
  } catch { return false; }
}
// Older sequential IDs are deliberately left undated. Do not infer a like time.
export function dateFromPostId(postId: string, now = Date.now()): string | null {
  if (!/^\d{1,20}$/.test(postId)) return null;
  const n = BigInt(postId); if (n > 9223372036854775807n) return null;
  const ms = Number((n >> 22n) + 1288834974657n);
  return ms >= Date.UTC(2011, 0, 1) && ms <= now ? new Date(ms).toISOString() : null;
}
export function validateLocalLibrary(input: unknown): LocalLibrary {
  const v = record(input);
  if (v.format !== 'xbookmarkshelf-local' || v.formatVersion !== 1 || !date(v.updatedAt)) fail('format');
  const settings = record(v.settings);
  if (!['system', 'ja', 'en'].includes(settings.language as string) || !['system', 'light', 'dark'].includes(settings.theme as string) ||
      !Number.isInteger(settings.columns) || Number(settings.columns) < 1 || Number(settings.columns) > 5 || !['grid', 'list'].includes(settings.layout as string)) fail();
  const collections = record(v.libraries); let total = 0;
  const libraries = {} as Record<LocalSource, LocalCollection>;
  for (const source of ['bookmarks', 'likes'] as const) {
    const c = record(collections[source]); const accountsSeen = new Set<string>(); const handles = new Set<string>();
    const accounts = array(c.accounts, 100).map(raw => {
      const a = record(raw);
      if (!id(a.id) || typeof a.handle !== 'string' || !(validHandle(a.handle) || (source === 'likes' && a.id === 'likes' && a.handle === '')) || accountsSeen.has(a.id) || handles.has(a.handle.toLowerCase())) fail();
      accountsSeen.add(a.id); handles.add(a.handle.toLowerCase()); return { id: a.id, handle: a.handle.toLowerCase() };
    });
    const tagIds = new Set<string>(); const names = new Set<string>(); const markCounts = new Map<string, number>();
    const tags = array(c.tags, 10000).map(raw => {
      const t = record(raw);
      if (!id(t.id) || !id(t.accountId) || !accountsSeen.has(t.accountId) || tagIds.has(t.id) || typeof t.name !== 'string' || !t.name.trim() || t.name.length > 100 || names.has(`${t.accountId}:${t.name.trim()}`) ||
        (t.mark !== undefined && !isMarkSymbol(t.mark)) || (t.markOrder !== undefined && (!t.mark || !isMarkOrder(t.markOrder)))) fail();
      tagIds.add(t.id); names.add(`${t.accountId}:${t.name.trim()}`);
      if (t.mark) { const n = (markCounts.get(t.accountId) ?? 0) + 1; if (n > MAX_MARKS) fail('marks'); markCounts.set(t.accountId, n); }
      return { id: t.id, accountId: t.accountId, name: t.name.trim(), ...(t.mark ? { mark: t.mark as MarkSymbol, ...(t.markOrder !== undefined ? { markOrder: t.markOrder as number } : {}) } : {}) };
    });
    for (const a of accounts) orderedMarks(tags.filter(t => t.accountId === a.id)).forEach((t, order) => { t.markOrder = order; });
    const tagMap = new Map(tags.map(t => [t.id, t])); const seen = new Set<string>();
    const posts = array(c.posts, LOCAL_MAX_POSTS).map(raw => {
      const p = record(raw);
      if (!id(p.accountId) || !accountsSeen.has(p.accountId) || typeof p.postId !== 'string' || !/^\d{1,30}$/.test(p.postId) || seen.has(`${p.accountId}:${p.postId}`) ||
        typeof p.authorHandle !== 'string' || !(validHandle(p.authorHandle) || (source === 'likes' && p.authorHandle === '')) || typeof p.authorName !== 'string' || p.authorName.length > 200 ||
        typeof p.text !== 'string' || p.text.length > 50000 || !validPostUrl(p.url, p.postId, p.authorHandle) || (source === 'bookmarks' && p.url !== `https://x.com/${p.authorHandle}/status/${p.postId}`) ||
        (p.postedAt !== null && !date(p.postedAt)) || !date(p.observedAt) || !date(p.firstImportedAt) || !date(p.lastImportedAt) || typeof p.partial !== 'boolean' ||
        !['unknown', 'observed'].includes(p.mediaStatus as string) || !['unknown', 'provided', 'id'].includes(p.dateSource as string) ||
        typeof p.read !== 'boolean' || typeof p.favorite !== 'boolean') fail();
      if ((p.postedAt === null) !== (p.dateSource === 'unknown')) fail();
      if (p.dateSource === 'id' && dateFromPostId(p.postId, Infinity) !== p.postedAt) fail();
      const media = array(p.media, 8).map(rawMedia => {
        const m = record(rawMedia); if (!['image', 'video'].includes(m.kind as string) || !isMediaUrl(m.url)) fail();
        return { kind: m.kind as 'image' | 'video', url: m.url as string };
      });
      if (p.mediaStatus === 'unknown' && media.length) fail();
      const cardUrls = new Set<string>();
      const linkCards = array(p.linkCards ?? [], 4).map(rawCard => {
        const card = record(rawCard); const url = webUrl(card.url);
        if (!url || cardUrls.has(url) || typeof card.title !== 'string' || card.title.length > 300 || !isMediaUrl(card.imageUrl)) fail();
        cardUrls.add(url); return { url, title: card.title as string, imageUrl: card.imageUrl as string };
      });
      const assigned = array(p.tagIds, MAX_POST_TAGS).map(t => { if (!id(t) || tagMap.get(t)?.accountId !== p.accountId) fail(); return t; });
      if (new Set(assigned).size !== assigned.length) fail();
      seen.add(`${p.accountId}:${p.postId}`);
      return { accountId: p.accountId, postId: p.postId, authorHandle: p.authorHandle, authorName: p.authorName, text: p.text, url: p.url as string,
        postedAt: p.postedAt as string | null, observedAt: p.observedAt, firstImportedAt: p.firstImportedAt, lastImportedAt: p.lastImportedAt, partial: p.partial,
        media, linkCards, ...(p.quote === undefined ? {} : { quote: validateQuote(p.quote) }), mediaStatus: p.mediaStatus as LocalPost['mediaStatus'], dateSource: p.dateSource as LocalPost['dateSource'], read: p.read, favorite: p.favorite, tagIds: assigned } as LocalPost;
    });
    total += posts.length; if (total > LOCAL_MAX_POSTS) fail(); libraries[source] = { accounts, tags, posts };
  }
  return { format: 'xbookmarkshelf-local', formatVersion: 1, updatedAt: v.updatedAt as string, libraries, settings: {
    language: settings.language as LocalSettings['language'], theme: settings.theme as LocalSettings['theme'], columns: settings.columns as number, layout: settings.layout as LocalSettings['layout'] } };
}
export function parseLocalLibrary(text: string): LocalLibrary {
  if (text.length > LOCAL_MAX_BYTES || new TextEncoder().encode(text).length > LOCAL_MAX_BYTES) fail('size');
  let raw: unknown; try { raw = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { return fail('format'); }
  return validateLocalLibrary(raw);
}
export function serializeLocalLibrary(lib: LocalLibrary): string {
  const text = JSON.stringify(validateLocalLibrary(lib));
  if (new TextEncoder().encode(text).length > LOCAL_MAX_BYTES) fail('size'); return text;
}
export function localView(collection: LocalCollection): ViewerData {
  const tags = new Map(collection.tags.map(t => [t.id, t]));
  return { kind: 'backup', accounts: collection.accounts, tags: [...orderedMarks(collection.tags), ...collection.tags.filter(t => !t.mark)], duplicates: 0,
    posts: collection.posts.map(p => {
      const assigned = p.tagIds.map(t => tags.get(t)!);
      return { ...p, linkCards: p.linkCards ?? [], key: key(p), tags: assigned, search: normalizeSearch([p.text, p.quote?.text ?? '', p.quote?.authorHandle ?? '', p.quote?.authorName ?? '', p.authorHandle, p.authorName, p.url, p.postId, ...assigned.map(t => t.name)].join('\n')), hasLinks: textLinks(p.text + '\n' + (p.quote?.text ?? '')).length > 0 };
    }) };
}
function fromBackup(b: CollectionBackup): LocalCollection {
  const states = new Map(b.userStates.map(s => [key(s), s])); const assigned = new Map<string, string[]>();
  for (const t of b.postTags) { const list = assigned.get(key(t)) ?? []; list.push(t.tagId); assigned.set(key(t), list); }
  return { accounts: b.accounts, tags: b.tags, posts: b.posts.map(p => ({ ...p, linkCards: p.linkCards ?? [], mediaStatus: 'observed', dateSource: p.postedAt ? 'provided' : 'unknown',
    read: states.get(key(p))?.read ?? false, favorite: states.get(key(p))?.favorite ?? false, tagIds: assigned.get(key(p)) ?? [] })) };
}
export interface LocalImport { backup?: CollectionBackup; collections: Partial<Record<LocalSource, LocalCollection>>; source: LocalSource; duplicates: number }
export function parseLocalImport(text: string, raw?: unknown): LocalImport {
  if (text.length > LOCAL_MAX_BYTES || new TextEncoder().encode(text).length > LOCAL_MAX_BYTES) fail('size');
  if (raw === undefined) try { raw = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { /* A like.js wrapper is handled by the pure parser. */ }
  if (raw && (raw as { format?: string }).format === 'xbookmarkshelf-local') {
    const lib = validateLocalLibrary(raw); return { collections: lib.libraries, source: lib.libraries.bookmarks.posts.length ? 'bookmarks' : 'likes', duplicates: 0 };
  }
  try {
    const view = parseViewerText(text);
    if (view.kind === 'backup') {
      const source = view.source ?? 'bookmarks';
      const backup = source === 'likes' ? validateLikesBackup(raw) : validateBackup(raw);
      return { backup, collections: { [source]: fromBackup(backup) }, source, duplicates: 0 };
    }
    const now = new Date().toISOString();
    const posts = view.posts.map(p => {
      const postedAt = dateFromPostId(p.postId);
      return { postId: p.postId, accountId: 'likes', authorHandle: p.authorHandle, authorName: p.authorName, text: p.text, url: p.url,
        postedAt, dateSource: postedAt ? 'id' as const : 'unknown' as const, observedAt: now, firstImportedAt: now, lastImportedAt: now, partial: true,
        media: [], linkCards: [], mediaStatus: 'unknown' as const, read: false, favorite: false, tagIds: [] };
    });
    return { collections: { likes: { accounts: [{ id: 'likes', handle: '' }], posts, tags: [] } }, source: 'likes', duplicates: view.duplicates };
  } catch (e) { if (e instanceof ViewerInputError) fail(e.code); throw e; }
}
function mergeCollection(current: LocalCollection, incoming: LocalCollection): { collection: LocalCollection; added: number; existing: number } {
  const accounts = current.accounts.map(a => ({ ...a })); const accountMap = new Map<string, string>();
  for (const a of incoming.accounts) {
    const old = accounts.find(c => c.handle.toLowerCase() === a.handle.toLowerCase());
    if (old) accountMap.set(a.id, old.id);
    else { const accountId = accounts.some(c => c.id === a.id) ? crypto.randomUUID() : a.id; accounts.push({ id: accountId, handle: a.handle }); accountMap.set(a.id, accountId); }
  }
  const tags = current.tags.map(t => ({ ...t })); const tagMap = new Map<string, string>();
  for (const t of [...orderedMarks(incoming.tags), ...incoming.tags.filter(t => !t.mark)]) {
    const accountId = accountMap.get(t.accountId)!; const old = tags.find(c => c.accountId === accountId && c.name === t.name);
    const marks = orderedMarks(tags.filter(c => c.accountId === accountId));
    if (t.mark && !old?.mark && marks.length >= MAX_MARKS) fail('marks');
    if (old) { tagMap.set(t.id, old.id); if (!old.mark && t.mark) Object.assign(old, { mark: t.mark, markOrder: marks.length }); }
    else { const tagId = tags.some(c => c.id === t.id) ? crypto.randomUUID() : t.id;
      tags.push({ ...t, id: tagId, accountId, ...(t.mark ? { markOrder: marks.length } : {}) }); tagMap.set(t.id, tagId); }
  }
  const posts = current.posts.slice(); const indices = new Map(posts.map((p, i) => [key(p), i])); let added = 0; let existing = 0;
  for (const p of incoming.posts) {
    const accountId = accountMap.get(p.accountId)!; const k = `${accountId}:${p.postId}`; const index = indices.get(k); const tagIds = p.tagIds.map(t => tagMap.get(t)!);
    if (index === undefined) { indices.set(k, posts.length); posts.push({ ...p, accountId, tagIds }); added++; }
    else {
      const old = posts[index]!; const combined = [...new Set([...old.tagIds, ...tagIds])]; if (combined.length > MAX_POST_TAGS) fail('tags');
      const cards = new Map((old.linkCards ?? []).map(c => [c.url, c])); for (const card of p.linkCards ?? []) if (cards.size < 4 && !cards.has(card.url)) cards.set(card.url, card);
      const quote = mergeQuote(old.quote, p.quote);
      posts[index] = { ...old, text: p.text.length > old.text.length ? p.text : old.text, authorHandle: old.authorHandle || p.authorHandle, authorName: old.authorName || p.authorName,
        postedAt: old.postedAt ?? p.postedAt, dateSource: old.postedAt ? old.dateSource : p.dateSource, partial: old.partial && p.partial,
        media: mergeMedia(old.media, p.media), linkCards: [...cards.values()], mediaStatus: old.mediaStatus === 'observed' || p.mediaStatus === 'observed' ? 'observed' : 'unknown',
        ...(quote ? { quote } : {}),
        lastImportedAt: Date.parse(old.lastImportedAt) > Date.parse(p.lastImportedAt) ? old.lastImportedAt : p.lastImportedAt, tagIds: combined };
      existing++;
    }
  }
  // Preserve local relative order and append incoming marks in their saved order.
  for (const a of accounts) orderedMarks(tags.filter(t => t.accountId === a.id)).forEach((t, i) => { t.markOrder = i; });
  return { collection: { accounts, tags, posts }, added, existing };
}
export function verifyLocalImportParts(inputs: readonly LocalImport[]) {
  try { verifyBackupParts(inputs.flatMap(input => input.backup ? [input.backup] : [])); }
  catch { fail('parts'); }
}
export function mergeLocalImport(lib: LocalLibrary, input: LocalImport) {
  let added = 0; let existing = input.duplicates; const libraries = { ...lib.libraries };
  for (const source of ['bookmarks', 'likes'] as const) if (input.collections[source]) {
    const result = mergeCollection(libraries[source], input.collections[source]!); libraries[source] = result.collection; added += result.added; existing += result.existing;
  }
  const library = validateLocalLibrary({ ...lib, libraries, updatedAt: new Date().toISOString() });
  serializeLocalLibrary(library); return { library, added, existing, source: input.source };
}
// All work is on new objects. The caller commits only after the entire batch succeeds.
export function mergeLocalImports(lib: LocalLibrary, inputs: readonly LocalImport[]) {
  verifyLocalImportParts(inputs);
  let library = lib; let added = 0; let existing = 0; let source: LocalSource = 'bookmarks';
  for (const input of inputs) {
    const result = mergeLocalImport(library, input);
    library = result.library; added += result.added; existing += result.existing; source = result.source;
  }
  return { library, added, existing, source };
}
export function editLocalCollection(lib: LocalLibrary, source: LocalSource, edit: (c: LocalCollection) => LocalCollection): LocalLibrary {
  return { ...lib, libraries: { ...lib.libraries, [source]: edit(lib.libraries[source]) }, updatedAt: new Date().toISOString() };
}
export function setLocalRead(lib: LocalLibrary, source: LocalSource, postKey: string, read: boolean): LocalLibrary {
  return editLocalCollection(lib, source, c => ({ ...c, posts: c.posts.map(p => key(p) === postKey ? { ...p, read } : p) }));
}
export function toggleLocalMark(lib: LocalLibrary, source: LocalSource, postKey: string, tagId: string): LocalLibrary {
  return editLocalCollection(lib, source, c => {
    const p = c.posts.find(p => key(p) === postKey); const tag = c.tags.find(t => t.id === tagId);
    if (!p || !tag?.mark || tag.accountId !== p.accountId) fail('tags');
    const tagIds = p.tagIds.includes(tagId) ? p.tagIds.filter(t => t !== tagId) : [...p.tagIds, tagId]; if (tagIds.length > MAX_POST_TAGS) fail('tags');
    return { ...c, posts: c.posts.map(item => item === p ? { ...p, tagIds } : item) };
  });
}
export function saveLocalMark(lib: LocalLibrary, source: LocalSource, accountId: string, name: string, mark: MarkSymbol, editingId?: string): LocalLibrary {
  name = name.trim(); if (!name || name.length > 100 || !isMarkSymbol(mark)) fail('marks');
  return editLocalCollection(lib, source, c => {
    if (!c.accounts.some(a => a.id === accountId)) fail('marks');
    const old = editingId ? c.tags.find(t => t.id === editingId && t.accountId === accountId) : c.tags.find(t => t.name === name && t.accountId === accountId);
    if (!old && c.tags.length >= 10000) fail('tags');
    if (editingId && !old) fail('marks');
    if (c.tags.some(t => t.accountId === accountId && t.name === name && t.id !== old?.id)) fail('marks');
    const marks = orderedMarks(c.tags.filter(t => t.accountId === accountId)); if (!old?.mark && marks.length >= MAX_MARKS) fail('marks');
    const t: Tag = { id: old?.id ?? crypto.randomUUID(), accountId, name, mark, markOrder: old?.mark ? marks.findIndex(t => t.id === old.id) : marks.length };
    return { ...c, tags: [...c.tags.filter(item => item.id !== t.id), t] };
  });
}
export function moveLocalMark(lib: LocalLibrary, source: LocalSource, accountId: string, tagId: string, direction: -1 | 1): LocalLibrary {
  return editLocalCollection(lib, source, c => {
    const marks = orderedMarks(c.tags.filter(t => t.accountId === accountId)); const i = marks.findIndex(t => t.id === tagId); if (i < 0) fail('marks');
    const next = i + direction; if (next < 0 || next >= marks.length) return c;
    [marks[i], marks[next]] = [marks[next]!, marks[i]!]; const orders = new Map(marks.map((t, i) => [t.id, i]));
    return { ...c, tags: c.tags.map(t => orders.has(t.id) ? { ...t, markOrder: orders.get(t.id)! } : t) };
  });
}
export function demoteLocalMark(lib: LocalLibrary, source: LocalSource, tagId: string): LocalLibrary {
  return editLocalCollection(lib, source, c => ({ ...c, tags: c.tags.map(t => { if (t.id !== tagId) return t; const { mark: _m, markOrder: _o, ...tag } = t; return tag; }) }));
}
export function setLocalTags(lib: LocalLibrary, source: LocalSource, postKey: string, names: string[]): LocalLibrary {
  names = [...new Set(names.map(n => n.trim()).filter(Boolean))]; if (names.length > MAX_POST_TAGS || names.some(n => n.length > 100)) fail('tags');
  return editLocalCollection(lib, source, c => {
    const p = c.posts.find(p => key(p) === postKey); if (!p) fail('tags'); const tags = c.tags.slice();
    const tagIds = names.map(name => { let t = tags.find(t => t.accountId === p.accountId && t.name === name);
      if (!t) { t = { id: crypto.randomUUID(), accountId: p.accountId, name }; tags.push(t); } return t.id; });
    if (tags.length > 10000) fail('tags'); return { ...c, tags, posts: c.posts.map(item => item === p ? { ...p, tagIds } : item) };
  });
}
export function localBackup(lib: LocalLibrary, source?: LocalSource, markId?: string): LocalLibrary {
  if (markId && !source) fail('empty');
  const result = emptyLocalLibrary(); result.settings = { ...lib.settings }; result.updatedAt = new Date().toISOString();
  for (const s of ['bookmarks', 'likes'] as const) {
    if (source && source !== s) continue;
    const c = lib.libraries[s]; const mark = markId ? c.tags.find(t => t.id === markId && t.mark) : undefined; if (markId && !mark) fail('empty');
    const posts = mark ? c.posts.filter(p => p.tagIds.includes(mark.id)) : c.posts;
    if (markId && !posts.length) fail('empty');
    const ids = new Set(posts.flatMap(p => p.tagIds)); const accounts = new Set(posts.map(p => p.accountId));
    result.libraries[s] = { posts, tags: mark ? c.tags.filter(t => ids.has(t.id)) : c.tags, accounts: mark ? c.accounts.filter(a => accounts.has(a.id)) : c.accounts };
  }
  return validateLocalLibrary(result);
}
export function localBookmarksBackup(lib: LocalLibrary, markId?: string): Backup {
  const c = localBackup(lib, 'bookmarks', markId).libraries.bookmarks;
  return validateBackupSnapshot({ format: 'x-bookmark-library', formatVersion: 2, exportedAt: new Date().toISOString(), accounts: c.accounts, tags: c.tags,
    posts: c.posts.map(({ read: _r, favorite: _f, tagIds: _t, mediaStatus: _m, dateSource: _d, ...p }) => p),
    userStates: c.posts.map(p => ({ accountId: p.accountId, postId: p.postId, read: p.read, favorite: p.favorite })),
    postTags: c.posts.flatMap(p => p.tagIds.map(tagId => ({ accountId: p.accountId, postId: p.postId, tagId }))) }) as Backup;
}
