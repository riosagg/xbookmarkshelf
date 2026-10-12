import { db, type LibraryDB, mergePost } from './db';
import { type Account, type UserState, orderedMarks, MAX_MARKS, MAX_POST_TAGS } from './model';
import { validateCollectionBackup, type CollectionBackup } from './backup-format';
import { validateBackupSnapshot, verifyBackupParts } from './backup-parts';
export { validateBackup, validateCollectionBackup, type Backup, type CollectionBackup } from './backup-format';

export async function createBackup(store = db): Promise<CollectionBackup> {
  const header = store.source === 'likes' ? { format: 'xbookmarkshelf-likes' as const, formatVersion: 1 as const } : { format: 'x-bookmark-library' as const, formatVersion: 2 as const };
  return store.transaction('r', store.posts, store.userStates, store.tags, store.postTags, store.settings, async () => ({
    ...header, exportedAt: new Date().toISOString(),
    accounts: ((await store.settings.get('accounts'))?.value ?? []) as Account[], posts: await store.posts.toArray(),
    userStates: await store.userStates.toArray(), tags: await store.tags.toArray(), postTags: await store.postTags.toArray(),
  }));
}
async function markedPostCollection(markId: string, store: LibraryDB) {
  const mark = await store.tags.get(markId);
  if (!mark?.mark) throw new Error('対象のマークが見つかりません');
  const assignments = await store.postTags.where('tagId').equals(markId).filter(row => row.accountId === mark.accountId).toArray();
  const ids = new Set(assignments.map(row => row.postId));
  return store.posts.where('accountId').equals(mark.accountId).filter(post => ids.has(post.postId));
}
export async function markedBackupCount(markId: string, store = db): Promise<number> {
  return store.transaction('r', store.posts, store.tags, store.postTags, async () => (await markedPostCollection(markId, store)).count());
}
export async function createMarkedBackup(markId: string, store = db): Promise<CollectionBackup> {
  // Scope posts and every dependent record in one read snapshot, before export.
  return store.transaction('r', [store.posts, store.userStates, store.tags, store.postTags, store.settings], async () => {
    const posts = await (await markedPostCollection(markId, store)).toArray();
    if (!posts.length) throw new Error('このマークが付いた投稿はありません');
    const keys: [string, string][] = posts.map(post => [post.accountId, post.postId]);
    const accountIds = new Set(posts.map(post => post.accountId));
    const userStates = (await store.userStates.bulkGet(keys)).filter(state => state !== undefined);
    const postTags = await store.postTags.where('[accountId+postId]').anyOf(keys).toArray();
    const tags = (await store.tags.bulkGet([...new Set(postTags.map(row => row.tagId))])).filter(tag => tag !== undefined);
    const accounts = (((await store.settings.get('accounts'))?.value ?? []) as Account[]).filter(account => accountIds.has(account.id));
    return validateBackupSnapshot({ format: store.source === 'likes' ? 'xbookmarkshelf-likes' : 'x-bookmark-library', formatVersion: store.source === 'likes' ? 1 : 2, exportedAt: new Date().toISOString(), accounts, posts, userStates, tags, postTags });
  });
}
export async function restoreBackup(input: unknown, store: LibraryDB = db) {
  return restoreBackups([input], store);
}
export async function restoreBackups(inputs: readonly unknown[], store: LibraryDB = db) {
  if (!inputs.length || inputs.length > 10000) throw new Error('バックアップの件数が範囲外です');
  const backups = inputs.map(input => validateCollectionBackup(input, store.source));
  verifyBackupParts(backups);
  return store.transaction('rw', [store.posts, store.media, store.userStates, store.tags, store.postTags, store.settings], async () => {
    let added = 0; let existing = 0;
    for (const backup of backups) {
      const accounts = ((await store.settings.get('accounts'))?.value ?? []) as Account[];
      const accountMap = new Map<string, string>();
      for (const a of backup.accounts) {
        const sameId = accounts.find(local => local.id === a.id);
        if (sameId && sameId.handle !== a.handle) throw new Error('アカウントIDが競合しています');
        const known = accounts.find(local => local.handle === a.handle);
        accountMap.set(a.id, known?.id ?? a.id);
        if (!known) accounts.push(a);
      }
      for (const p of backup.posts) {
        const accountId = accountMap.get(p.accountId)!;
        const old = await store.posts.get([accountId, p.postId]);
        const merged = old ? mergePost(old, p, accountId, old.lastImportedAt > p.lastImportedAt ? old.lastImportedAt : p.lastImportedAt) : { ...p, accountId };
        await store.posts.put(merged);
        await store.media.where('[accountId+postId]').equals([accountId, p.postId]).delete();
        if (merged.media.length) await store.media.bulkPut(merged.media.map((m, index) => ({ ...m, index, accountId, postId: p.postId })));
        if (old) existing++; else added++;
      }
      for (const s of backup.userStates) {
        const accountId = accountMap.get(s.accountId)!;
        if (!await store.userStates.get([accountId, s.postId])) await store.userStates.add({ ...s, accountId });
      }
      const tagMap = new Map<string, string>();
      const markCounts = new Map<string, number>();
      for (const accountId of new Set(accountMap.values())) {
        const marks = orderedMarks(await store.tags.where('accountId').equals(accountId).toArray());
        if (marks.length) await store.tags.bulkPut(marks.map((t, markOrder) => ({ ...t, markOrder })));
        markCounts.set(accountId, marks.length);
      }
      for (const t of [...backup.tags.filter(tag => !tag.mark), ...orderedMarks(backup.tags)]) {
        const accountId = accountMap.get(t.accountId)!;
        const known = await store.tags.where('[accountId+name]').equals([accountId, t.name]).first();
        const id = known?.id ?? crypto.randomUUID();
        tagMap.set(t.id, id);
        if (t.mark && !known?.mark) {
          const markOrder = markCounts.get(accountId) ?? 0;
          if (markOrder >= MAX_MARKS) throw new Error(`復元後のマークが${MAX_MARKS}個を超えます。既存データは変更していません`);
          await store.tags.put({ id, accountId, name: known?.name ?? t.name, mark: t.mark, markOrder });
          markCounts.set(accountId, markOrder + 1);
        } else if (!known) await store.tags.add({ id, accountId, name: t.name });
      }
      const assignments = new Map<string, { accountId: string; postId: string; tagIds: Set<string> }>();
      for (const p of backup.posts) {
        const accountId = accountMap.get(p.accountId)!;
        assignments.set(`${accountId}:${p.postId}`, { accountId, postId: p.postId, tagIds: new Set() });
      }
      for (const t of backup.postTags) assignments.get(`${accountMap.get(t.accountId)!}:${t.postId}`)!.tagIds.add(tagMap.get(t.tagId)!);
      for (const { accountId, postId, tagIds } of assignments.values()) {
        const existing = await store.postTags.where('[accountId+postId]').equals([accountId, postId]).limit(MAX_POST_TAGS + 1).toArray();
        if (new Set([...existing.map(t => t.tagId), ...tagIds]).size > MAX_POST_TAGS) throw new Error('タグとマークは合計20個までです');
        if (tagIds.size) await store.postTags.bulkPut([...tagIds].map(tagId => ({ accountId, postId, tagId })));
      }
      await store.settings.put({ key: 'accounts', value: accounts });
    }
    return { added, existing };
  });
}
