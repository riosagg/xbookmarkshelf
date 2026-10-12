import { BACKUP_LIMITS, BACKUP_MAX_BYTES, validateCollectionBackup, type CollectionBackup, type BackupLimits } from './backup-format';
import { orderedMarks } from './model';

const fields = ['accounts', 'posts', 'userStates', 'tags', 'postTags'] as const;
type Field = typeof fields[number];
type Row = CollectionBackup[Field][number];
const postKey = (row: { accountId: string; postId: string }) => `${row.accountId}:${row.postId}`;
function rowKey(field: Field, row: Row): string {
  if (field === 'accounts' || field === 'tags') return (row as { id: string }).id;
  const key = postKey(row as { accountId: string; postId: string });
  return field === 'postTags' ? `${key}:${(row as { tagId: string }).tagId}` : key;
}
export interface BackupFile { name: string; text: string; posts: number }
export function postBackupFilename(markName?: string, date = new Date().toISOString().slice(0, 10), source: 'bookmarks' | 'likes' = 'bookmarks'): string {
  const safe = markName === undefined ? '' : Array.from(markName.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').trim()).slice(0, 40).join('') || 'marked';
  return `xbookmarkshelf-${source === 'likes' ? 'likes' : 'posts'}-${markName === undefined ? '' : `mark-${safe}-`}${date}.json`;
}

// Used only for trusted in-memory snapshots. File readers retain the default per-file limits.
export function validateBackupSnapshot(input: unknown): CollectionBackup {
  const value = input as CollectionBackup;
  const limits = {} as BackupLimits;
  for (const field of fields) {
    if (!Array.isArray(value[field])) throw new Error('バックアップの件数が範囲外です');
    limits[field] = value[field].length;
  }
  return validateCollectionBackup(value, value.format === 'xbookmarkshelf-likes' ? 'likes' : 'bookmarks', limits);
}
export function prepareBackupFiles(input: CollectionBackup, markName?: string, maxBytes = BACKUP_MAX_BYTES): BackupFile[] {
  const value = validateBackupSnapshot(input);
  const source = value.format === 'xbookmarkshelf-likes' ? 'likes' : 'bookmarks';
  const empty = (): CollectionBackup => ({ format: value.format, formatVersion: value.formatVersion, exportedAt: value.exportedAt,
    accounts: [], posts: [], userStates: [], tags: [], postTags: [] } as CollectionBackup);
  const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
  const lengths = new WeakMap<object, number>();
  const size = (row: Row) => { let n = lengths.get(row); if (n === undefined) { n = bytes(JSON.stringify(row)); lengths.set(row, n); } return n; };
  // Reserve the bounded split header before selecting any rows.
  const base = bytes(JSON.stringify(empty())) + 256;
  let part = empty(); let partBytes = base;
  let seen: Record<Field, Set<string>> = { accounts: new Set(), posts: new Set(), userStates: new Set(), tags: new Set(), postTags: new Set() };
  const parts: CollectionBackup[] = [];
  const exportedAccounts = new Set<string>(); const exportedTags = new Set<string>();
  function flush() {
    parts.push(part); if (parts.length > 10000) throw new Error('分割ファイル数が上限を超えました');
    part = empty(); partBytes = base; seen = { accounts: new Set(), posts: new Set(), userStates: new Set(), tags: new Set(), postTags: new Set() };
  }
  function add(unit: Partial<Record<Field, Row[]>>) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const additions = {} as Record<Field, Row[]>; let extra = 0; let fits = true;
      for (const field of fields) {
        const keys = new Set<string>();
        additions[field] = (unit[field] ?? []).filter(row => { const k = rowKey(field, row); if (seen[field].has(k) || keys.has(k)) return false; keys.add(k); return true; });
        if (part[field].length + additions[field].length > BACKUP_LIMITS[field]) fits = false;
        extra += additions[field].reduce((n, row) => n + size(row) + 1, 0);
        if (!part[field].length && additions[field].length) extra--;
      }
      if (fits && partBytes + extra <= maxBytes) {
        for (const field of fields) for (const row of additions[field]) {
          (part[field] as Row[]).push(row); seen[field].add(rowKey(field, row));
          if (field === 'accounts') exportedAccounts.add(rowKey(field, row));
          if (field === 'tags') exportedTags.add(rowKey(field, row));
        }
        partBytes += extra; return;
      }
      if (!fields.some(field => part[field].length)) throw new Error('1件の投稿または分類がバックアップの上限を超えています');
      flush();
    }
    throw new Error('バックアップを書き出せません');
  }
  const accounts = new Map(value.accounts.map(a => [a.id, a])); const tags = new Map(value.tags.map(t => [t.id, t]));
  const states = new Map(value.userStates.map(s => [postKey(s), s]));
  const assigned = new Map<string, CollectionBackup['postTags']>();
  for (const row of value.postTags) { const k = postKey(row); const list = assigned.get(k) ?? []; list.push(row); assigned.set(k, list); }
  const marks = new Map<string, CollectionBackup['tags']>();
  for (const tag of orderedMarks(value.tags)) { const list = marks.get(tag.accountId) ?? []; list.push(tag); marks.set(tag.accountId, list); }
  for (const post of value.posts) {
    const relations = assigned.get(postKey(post)) ?? []; const state = states.get(postKey(post));
    add({ posts: [post], accounts: [accounts.get(post.accountId)!], userStates: state ? [state] : [], postTags: relations,
      tags: [...(marks.get(post.accountId) ?? []), ...relations.map(row => tags.get(row.tagId)!)] });
  }
  // Definitions without posts are still part of a full backup.
  for (const tag of value.tags) if (!exportedTags.has(tag.id)) add({ accounts: [accounts.get(tag.accountId)!], tags: [...(marks.get(tag.accountId) ?? []), tag] });
  for (const account of value.accounts) if (!exportedAccounts.has(account.id)) add({ accounts: [account] });
  if (fields.some(field => part[field].length) || !parts.length) flush();
  const id = crypto.randomUUID(); const filename = postBackupFilename(markName, value.exportedAt.slice(0, 10), source);
  return parts.map((fragment, index) => {
    const checked = validateCollectionBackup({ ...fragment, ...(parts.length > 1 ? { split: { id, index: index + 1, total: parts.length } } : {}) }, source);
    const text = JSON.stringify(checked);
    if (bytes(text) > maxBytes) throw new Error('JSONファイルは20MBまでです');
    return { name: parts.length === 1 ? filename : filename.replace(/\.json$/, `-part-${String(index + 1).padStart(4, '0')}-of-${String(parts.length).padStart(4, '0')}.json`), text, posts: checked.posts.length };
  });
}

export function verifyBackupParts(backups: readonly CollectionBackup[]): void {
  const groups = new Map<string, { total: number; format: string; date: string; indices: Set<number> }>();
  for (const backup of backups) {
    const split = backup.split; if (!split) continue;
    const group = groups.get(split.id) ?? { total: split.total, format: backup.format, date: backup.exportedAt, indices: new Set<number>() };
    if (group.total !== split.total || group.format !== backup.format || group.date !== backup.exportedAt || group.indices.has(split.index)) throw new Error('分割バックアップの組み合わせが不正です');
    group.indices.add(split.index); groups.set(split.id, group);
  }
  for (const group of groups.values()) if (group.indices.size !== group.total) throw new Error('分割バックアップはすべてのファイルを選択してください');
}
export function downloadBackupFile(file: BackupFile): void {
  const url = URL.createObjectURL(new Blob([file.text], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = file.name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
