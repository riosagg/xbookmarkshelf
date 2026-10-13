import type { Backup } from '../src/backup-format';
import { observation, timestamp } from './unit/helpers';

export function syntheticLikes(count = 1) {
  return Array.from({ length: count }, (_, i) => ({ like: {
    tweetId: (9007199254740993123n + BigInt(i)).toString(),
    fullText: `合成投稿 ${i} ${i === count - 1 ? 'Ｓｈｅｌｆ 日本語 最後' : 'Archive'}${i % 2 === 0 ? ' https://example.com/synthetic' : ''}`,
    expandedUrl: `https://twitter.com/i/web/status/${9007199254740993123n + BigInt(i)}`,
  } }));
}
export function likesScript(count = 1) { return `window.YTD.like.part0 = ${JSON.stringify(syntheticLikes(count))};`; }
export function viewerBackup(): Backup {
  return { format: 'x-bookmark-library', formatVersion: 2, exportedAt: timestamp,
    accounts: [{ id: 'a', handle: 'sample_a' }, { id: 'b', handle: 'sample_b' }],
    posts: [['a', '1'], ['a', '2'], ['b', '1']].map(([accountId, postId]) => ({ ...observation(postId!, `合成 ${accountId}/${postId} https://example.com/synthetic`), accountId: accountId!, firstImportedAt: timestamp, lastImportedAt: timestamp,
      media: [{ kind: accountId === 'a' ? 'image' : 'video', url: 'https://pbs.twimg.com/media/synthetic-viewer.jpg' }, { kind: 'image', url: 'https://pbs.twimg.com/media/synthetic-viewer-2.jpg' }],
      linkCards: [{ url: 'https://example.com/synthetic', title: '合成サイト', imageUrl: 'https://pbs.twimg.com/card_img/synthetic-viewer.jpg' }] })),
    tags: [{ id: 'mark-a', accountId: 'a', name: '資料', mark: 'book', markOrder: 0 }, { id: 'mark-b', accountId: 'b', name: '資料', mark: 'star', markOrder: 0 }, { id: 'tag-a', accountId: 'a', name: '通常タグ' }],
    postTags: [{ accountId: 'a', postId: '1', tagId: 'mark-a' }, { accountId: 'a', postId: '1', tagId: 'tag-a' }, { accountId: 'b', postId: '1', tagId: 'mark-b' }],
    userStates: [{ accountId: 'a', postId: '1', read: true, favorite: true }],
  };
}

export function authorBackup(): Backup {
  const value = viewerBackup();
  const examples = [
    ['a', '1', 'x', 'Exact Author', '保存した投稿'],
    ['a', '2', 'x_extra', 'Extra Author', '本文に @x を含む投稿'],
    ['b', '1', 'prefix_x', 'Prefix Author', '別の投稿'],
    ['a', '3', 'plain', 'Display x', '表示名の部分一致'],
    ['a', '4', 'plain_two', 'Other Author', '本文に @x を含み、引用者もx'],
    ['b', '2', 'X', 'Another Exact Author', '別の保存アカウント'],
  ] as const;
  value.posts = examples.map(([accountId, postId, authorHandle, authorName, text], i) => ({ ...observation(postId, text), accountId, authorHandle, authorName,
    url: `https://x.com/${authorHandle}/status/${postId}`, firstImportedAt: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(), lastImportedAt: timestamp }));
  value.posts[4]!.quote = { postId: '40', authorHandle: 'x', authorName: 'Quoted x', text: '引用本文', postedAt: null, url: 'https://x.com/x/status/40', media: [] };
  return value;
}
