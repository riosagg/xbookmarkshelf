import { type ObservedPost } from '../../src/model';
export const timestamp = '2026-10-10T08:00:00.000Z';
export function observation(postId = '9007199254740993123', text = '保存する本文'): ObservedPost {
  return { postId, text, authorHandle: 'test_author', authorName: 'テスト投稿者', postedAt: timestamp, observedAt: timestamp,
    url: `https://x.com/test_author/status/${postId}`, partial: true, media: [] };
}
