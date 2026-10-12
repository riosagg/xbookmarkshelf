import { webUrl } from './text';
export type Mode = 'full' | 'delta';
export type LibrarySource = 'bookmarks' | 'likes';
export function isLibrarySource(value: unknown): value is LibrarySource { return value === 'bookmarks' || value === 'likes'; }
export interface LinkCard { url: string; title: string; imageUrl: string }
export interface QuotedPost {
  postId: string | null; authorHandle: string; authorName: string; text: string;
  url: string | null; postedAt: string | null;
  media: ObservedPost['media']; linkCards?: LinkCard[];
}
export type RunState = 'running' | 'paused' | 'stopped';
export type StopReason = 'manual_stop' | 'user_pause' | 'run_limit' | 'known_threshold' | 'estimated_end' | 'source_hidden' | 'source_changed' | 'source_scope_changed' | 'account_changed' | 'access_restricted' | 'tab_closed' | 'interrupted' | 'error';
export interface ObservedPost {
  postId: string;
  authorHandle: string;
  authorName: string;
  text: string;
  postedAt: string | null;
  observedAt: string;
  url: string;
  partial: boolean;
  media: { kind: 'image' | 'video'; url: string }[];
  linkCards?: LinkCard[];
  quote?: QuotedPost;
}
export interface Post extends ObservedPost {
  accountId: string;
  firstImportedAt: string;
  lastImportedAt: string;
}
export interface UserState { accountId: string; postId: string; read: boolean; favorite: boolean }
export interface Account { id: string; handle: string }
export const MARK_SYMBOLS = ['star', 'flag', 'heart', 'bolt', 'book', 'bulb', 'code', 'check', 'pin', 'bookmark', 'folder', 'briefcase', 'home', 'globe', 'link', 'music', 'film', 'camera', 'headphones', 'palette', 'flask', 'graduation', 'terminal', 'bug', 'shield', 'clock', 'calendar', 'coffee', 'rocket', 'archive'] as const;
export type MarkSymbol = typeof MARK_SYMBOLS[number];
export interface Tag { id: string; accountId: string; name: string; mark?: MarkSymbol; markOrder?: number }
export const MAX_MARKS = 30;
export const MAX_POST_TAGS = 20;
export function isMarkSymbol(value: unknown): value is MarkSymbol { return MARK_SYMBOLS.some(symbol => symbol === value); }
export function isMarkOrder(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < MAX_MARKS; }
export function orderedMarks<T extends Tag>(tags: readonly T[]): T[] {
  return tags.filter(t => t.mark).sort((a, b) => (isMarkOrder(a.markOrder) ? a.markOrder : MAX_MARKS) - (isMarkOrder(b.markOrder) ? b.markOrder : MAX_MARKS) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
export interface ImportOptions { intervalMs: number; intervalMaxMs?: number; maxPosts: number; mode: Mode }
export interface ImportLocations { bookmarks: string; likes: string }
export interface ImportRun extends ImportOptions {
  source?: LibrarySource; // Runs saved before source separation are bookmarks.
  importLocations?: ImportLocations; // Immutable URL settings captured by the worker at start.
  id: string;
  tabId: number;
  documentId: string;
  accountId: string;
  handle: string;
  state: RunState;
  reason: StopReason | null;
  startedAt: string;
  updatedAt: string;
  observed: number;
  added: number;
  existing: number;
  consecutiveKnown: number;
  nextSequence: number;
  lastFingerprint: string;
  lastPostId: string | null;
}
export const BATCH_SIZE = 10;
export const DEFAULT_OPTIONS: ImportOptions = { intervalMs: 3000, maxPosts: 100, mode: 'full' };
export const REASON_LABELS = {
  manual_stop: '手動で停止しました', user_pause: '一時停止しました', run_limit: '実行を完了しました',
  known_threshold: '既知の投稿が30件続いたため終了しました（推定）', estimated_end: '追加の投稿を確認できなかったため終了しました（推定）',
  source_hidden: 'Xのタブが非表示になったため停止しました', source_changed: '対象ページが変わったため停止しました',
  source_scope_changed: '取り込み対象の一覧が切り替わったため停止しました',
  account_changed: '対象アカウントを確認できないため停止しました', access_restricted: '制限またはページエラーを検出して停止しました',
  tab_closed: 'Xのタブが閉じられました', interrupted: '前回の処理が中断されました', error: '読み取りまたは保存に失敗しました',
} as const satisfies Record<StopReason, string>;
export function isBookmarkUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try { const u = new URL(value); return u.origin === 'https://x.com' && !u.username && !u.password && /^\/i\/(bookmarks|history)\/?$/.test(u.pathname); } catch { return false; }
}
export function isLibraryUrl(value: unknown): value is string {
  if (isBookmarkUrl(value)) return true;
  if (typeof value !== 'string') return false;
  try { const u = new URL(value); return u.origin === 'https://x.com' && !u.username && !u.password && (/^\/i\/history\/likes\/?$/.test(u.pathname) || /^\/[a-zA-Z0-9_]{1,15}\/likes\/?$/.test(u.pathname)); } catch { return false; }
}
export function isMediaUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try { const u = new URL(value); return u.origin === 'https://pbs.twimg.com' && !u.username && !u.password; } catch { return false; }
}
export function mediaKind(kind: 'image' | 'video', url: string): 'image' | 'video' {
  if (kind === 'video') return 'video';
  try { return /^\/(ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb)\//.test(new URL(url).pathname) ? 'video' : 'image'; }
  catch { return kind; }
}
// X can render the same asset as an img and a CSS background at different sizes.
export function mediaKey(value: string): string {
  try {
    const url = new URL(value);
    if (isMediaUrl(value) && /^\/(media|ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb|card_img)\//.test(url.pathname)) {
      url.searchParams.delete('name'); url.searchParams.delete('format');
    }
    return url.href;
  } catch { return value; }
}
export function mergeMedia(...groups: ObservedPost['media'][]): ObservedPost['media'] {
  const items = new Map<string, ObservedPost['media'][number]>();
  for (const item of groups.flat()) {
    if (!isMediaUrl(item.url)) continue;
    const key = mediaKey(item.url); const prior = items.get(key);
    if (!prior && items.size >= 8) continue;
    items.set(key, { ...(prior ?? item), kind: mediaKind(prior?.kind === 'video' ? 'video' : item.kind, item.url) });
  }
  return [...items.values()];
}
export function validHandle(value: unknown): value is string { return typeof value === 'string' && /^[a-zA-Z0-9_]{1,15}$/.test(value); }
export function validateQuote(value: unknown): QuotedPost {
  const q = value as QuotedPost;
  if (!q || typeof q.authorName !== 'string' || q.authorName.length > 200 || typeof q.text !== 'string' || q.text.length > 50000 ||
      (q.postedAt !== null && (typeof q.postedAt !== 'string' || q.postedAt.length > 40 || !Number.isFinite(Date.parse(q.postedAt))))) throw new Error('引用データが不正です');
  if (q.url === null) {
    if (q.postId !== null || q.authorHandle !== '') throw new Error('引用データが不正です');
  } else if (typeof q.postId !== 'string' || !/^\d{1,30}$/.test(q.postId) || !validHandle(q.authorHandle) || q.url !== `https://x.com/${q.authorHandle}/status/${q.postId}`) throw new Error('引用データが不正です');
  // Reuse the same media/card bounds and URL guards as the outer post. No recursive quotes.
  const checked = validatePosts([{ postId: q.postId ?? '0', authorHandle: q.authorHandle || 'unknown', authorName: q.authorName, text: q.text,
    postedAt: q.postedAt, observedAt: '2026-01-01T00:00:00.000Z', url: `https://x.com/${q.authorHandle || 'unknown'}/status/${q.postId ?? '0'}`,
    partial: true, media: q.media, ...(q.linkCards === undefined ? {} : { linkCards: q.linkCards }) }])[0]!;
  return { postId: q.postId, authorHandle: q.authorHandle, authorName: q.authorName, text: q.text, url: q.url, postedAt: q.postedAt,
    media: checked.media, ...(checked.linkCards ? { linkCards: checked.linkCards } : {}) };
}
export function mergeQuote(old: QuotedPost | undefined, incoming: QuotedPost | undefined): QuotedPost | undefined {
  if (!incoming) return old;
  if (!old || (old.url && incoming.url && old.url !== incoming.url)) return incoming;
  const cards = new Map((old.linkCards ?? []).map(card => [card.url, card]));
  for (const card of incoming.linkCards ?? []) cards.set(card.url, card);
  return { ...incoming, postId: incoming.postId ?? old.postId, url: incoming.url ?? old.url, authorHandle: incoming.authorHandle || old.authorHandle,
    authorName: incoming.authorName || old.authorName, text: incoming.text.length >= old.text.length ? incoming.text : old.text,
    postedAt: incoming.postedAt ?? old.postedAt, media: mergeMedia(old.media, incoming.media), ...(cards.size ? { linkCards: [...cards.values()].slice(0, 4) } : {}) };
}
export function librarySourceUrl(source: LibrarySource, handle?: unknown): string {
  if (source === 'likes') return validHandle(handle) ? `https://x.com/${handle.toLowerCase()}/likes` : 'https://x.com/i/history';
  return 'https://x.com/i/bookmarks';
}
export function validateOptions(value: unknown): ImportOptions {
  const v = value as ImportOptions;
  if (!v || !Number.isInteger(v.intervalMs) || v.intervalMs < 3000 || v.intervalMs > 30000 ||
      !Number.isInteger(v.maxPosts) || v.maxPosts < 10 || v.maxPosts > 1000 || !['full', 'delta'].includes(v.mode)) throw new Error('設定値が範囲外です');
  if (v.intervalMaxMs !== undefined && (!Number.isInteger(v.intervalMaxMs) || v.intervalMaxMs < v.intervalMs || v.intervalMaxMs > 30000)) throw new Error('最長の待機は最短以上、30秒以下にしてください');
  return { intervalMs: v.intervalMs, ...(v.intervalMaxMs === undefined ? {} : { intervalMaxMs: v.intervalMaxMs }), maxPosts: v.maxPosts, mode: v.mode };
}
export function chooseIntervalMs(options: ImportOptions, random = Math.random): number {
  const maximum = options.intervalMaxMs ?? options.intervalMs;
  return maximum === options.intervalMs ? options.intervalMs : options.intervalMs + Math.floor(random() * (maximum - options.intervalMs + 1));
}
export function validatePosts(value: unknown): ObservedPost[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > BATCH_SIZE) throw new Error('バッチが不正です');
  const ids = new Set<string>();
  return value.map((input: unknown) => {
    const p = input as ObservedPost;
    if (!p || typeof p.postId !== 'string' || !/^\d{1,30}$/.test(p.postId) || ids.has(p.postId) || !validHandle(p.authorHandle) ||
        typeof p.authorName !== 'string' || p.authorName.length > 200 || typeof p.text !== 'string' || p.text.length > 50000 ||
        typeof p.observedAt !== 'string' || p.observedAt.length > 40 || !Number.isFinite(Date.parse(p.observedAt)) ||
        (p.postedAt !== null && (typeof p.postedAt !== 'string' || p.postedAt.length > 40 || !Number.isFinite(Date.parse(p.postedAt)))) ||
        p.url !== `https://x.com/${p.authorHandle}/status/${p.postId}` || typeof p.partial !== 'boolean' || !Array.isArray(p.media) || p.media.length > 8) throw new Error('投稿データが不正です');
    ids.add(p.postId);
    const media = p.media.map(m => {
      if (!m || !['image', 'video'].includes(m.kind) || typeof m.url !== 'string' || m.url.length > 2048) throw new Error('メディア参照が不正です');
      const url = new URL(m.url);
      if (!isMediaUrl(m.url)) throw new Error('メディアURLが不正です');
      return { kind: mediaKind(m.kind, url.href), url: url.href };
    });
    let linkCards: LinkCard[] | undefined;
    if (p.linkCards !== undefined) {
      if (!Array.isArray(p.linkCards) || p.linkCards.length > 4) throw new Error('リンクカードが不正です');
      const urls = new Set<string>();
      linkCards = p.linkCards.map(card => {
        const url = webUrl(card?.url);
        if (!card || !url || urls.has(url) || typeof card.title !== 'string' || card.title.length > 300 || !isMediaUrl(card.imageUrl)) throw new Error('リンクカードが不正です');
        urls.add(url); return { url, title: card.title.trim(), imageUrl: new URL(card.imageUrl).href };
      });
    }
    const quote = p.quote === undefined ? undefined : validateQuote(p.quote);
    return { postId: p.postId, authorHandle: p.authorHandle, authorName: p.authorName, text: p.text, postedAt: p.postedAt, observedAt: p.observedAt, url: p.url, partial: p.partial, media, ...(linkCards?.length ? { linkCards } : {}), ...(quote ? { quote } : {}) };
  });
}
