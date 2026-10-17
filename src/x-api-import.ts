import { dateFromPostId, emptyLocalLibrary, LOCAL_MAX_POSTS, LocalDataError, mergeLocalImport, type LocalImport, type LocalPost, type LocalSource } from './local-data';
import { isMediaUrl, validHandle, type LinkCard, type QuotedPost } from './model';
import { appendMissingLinks, webUrl } from './text';
import { VIEWER_MAX_BYTES, VIEWER_MAX_POSTS } from './viewer-data';

type ObjectValue = Record<string, unknown>;
interface ApiPost {
  id: string; text: string; authorId: string; username: string; createdAt: string | null;
  mediaKeys: string[] | null; urls: { url: string; title: string; image: string }[]; quoteId: string | null;
}
interface ApiUser { id: string; username: string; name: string }
interface ApiMedia { key: string; kind: 'image' | 'video'; url: string }
export interface XApiPage { posts: ApiPost[]; users: ApiUser[]; media: ApiMedia[]; included: ApiPost[]; errors: number; more: boolean }
export interface XApiWarnings { authors: number; media: number; quotes: number; errors: number; more: boolean }
const fail = (): never => { throw new LocalDataError('apiFormat'); };
const object = (v: unknown): ObjectValue | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as ObjectValue : null;
const list = (v: unknown, limit = VIEWER_MAX_POSTS): unknown[] => v === undefined ? [] : Array.isArray(v) && v.length <= limit ? v : fail();
const postId = (v: unknown): string => typeof v === 'string' && /^\d{1,30}$/.test(v) ? v : fail();
const string = (v: unknown, max: number, fallback = ''): string => v === undefined ? fallback : typeof v === 'string' && v.length <= max ? v : fail();
function parsePost(raw: unknown): ApiPost {
  const p = object(raw); if (!p) return fail();
  const note = object(p.note_tweet ?? p.note_post); const entities = object(note?.entities ?? p.entities);
  const urls = list(entities?.urls, 100).map(raw => {
    const u = object(raw); if (!u) return fail();
    const images = list(u.images, 8).map(object);
    return { url: webUrl(u.unwound_url) ?? webUrl(u.expanded_url) ?? webUrl(u.url) ?? '', title: string(u.title, 300),
      image: images.find(img => isMediaUrl(img?.url))?.url as string ?? '' };
  });
  const attachments = p.attachments === undefined ? null : object(p.attachments); if (p.attachments !== undefined && !attachments) return fail();
  const references = list(p.referenced_tweets ?? p.referenced_posts, 8).map(raw => { const r = object(raw); if (!r) return fail(); return { type: r.type, id: postId(r.id) }; });
  const createdAt = p.created_at === undefined ? null : string(p.created_at, 40);
  if (createdAt !== null && !Number.isFinite(Date.parse(createdAt))) return fail();
  const username = string(p.username, 15); if (username && !validHandle(username)) return fail();
  return { id: postId(p.id), text: string(note?.text ?? p.text, 50000), authorId: p.author_id === undefined ? '' : postId(p.author_id), username,
    createdAt, mediaKeys: attachments?.media_keys === undefined ? null : list(attachments.media_keys, 8).map(k => string(k, 100)), urls,
    quoteId: references.find(r => r.type === 'quoted')?.id ?? null };
}

/** Detect raw API v2 list responses only. Backups and like.js keep their existing parser. */
export function parseXApiPage(text: string, raw?: unknown): XApiPage | null {
  if (raw === undefined) try { raw = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { return null; }
  const v = object(raw);
  if (!v || 'format' in v || !('data' in v || 'errors' in v || 'meta' in v)) return null;
  if (text.length > VIEWER_MAX_BYTES || new TextEncoder().encode(text).length > VIEWER_MAX_BYTES) throw new LocalDataError('size');
  const meta = v.meta === undefined ? null : object(v.meta);
  const errors = list(v.errors).length;
  // An errors-only response is not a successfully retrieved empty library.
  if (v.data === undefined && (errors || meta?.result_count !== 0)) return fail();
  const posts = list(v.data).map(parsePost);
  if (!posts.length && errors) return fail();
  const includes = v.includes === undefined ? null : object(v.includes); if (v.includes !== undefined && !includes) return fail();
  const users = list(includes?.users).map(raw => {
    const u = object(raw); if (!u || !validHandle(u.username)) return fail();
    return { id: postId(u.id), username: u.username, name: string(u.name, 200) };
  });
  const media = list(includes?.media).flatMap(raw => {
    const m = object(raw); if (!m) return fail();
    const key = string(m.media_key, 100); const kind = m.type === 'photo' ? 'image' as const : m.type === 'video' || m.type === 'animated_gif' ? 'video' as const : null;
    const url = kind === 'image' ? m.url : m.preview_image_url;
    // Never turn arbitrary file URLs or video variants into image requests.
    return kind && isMediaUrl(url) ? [{ key, kind, url: url as string }] : [];
  });
  return { posts, users, media, included: list(includes?.tweets ?? includes?.posts).map(parsePost), errors, more: typeof meta?.next_token === 'string' && !!meta.next_token };
}

export function convertXApiPages(pages: readonly XApiPage[], source: LocalSource, account: { id: string; handle: string }) {
  if (!(validHandle(account.handle) || source === 'likes' && account.id === 'likes' && account.handle === '')) throw new LocalDataError('records');
  const ids = new Set<string>();
  for (const page of pages) for (const post of page.posts) { ids.add(post.id); if (ids.size > LOCAL_MAX_POSTS) throw new LocalDataError('records'); }
  const users = new Map(pages.flatMap(p => p.users).map(u => [u.id, u]));
  const media = new Map(pages.flatMap(p => p.media).map(m => [m.key, m]));
  const included = new Map(pages.flatMap(p => [...p.included, ...p.posts]).map(p => [p.id, p]));
  const warnings: XApiWarnings = { authors: 0, media: 0, quotes: 0, errors: pages.reduce((n, p) => n + p.errors, 0), more: pages.some(p => p.more) };
  const now = new Date().toISOString();
  const details = (p: ApiPost) => {
    const user = users.get(p.authorId); const authorHandle = user?.username ?? p.username;
    const resolved = (p.mediaKeys ?? []).map(k => media.get(k)).filter(m => m !== undefined);
    const knownMedia = p.mediaKeys !== null && resolved.length === p.mediaKeys.length;
    const linkCards: LinkCard[] = []; const cardUrls = new Set<string>();
    for (const u of p.urls) if (u.url && u.image && linkCards.length < 4 && !cardUrls.has(u.url)) { cardUrls.add(u.url); linkCards.push({ url: u.url, title: u.title, imageUrl: u.image }); }
    return { authorHandle, authorName: user?.name ?? '', text: appendMissingLinks(p.text, p.urls.map(u => u.url)), postedAt: p.createdAt ?? dateFromPostId(p.id),
      media: resolved.map(m => ({ kind: m.kind, url: m.url })), linkCards, knownMedia };
  };
  const posts = pages.flatMap(page => page.posts).map(p => {
    const d = details(p); if (!d.authorHandle) { warnings.authors++; if (source === 'bookmarks') throw new LocalDataError('apiAuthor'); }
    if (!d.knownMedia) warnings.media++;
    let quote: QuotedPost | undefined;
    if (p.quoteId) {
      const q = included.get(p.quoteId);
      if (q) { const qd = details(q); quote = { postId: qd.authorHandle ? q.id : null, authorHandle: qd.authorHandle, authorName: qd.authorName,
        text: qd.text, postedAt: qd.postedAt, media: qd.media, linkCards: qd.linkCards, url: qd.authorHandle ? `https://x.com/${qd.authorHandle}/status/${q.id}` : null }; }
      else warnings.quotes++;
    }
    return { postId: p.id, accountId: account.id, authorHandle: d.authorHandle, authorName: d.authorName, text: d.text,
      url: d.authorHandle ? `https://x.com/${d.authorHandle}/status/${p.id}` : `https://x.com/i/status/${p.id}`,
      postedAt: d.postedAt, dateSource: d.postedAt ? p.createdAt ? 'provided' : 'id' : 'unknown',
      observedAt: now, firstImportedAt: now, lastImportedAt: now, partial: !d.authorHandle || !d.knownMedia || !p.createdAt || !!p.quoteId && !quote,
      media: d.media, linkCards: d.linkCards, ...(quote ? { quote } : {}), mediaStatus: d.knownMedia || d.media.length ? 'observed' : 'unknown',
      read: false, favorite: false, tagIds: [] } satisfies LocalPost;
  });
  // Reuse the normal merge to deduplicate overlapping API pages and validate the projection.
  const merged = mergeLocalImport(emptyLocalLibrary(), { collections: { [source]: { accounts: [account], posts, tags: [] } }, source, duplicates: 0 });
  const input: LocalImport = { collections: { [source]: merged.library.libraries[source] }, source, duplicates: merged.existing };
  return { input, warnings };
}
