export type PostDateOrder = 'posted-newest' | 'posted-oldest';
export function isPostDateOrder(value: unknown): value is PostDateOrder {
  return value === 'posted-newest' || value === 'posted-oldest';
}
export function postedTime(value: unknown): number | null {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : null;
}
export function comparePostedTimes(a: number | null, b: number | null, order: PostDateOrder): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return order === 'posted-oldest' ? a - b : b - a;
}
export function sortByPostedDate<T extends { postedAt: string | null }>(posts: readonly T[], order: PostDateOrder): T[] {
  // Parse once per post; stable sorting keeps file order for ties and unknown dates.
  return posts.map(post => ({ post, time: postedTime(post.postedAt) }))
    .sort((a, b) => comparePostedTimes(a.time, b.time, order)).map(item => item.post);
}
