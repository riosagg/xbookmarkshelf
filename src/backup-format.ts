import { type Account, type Post, type UserState, type Tag, type LibrarySource, validHandle, validatePosts, isMarkSymbol, isMarkOrder, orderedMarks, MAX_MARKS, MAX_POST_TAGS } from './model';

export interface PostTag { accountId: string; postId: string; tagId: string }
export const BACKUP_MAX_BYTES = 20 * 1024 * 1024;
export const BACKUP_LIMITS = { accounts: 100, posts: 50000, userStates: 50000, tags: 10000, postTags: 200000 } as const;
export type BackupLimits = { -readonly [K in keyof typeof BACKUP_LIMITS]: number };
export interface BackupSplit { id: string; index: number; total: number }
export interface Backup {
  format: 'x-bookmark-library'; formatVersion: 1 | 2; exportedAt: string;
  split?: BackupSplit;
  accounts: Account[]; posts: Post[]; userStates: UserState[]; tags: Tag[]; postTags: PostTag[];
}
export type LikesBackup = Omit<Backup, 'format' | 'formatVersion'> & { format: 'xbookmarkshelf-likes'; formatVersion: 1 };
export type CollectionBackup = Backup | LikesBackup;
export function validateLikesBackup(value: unknown, limits: BackupLimits = BACKUP_LIMITS): LikesBackup {
  const v = value as LikesBackup;
  if (!v || v.format !== 'xbookmarkshelf-likes' || v.formatVersion !== 1) throw new Error('対応するいいねのJSONバックアップではありません');
  const checked = validateBackup({ ...v, format: 'x-bookmark-library', formatVersion: 2 }, limits);
  return { ...checked, format: 'xbookmarkshelf-likes', formatVersion: 1 };
}
export function validateCollectionBackup(value: unknown, source: LibrarySource, limits: BackupLimits = BACKUP_LIMITS): CollectionBackup {
  return source === 'likes' ? validateLikesBackup(value, limits) : validateBackup(value, limits);
}
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(v);
const timestamp = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v));
function array(value: unknown, max: number): unknown[] { if (!Array.isArray(value) || value.length > max) throw new Error('バックアップの件数が範囲外です'); return value; }
export function validateBackup(value: unknown, limits: BackupLimits = BACKUP_LIMITS): Backup {
  const v = value as Backup;
  if (!v || v.format !== 'x-bookmark-library' || ![1, 2].includes(v.formatVersion) || !timestamp(v.exportedAt)) throw new Error('対応するJSONバックアップではありません');
  let split: BackupSplit | undefined;
  if (v.split !== undefined) {
    const part = v.split;
    if (!part || !identifier(part.id) || !Number.isInteger(part.index) || !Number.isInteger(part.total) || part.total < 2 || part.total > 10000 || part.index < 1 || part.index > part.total) throw new Error('分割バックアップの情報が不正です');
    split = { id: part.id, index: part.index, total: part.total };
  }
  const accountIds = new Set<string>(); const handles = new Set<string>();
  const accounts = array(v.accounts, limits.accounts).map(raw => {
    const a = raw as Account;
    if (!a || !identifier(a.id) || !validHandle(a.handle) || accountIds.has(a.id) || handles.has(a.handle.toLowerCase())) throw new Error('アカウント情報が不正です');
    accountIds.add(a.id); handles.add(a.handle.toLowerCase()); return { id: a.id, handle: a.handle.toLowerCase() };
  });
  const postKeys = new Set<string>();
  const posts = array(v.posts, limits.posts).map(raw => {
    const p = raw as Post;
    if (!p || !accountIds.has(p.accountId) || !timestamp(p.firstImportedAt) || !timestamp(p.lastImportedAt)) throw new Error('投稿情報が不正です');
    const key = `${p.accountId}:${p.postId}`;
    if (postKeys.has(key)) throw new Error('投稿が重複しています');
    postKeys.add(key);
    return { ...validatePosts([p])[0]!, accountId: p.accountId, firstImportedAt: p.firstImportedAt, lastImportedAt: p.lastImportedAt };
  });
  const stateKeys = new Set<string>();
  const userStates = array(v.userStates, limits.userStates).map(raw => {
    const s = raw as UserState; const key = `${s?.accountId}:${s?.postId}`;
    if (!s || !identifier(s.accountId) || typeof s.postId !== 'string' || !postKeys.has(key) || stateKeys.has(key) || typeof s.read !== 'boolean' || typeof s.favorite !== 'boolean') throw new Error('ユーザー状態が不正です');
    stateKeys.add(key); return { accountId: s.accountId, postId: s.postId, read: s.read, favorite: s.favorite };
  });
  const tagIds = new Set<string>();
  const markCounts = new Map<string, number>(); const tagNames = new Set<string>();
  const tags = array(v.tags, limits.tags).map(raw => {
    const t = raw as Tag;
    if (!t || !identifier(t.id) || tagIds.has(t.id) || !accountIds.has(t.accountId) || typeof t.name !== 'string' || !t.name.trim() || t.name.length > 100) throw new Error('タグが不正です');
    if (v.formatVersion === 2 && t.mark !== undefined && !isMarkSymbol(t.mark)) throw new Error('マークのアイコンが不正です');
    if (v.formatVersion === 2 && t.markOrder !== undefined && (!t.mark || !isMarkOrder(t.markOrder))) throw new Error('マークの順序が不正です');
    if (v.formatVersion === 2 && t.mark) {
      const count = (markCounts.get(t.accountId) ?? 0) + 1;
      if (count > MAX_MARKS) throw new Error(`マークはアカウントごとに${MAX_MARKS}個までです`);
      markCounts.set(t.accountId, count);
    }
    const nameKey = `${t.accountId}:${t.name.trim()}`;
    if (v.formatVersion === 2 && tagNames.has(nameKey)) throw new Error('同じ名前のタグが重複しています');
    tagNames.add(nameKey);
    tagIds.add(t.id); return { id: t.id, accountId: t.accountId, name: t.name.trim(), ...(v.formatVersion === 2 && t.mark ? { mark: t.mark, ...(t.markOrder !== undefined ? { markOrder: t.markOrder } : {}) } : {}) };
  });
  const relationKeys = new Set<string>();
  const tagsById = new Map(tags.map(t => [t.id, t]));
  const postTagNames = new Map<string, Set<string>>();
  const postTags = array(v.postTags, limits.postTags).map(raw => {
    const t = raw as PostTag; const key = `${t?.accountId}:${t?.postId}:${t?.tagId}`;
    if (!t || !identifier(t.accountId) || !identifier(t.tagId) || typeof t.postId !== 'string' || !postKeys.has(`${t.accountId}:${t.postId}`) || tagsById.get(t.tagId)?.accountId !== t.accountId || relationKeys.has(key)) throw new Error('タグの関連が不正です');
    const postKey = `${t.accountId}:${t.postId}`;
    const names = postTagNames.get(postKey) ?? new Set<string>();
    names.add(tagsById.get(t.tagId)!.name);
    if (names.size > MAX_POST_TAGS) throw new Error('タグとマークは合計20個までです');
    postTagNames.set(postKey, names);
    relationKeys.add(key); return { accountId: t.accountId, postId: t.postId, tagId: t.tagId };
  });
  return { format: 'x-bookmark-library', formatVersion: v.formatVersion, exportedAt: v.exportedAt, ...(split ? { split } : {}), accounts, posts, userStates, tags, postTags };
}
