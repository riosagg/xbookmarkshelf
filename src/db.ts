import Dexie, { type Table } from 'dexie';
import { type Account, type ImportOptions, type ImportRun, type ObservedPost, type Post, type StopReason, type UserState, type Tag, validatePosts, mediaKind, mediaKey, mergeMedia, mergeQuote } from './model';
import { appendMissingLinks, authorMatcher, textLinks } from './text';
import { type LibrarySource } from './model';
import { comparePostedTimes, postedTime, type PostDateOrder } from './post-order';

export class LibraryDB extends Dexie {
  posts!: Table<Post, [string, string]>;
  userStates!: Table<UserState, [string, string]>;
  importRuns!: Table<ImportRun, string>;
  settings!: Table<{ key: string; value: unknown }, string>;
  tags!: Table<Tag, string>;
  postTags!: Table<{ accountId: string; postId: string; tagId: string }, [string, string, string]>;
  media!: Table<{ accountId: string; postId: string; index: number; kind: string; url: string }, [string, string, number]>;
  savedFilters!: Table<{ id: string; name: string; value: unknown }, string>;
  constructor(name = 'x-bookmark-library', readonly source: LibrarySource = 'bookmarks') {
    super(name);
    this.version(1).stores({
      posts: '[accountId+postId], accountId, firstImportedAt, [accountId+firstImportedAt]',
      userStates: '[accountId+postId], accountId', importRuns: 'id, tabId, state, startedAt', settings: 'key',
      tags: 'id, accountId, [accountId+name]', postTags: '[accountId+postId+tagId], [accountId+postId], tagId',
      media: '[accountId+postId+index], [accountId+postId]', savedFilters: 'id',
    });
  }
}
export const db = new LibraryDB();
export const likesDB = new LibraryDB('xbookmarkshelf-likes', 'likes');
export const libraryStores = [db, likesDB] as const;
export function storeForSource(source: LibrarySource): LibraryDB { return source === 'likes' ? likesDB : db; }
export async function accountFor(handle: string, store = db): Promise<Account> {
  return store.transaction('rw', store.settings, async () => {
    const accounts = ((await store.settings.get('accounts'))?.value ?? []) as Account[];
    const known = accounts.find(a => a.handle.toLowerCase() === handle.toLowerCase());
    if (known) return known;
    const account = { id: crypto.randomUUID(), handle: handle.toLowerCase() };
    await store.settings.put({ key: 'accounts', value: [...accounts, account] });
    return account;
  });
}
export function newRun(account: Account, tabId: number, documentId: string, options: ImportOptions, source: LibrarySource = 'bookmarks'): ImportRun {
  const now = new Date().toISOString();
  return { ...options, source, id: crypto.randomUUID(), accountId: account.id, handle: account.handle, tabId, documentId,
    state: 'running', reason: null, startedAt: now, updatedAt: now, observed: 0, added: 0, existing: 0,
    consecutiveKnown: 0, nextSequence: 0, lastFingerprint: '', lastPostId: null };
}
export async function finishRun(id: string, reason: StopReason, store = db): Promise<ImportRun> {
  return store.transaction('rw', store.importRuns, async () => {
    const run = await store.importRuns.get(id);
    if (!run) throw new Error('取り込みが見つかりません');
    if (run.state !== 'running') return run;
    run.state = reason === 'user_pause' ? 'paused' : 'stopped';
    run.reason = reason; run.updatedAt = new Date().toISOString();
    await store.importRuns.put(run); return run;
  });
}
export async function commitBatch(id: string, sequence: number, input: unknown, store = db): Promise<ImportRun> {
  const posts = validatePosts(input);
  const data = new TextEncoder().encode(JSON.stringify(posts));
  const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), n => n.toString(16).padStart(2, '0')).join('');
  return store.transaction('rw', store.posts, store.media, store.importRuns, async () => {
    const run = await store.importRuns.get(id);
    if (!run) throw new Error('取り込みが見つかりません');
    if (sequence === run.nextSequence - 1 && fingerprint === run.lastFingerprint) return run;
    if (run.state !== 'running') return run;
    if (!Number.isInteger(sequence) || sequence !== run.nextSequence) throw new Error('バッチ順序が不正です');
    const now = new Date().toISOString();
    for (const p of posts) {
      if (run.observed >= run.maxPosts) break;
      const key: [string, string] = [run.accountId, p.postId];
      const old = await store.posts.get(key);
      const merged = mergePost(old, p, run.accountId, now);
      await store.posts.put(merged);
      await store.media.where('[accountId+postId]').equals(key).delete();
      if (merged.media.length) await store.media.bulkPut(merged.media.map((m, index) => ({ ...m, accountId: run.accountId, postId: p.postId, index })));
      run.observed++; run.lastPostId = p.postId;
      if (old) { run.existing++; run.consecutiveKnown++; } else { run.added++; run.consecutiveKnown = 0; }
      if (run.mode === 'delta' && run.consecutiveKnown >= 30) { run.state = 'stopped'; run.reason = 'known_threshold'; break; }
    }
    run.nextSequence++; run.lastFingerprint = fingerprint; run.updatedAt = now;
    if (run.state === 'running' && run.observed >= run.maxPosts) { run.state = 'stopped'; run.reason = 'run_limit'; }
    await store.importRuns.put(run);
    return run;
  });
}
export function mergePost(old: Post | undefined, p: ObservedPost, accountId: string, now: string): Post {
  // Observed DOM text may be truncated. Keep the more complete saved observation.
  const retainText = old && old.text.length > p.text.length;
  const media = mergeMedia(old?.media ?? [], p.media);
  const text = appendMissingLinks(retainText ? old.text : p.text, textLinks(retainText ? p.text : old?.text ?? '').map(link => link.url));
  const cards = new Map((old?.linkCards ?? []).map(card => [card.url, card]));
  for (const card of p.linkCards ?? []) {
    const prior = cards.get(card.url);
    // A late/missing card does not erase a saved reference or its readable title.
    cards.set(card.url, { ...card, title: card.title || prior?.title || '' });
  }
  const linkCards = [...cards.values()].slice(0, 4);
  const cardImages = new Set([...(old?.linkCards ?? []), ...(p.linkCards ?? [])].map(card => mediaKey(card.imageUrl)));
  const quote = mergeQuote(old?.quote, p.quote);
  return { ...p, accountId, text, partial: retainText ? old.partial : p.partial,
    postedAt: p.postedAt ?? old?.postedAt ?? null, media: media.filter(m => !cardImages.has(mediaKey(m.url))),
    ...(linkCards.length ? { linkCards } : {}),
    ...(quote ? { quote } : {}),
    firstImportedAt: old?.firstImportedAt ?? now, lastImportedAt: now };
}
export async function markPostRead(accountId: string, postId: string, store = db) {
  return store.transaction('rw', store.posts, store.userStates, async () => {
    if (!await store.posts.get([accountId, postId])) throw new Error('投稿が見つかりません');
    const state = await store.userStates.get([accountId, postId]) ?? { accountId, postId, read: false, favorite: false };
    const next = { ...state, read: true }; await store.userStates.put(next); return next;
  });
}
export async function togglePostRead(accountId: string, postId: string, store = db) {
  return store.transaction('rw', store.posts, store.userStates, async () => {
    if (!await store.posts.get([accountId, postId])) throw new Error('投稿が見つかりません');
    const state = await store.userStates.get([accountId, postId]) ?? { accountId, postId, read: false, favorite: false };
    const next = { ...state, read: !state.read }; await store.userStates.put(next); return next;
  });
}
export interface PostFilters { favorite?: boolean; read?: boolean; tagId?: string; oldestFirst?: boolean; postedOrder?: PostDateOrder; author?: string; media?: 'with' | 'without' | 'image' | 'video'; mark?: 'with' | 'without'; links?: boolean; postedFrom?: string; postedBefore?: string }
const postKey = (accountId: string, postId: string) => `${accountId}:${postId}`;
export async function pagePosts(accountId: string, query: string, page: number, options: PostFilters = {}, store = db) {
  return windowPosts(accountId, query, Math.max(0, page) * 50, 50, options, store);
}
export async function windowPosts(accountId: string, query: string, offset: number, limit: number, options: PostFilters = {}, store = db) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Invalid post window');
  return store.transaction('r', [store.posts, store.userStates, store.postTags, store.tags], async () => {
    const needle = query.normalize('NFKC').toLocaleLowerCase();
    const matchesAuthor = authorMatcher(options.author ?? '');
    const states = options.favorite || options.read !== undefined
      ? await (accountId ? store.userStates.where('accountId').equals(accountId) : store.userStates.toCollection()).toArray() : [];
    const read = new Set(states.filter(s => s.read).map(s => postKey(s.accountId, s.postId)));
    const favorite = new Set(states.filter(s => s.favorite).map(s => postKey(s.accountId, s.postId)));
    const tagged = options.tagId ? new Set((await store.postTags.where('tagId').equals(options.tagId).toArray()).map(t => postKey(t.accountId, t.postId))) : null;
    const markedTags = options.mark ? new Set((await (accountId ? store.tags.where('accountId').equals(accountId) : store.tags.toCollection()).toArray()).filter(t => t.mark).map(t => t.id)) : null;
    const marked = markedTags ? new Set((await store.postTags.filter(t => markedTags.has(t.tagId)).toArray()).map(t => postKey(t.accountId, t.postId))) : null;
    const base = () => accountId ? store.posts.where('[accountId+firstImportedAt]').between([accountId, Dexie.minKey], [accountId, Dexie.maxKey]) : store.posts.orderBy('firstImportedAt');
    const matches = (p: Post) => {
        const key = postKey(p.accountId, p.postId);
        const posted = p.postedAt ? Date.parse(p.postedAt) : NaN;
        const media = [...p.media, ...(p.quote?.media ?? [])];
        const mediaMatches = !options.media || (options.media === 'with' ? media.length > 0 : options.media === 'without' ? !media.length : media.some(m => mediaKind(m.kind, m.url) === options.media));
        return (!options.favorite || favorite.has(key)) && (options.read === undefined || read.has(key) === options.read) &&
          (!tagged || tagged.has(key)) && (!marked || marked.has(key) === (options.mark === 'with')) && mediaMatches &&
          matchesAuthor(p) &&
          (options.links === undefined || (textLinks(p.text + '\n' + (p.quote?.text ?? '')).length > 0) === options.links) &&
          (!options.postedFrom || posted >= Date.parse(options.postedFrom)) && (!options.postedBefore || posted < Date.parse(options.postedBefore)) &&
          (!needle || `${p.text} ${p.quote?.text ?? ''} ${p.quote?.authorName ?? ''} ${p.quote?.authorHandle ?? ''} ${p.authorName} ${p.authorHandle}`.normalize('NFKC').toLocaleLowerCase().includes(needle));
    };
    if (options.postedOrder) {
      // Keep only keys and timestamps while scanning. Fetch full posts for the window only.
      const index: { key: [string, string]; time: number | null }[] = [];
      await base().reverse().filter(matches).each(p => { index.push({ key: [p.accountId, p.postId], time: postedTime(p.postedAt) }); });
      index.sort((a, b) => comparePostedTimes(a.time, b.time, options.postedOrder!));
      const rows = await store.posts.bulkGet(index.slice(offset, offset + limit).map(item => item.key));
      return { total: index.length, rows: rows.filter((post): post is Post => post !== undefined) };
    }
    const collection = () => {
      const rows = base();
      return (options.oldestFirst ? rows : rows.reverse()).filter(matches);
    };
    return { total: await collection().count(), rows: await collection().offset(offset).limit(limit).toArray() };
  });
}
export async function libraryMetadata(accountId: string, store = db) {
  return store.transaction('r', [store.posts, store.userStates, store.tags, store.postTags], async () => {
    const total = await (accountId ? store.posts.where('accountId').equals(accountId) : store.posts.toCollection()).count();
    const states = await (accountId ? store.userStates.where('accountId').equals(accountId) : store.userStates.toCollection()).toArray();
    const tags = await (accountId ? store.tags.where('accountId').equals(accountId) : store.tags.toCollection()).toArray();
    const counts = new Map<string, number>();
    const markedTags = new Set(tags.filter(t => t.mark).map(t => t.id));
    const marked = new Set<string>();
    await store.postTags.filter(t => !accountId || t.accountId === accountId).each(t => {
      counts.set(t.tagId, (counts.get(t.tagId) ?? 0) + 1);
      if (markedTags.has(t.tagId)) marked.add(postKey(t.accountId, t.postId));
    });
    const unmarked = await (accountId ? store.posts.where('accountId').equals(accountId) : store.posts.toCollection())
      .filter(p => !marked.has(postKey(p.accountId, p.postId))).count();
    return { total, unmarked, unread: Math.max(0, total - states.filter(s => s.read).length), favorites: states.filter(s => s.favorite).length,
      tags: tags.sort((a, b) => a.name.localeCompare(b.name)).map(t => ({ ...t, count: counts.get(t.id) ?? 0 })) };
  });
}
