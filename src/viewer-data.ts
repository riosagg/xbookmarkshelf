import { validateBackup, validateLikesBackup } from './backup-format';
import { type LinkCard, type QuotedPost, type Tag, orderedMarks } from './model';
import { authorMatcher, textLinks } from './text';
import { sortByPostedDate, type PostDateOrder } from './post-order';

export const VIEWER_MAX_BYTES = 20 * 1024 * 1024;
export const VIEWER_MAX_POSTS = 50000;
export const VIEWER_PAGE_SIZE = 50;
export type ViewerError = 'size' | 'format' | 'records';
export class ViewerInputError extends Error {
  constructor(readonly code: ViewerError) { super(code); }
}
export interface ViewerPost {
  key: string; postId: string; accountId: string; authorHandle: string; authorName: string;
  text: string; url: string; postedAt: string | null;
  quote?: QuotedPost;
  media: { kind: 'image' | 'video'; url: string }[]; linkCards: LinkCard[];
  tags: Tag[]; read: boolean | null; search: string; hasLinks: boolean;
  mediaStatus?: 'unknown' | 'observed'; dateSource?: 'unknown' | 'provided' | 'id';
}
export interface ViewerData {
  kind: 'likes' | 'backup'; source?: 'bookmarks' | 'likes'; posts: ViewerPost[];
  accounts: { id: string; handle: string }[]; tags: Tag[]; duplicates: number;
}
export const normalizeSearch = (text: string) => text.normalize('NFKC').toLowerCase();
function indexed(post: Omit<ViewerPost, 'search' | 'hasLinks'>): ViewerPost {
  return { ...post, search: normalizeSearch([post.text, post.quote?.text ?? '', post.quote?.authorHandle ?? '', post.quote?.authorName ?? '', post.authorHandle, post.authorName, post.url, post.postId, ...post.tags.map(t => t.name)].join('\n')),
    hasLinks: textLinks(post.text + '\n' + (post.quote?.text ?? '')).length > 0 };
}
function likes(value: unknown): ViewerData {
  if (!Array.isArray(value) || value.length > VIEWER_MAX_POSTS) throw new ViewerInputError('records');
  const seen = new Set<string>(); const posts: ViewerPost[] = []; let duplicates = 0;
  for (const entry of value) {
    const item = entry?.like;
    if (!item || typeof item.tweetId !== 'string' || !/^\d{1,30}$/.test(item.tweetId) ||
        (item.fullText !== undefined && (typeof item.fullText !== 'string' || item.fullText.length > 50000)) ||
        typeof item.expandedUrl !== 'string' || item.expandedUrl.length > 2048 || /[\u0000-\u0020\u007f]/.test(item.expandedUrl)) throw new ViewerInputError('records');
    let url: URL;
    try { url = new URL(item.expandedUrl); } catch { throw new ViewerInputError('records'); }
    const match = /^\/(?:([a-zA-Z0-9_]{1,15})\/status|i\/web\/status|i\/status)\/(\d{1,30})\/?$/.exec(url.pathname);
    if (!['https://x.com', 'https://twitter.com'].includes(url.origin) || url.username || url.password || !match || match[2] !== item.tweetId) throw new ViewerInputError('records');
    if (seen.has(item.tweetId)) { duplicates++; continue; }
    seen.add(item.tweetId);
    posts.push(indexed({ key: `likes:${item.tweetId}`, postId: item.tweetId, accountId: '', authorHandle: /^\/i\/status\//.test(url.pathname) ? '' : match[1] ?? '', authorName: '',
      text: item.fullText ?? '', url: url.href, postedAt: null, media: [], linkCards: [], tags: [], read: null }));
  }
  return { kind: 'likes', posts, accounts: [], tags: [], duplicates };
}

// The archive wrapper is recognized as text. Its JSON RHS is never executed.
export function parseViewerText(text: string): ViewerData {
  if (text.length > VIEWER_MAX_BYTES || new TextEncoder().encode(text).byteLength > VIEWER_MAX_BYTES) throw new ViewerInputError('size');
  let input = text.replace(/^\uFEFF/, '').trim();
  const prefix = /^window\.YTD\.like\.part\d{1,6}\s*=\s*/.exec(input);
  if (prefix) { input = input.slice(prefix[0].length).trimEnd(); if (input.endsWith(';')) input = input.slice(0, -1); }
  let raw: unknown;
  try { raw = JSON.parse(input); } catch { throw new ViewerInputError('format'); }
  if (prefix || Array.isArray(raw)) return likes(raw);
  try {
    const source = (raw as { format?: unknown })?.format === 'xbookmarkshelf-likes' ? 'likes' : 'bookmarks';
    const backup = source === 'likes' ? validateLikesBackup(raw) : validateBackup(raw);
    const states = new Map(backup.userStates.map(s => [`${s.accountId}:${s.postId}`, s.read]));
    const tags = new Map(backup.tags.map(t => [t.id, t]));
    const assigned = new Map<string, Tag[]>();
    for (const row of backup.postTags) {
      const key = `${row.accountId}:${row.postId}`; const list = assigned.get(key) ?? [];
      list.push(tags.get(row.tagId)!); assigned.set(key, list);
    }
    return { kind: 'backup', source, accounts: backup.accounts, tags: [...orderedMarks(backup.tags), ...backup.tags.filter(t => !t.mark)], duplicates: 0,
      posts: backup.posts.map(p => {
        const key = `${p.accountId}:${p.postId}`;
        return indexed({ key, postId: p.postId, accountId: p.accountId, authorHandle: p.authorHandle, authorName: p.authorName,
          text: p.text, url: p.url, postedAt: p.postedAt, media: p.media, linkCards: p.linkCards ?? [], ...(p.quote ? { quote: p.quote } : {}), tags: assigned.get(key) ?? [], read: states.get(key) ?? false });
      }) };
  } catch { throw new ViewerInputError('records'); }
}

export interface ViewerFilters {
  query: string; author: string; account: string; tag: string;
  read: '' | 'read' | 'unread'; media: '' | 'with' | 'without' | 'image' | 'video' | 'unknown'; links: '' | 'with' | 'without'; reverse: boolean; postedOrder?: PostDateOrder;
}
export const EMPTY_VIEWER_FILTERS: ViewerFilters = { query: '', author: '', account: '', tag: '', read: '', media: '', links: '', reverse: false };
export function filterViewerPosts(posts: readonly ViewerPost[], filters: ViewerFilters): ViewerPost[] {
  const words = normalizeSearch(filters.query.trim()).split(/\s+/u).filter(Boolean);
  const matchesAuthor = authorMatcher(filters.author);
  const result = posts.filter(p => words.every(word => p.search.includes(word)) &&
    matchesAuthor(p) &&
    (!filters.account || p.accountId === filters.account) &&
    (!filters.tag || (filters.tag === ':without' ? !p.tags.some(t => t.mark) : filters.tag === ':with' ? p.tags.some(t => t.mark) : p.tags.some(t => t.id === filters.tag))) &&
    (!filters.read || (filters.read === 'read' ? p.read === true : p.read === false)) &&
    (!filters.media || (filters.media === 'unknown' ? p.mediaStatus === 'unknown' : p.mediaStatus !== 'unknown' && (filters.media === 'with' ? (p.media.length + (p.quote?.media.length ?? 0)) > 0 : filters.media === 'without' ? (p.media.length + (p.quote?.media.length ?? 0)) === 0 : [...p.media, ...(p.quote?.media ?? [])].some(m => m.kind === filters.media)))) &&
    (!filters.links || p.hasLinks === (filters.links === 'with')));
  return filters.postedOrder ? sortByPostedDate(result, filters.postedOrder) : filters.reverse ? result.reverse() : result;
}
