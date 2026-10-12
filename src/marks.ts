import { db, type LibraryDB } from './db';
import { isMarkSymbol, MAX_MARKS, MAX_POST_TAGS, orderedMarks, type MarkSymbol, type Tag } from './model';

export async function saveMark(accountId: string, name: string, symbol: MarkSymbol, id?: string, store: LibraryDB = db) {
  name = name.trim();
  if (!name || name.length > 100 || !isMarkSymbol(symbol)) throw new Error('名前は1〜100文字、アイコンは候補から選んでください');
  return store.transaction('rw', store.tags, store.settings, async () => {
    const accounts = (await store.settings.get('accounts'))?.value as { id: string }[] | undefined;
    if (!accounts?.some(a => a.id === accountId)) throw new Error('保存先のアカウントを選んでください');
    const old = id ? await store.tags.get(id) : await store.tags.where('[accountId+name]').equals([accountId, name]).first();
    if (id && (!old || old.accountId !== accountId)) throw new Error('対象のマークが見つかりません');
    const sameName = await store.tags.where('[accountId+name]').equals([accountId, name]).first();
    if (sameName && sameName.id !== old?.id) throw new Error('同じ名前のタグがあります。別の名前を使ってください');
    const marks = orderedMarks(await store.tags.where('accountId').equals(accountId).toArray());
    if (!old?.mark && marks.length >= MAX_MARKS) throw new Error(`マークはアカウントごとに${MAX_MARKS}個までです`);
    if (marks.length) await store.tags.bulkPut(marks.map((t, markOrder) => ({ ...t, markOrder })));
    const tag: Tag = { id: old?.id ?? crypto.randomUUID(), accountId, name, mark: symbol, markOrder: old?.mark ? marks.findIndex(t => t.id === old.id) : marks.length };
    await store.tags.put(tag); return tag;
  });
}
export async function removeMark(id: string, store: LibraryDB = db) {
  return store.transaction('rw', store.tags, async () => {
    const tag = await store.tags.get(id);
    if (!tag) throw new Error('対象のマークが見つかりません');
    const { mark: _mark, markOrder: _order, ...ordinaryTag } = tag;
    await store.tags.put(ordinaryTag);
  });
}
export async function moveMark(accountId: string, id: string, direction: 'up' | 'down', store: LibraryDB = db) {
  if (direction !== 'up' && direction !== 'down') throw new Error('並べ替え方向が不正です');
  return store.transaction('rw', store.tags, async () => {
    const marks = orderedMarks(await store.tags.where('accountId').equals(accountId).toArray());
    const index = marks.findIndex(t => t.id === id);
    if (index < 0) throw new Error('このアカウントのマークではありません');
    const next = index + (direction === 'up' ? -1 : 1);
    if (next < 0 || next >= marks.length) return;
    [marks[index], marks[next]] = [marks[next]!, marks[index]!];
    await store.tags.bulkPut(marks.map((tag, markOrder) => ({ ...tag, markOrder })));
  });
}
export async function togglePostMark(accountId: string, postId: string, tagId: string, store: LibraryDB = db) {
  return store.transaction('rw', store.posts, store.tags, store.postTags, async () => {
    const tag = await store.tags.get(tagId);
    if (!tag?.mark || tag.accountId !== accountId || !await store.posts.get([accountId, postId])) throw new Error('この投稿に付けられるマークではありません');
    const key: [string, string, string] = [accountId, postId, tagId];
    const exists = await store.postTags.get(key);
    if (exists) await store.postTags.delete(key);
    else {
      if (await store.postTags.where('[accountId+postId]').equals([accountId, postId]).count() >= MAX_POST_TAGS) throw new Error('タグとマークは合計20個までです');
      await store.postTags.put({ accountId, postId, tagId });
    }
    return !exists;
  });
}
