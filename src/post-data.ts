import { db, type LibraryDB } from './db';

export type PostKey = [string, string];
export type DeletionPlan = { scope: 'selected' | 'all'; keys: PostKey[] };
export const selectionKey = (key: PostKey) => JSON.stringify(key);

function validateKeys(keys: PostKey[], selected: boolean): PostKey[] {
  if (!Array.isArray(keys) || !keys.length || (selected && keys.length > 50) || keys.some(key =>
    !Array.isArray(key) || key.length !== 2 || typeof key[0] !== 'string' || !key[0] ||
    typeof key[1] !== 'string' || !/^\d{1,30}$/.test(key[1]))) throw new Error('削除対象が不正です');
  if (new Set(keys.map(selectionKey)).size !== keys.length) throw new Error('削除対象が不正です');
  return keys.map(([accountId, postId]) => [accountId, postId]);
}
async function requireStopped(store: LibraryDB) {
  if (await store.importRuns.where('state').equals('running').count()) throw new Error('取り込みを停止してから投稿を削除してください');
}
export async function prepareDeletion(scope: DeletionPlan['scope'], selected: PostKey[] = [], store = db): Promise<DeletionPlan> {
  if (scope !== 'selected' && scope !== 'all') throw new Error('削除対象が不正です');
  return store.transaction('r', store.posts, store.importRuns, async () => {
    await requireStopped(store);
    const keys = scope === 'all' ? await store.posts.toCollection().primaryKeys() : validateKeys(selected, true);
    if (!keys.length) throw new Error('削除する投稿がありません');
    if (scope === 'selected' && (await store.posts.bulkGet(keys)).some(post => !post)) throw new Error('投稿が変更されました。削除対象を選び直してください');
    return { scope, keys: validateKeys(keys, scope === 'selected') };
  });
}
export async function deletePosts(plan: DeletionPlan, store = db): Promise<number> {
  if (!plan || (plan.scope !== 'selected' && plan.scope !== 'all')) throw new Error('削除対象が不正です');
  const keys = validateKeys(plan.keys, plan.scope === 'selected');
  // The shared stores serialize this operation with imports, restores and edits.
  return store.transaction('rw', [store.posts, store.media, store.userStates, store.postTags, store.importRuns], async () => {
    await requireStopped(store);
    if (plan.scope === 'all') {
      const current = await store.posts.toCollection().primaryKeys();
      const expected = new Set(keys.map(selectionKey));
      if (current.length !== keys.length || current.some(key => !expected.has(selectionKey(key)))) throw new Error('投稿が変更されました。削除対象を選び直してください');
      await store.posts.clear(); await store.media.clear(); await store.userStates.clear(); await store.postTags.clear();
    } else {
      if ((await store.posts.bulkGet(keys)).some(post => !post)) throw new Error('投稿が変更されました。削除対象を選び直してください');
      await store.posts.bulkDelete(keys); await store.userStates.bulkDelete(keys);
      for (const key of keys) {
        await store.media.where('[accountId+postId]').equals(key).delete();
        await store.postTags.where('[accountId+postId]').equals(key).delete();
      }
    }
    return keys.length;
  });
}
export async function storageUsage(): Promise<number | null> {
  try {
    const usage = (await navigator.storage?.estimate?.())?.usage;
    return typeof usage === 'number' && Number.isFinite(usage) && usage >= 0 ? usage : null;
  } catch { return null; }
}
export function formatStorageBytes(bytes: number, locale: string): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const index = bytes > 0 ? Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024))) : 0;
  const unit = Math.max(0, index);
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit ? 2 : 0 }).format(bytes / 1024 ** unit)} ${units[unit]}`;
}
