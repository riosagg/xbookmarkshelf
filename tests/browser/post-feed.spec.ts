import { expect, test } from './fixtures';

for (const source of ['bookmarks', 'likes'] as const) test(`${source}: continuous scrolling stays bounded, reaches both ends and resets filters and layout`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/library.html?source=${source}`);
  await page.evaluate(async source => {
    const path = '/src/db.ts'; const { storeForSource } = await import(path); const db = storeForSource(source);
    await db.settings.put({ key: 'accounts', value: [{ id: 'feed', handle: 'synthetic' }] });
    await db.posts.bulkPut(Array.from({ length: 1000 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(); const postId = String(index + 1);
      return { accountId: 'feed', postId, authorName: `Synthetic ${index}`, authorHandle: 'synthetic', text: `SC item ${index} ${'長文'.repeat(index % 3 ? 5 : 1000)}`,
        url: `https://x.com/synthetic/status/${postId}`, partial: false, postedAt: date, observedAt: date, firstImportedAt: date, lastImportedAt: date,
        media: index % 4 ? [] : [{ kind: 'image', url: `https://pbs.twimg.com/media/synthetic-${index}.jpg` }] };
    }));
  }, source);
  await page.reload(); const cards = page.locator('.card-grid .post-card'); const feed = page.locator('.post-feed');
  await expect(cards).toHaveCount(50); await expect(cards.first()).toContainText('SC item 999');
  await page.evaluate(() => {
    const state = { max: 0 }; Object.assign(window, { syntheticFeed: state });
    const observer = new MutationObserver(() => { state.max = Math.max(state.max, document.querySelectorAll('.card-grid .post-card').length); });
    observer.observe(document.body, { subtree: true, childList: true });
  });
  await page.mouse.wheel(0, 18000);
  await expect.poll(async () => Number(await feed.getAttribute('data-start'))).toBeGreaterThan(50);
  await expect(feed).toHaveAttribute('aria-busy', 'false'); expect(await cards.count()).toBeLessThanOrEqual(50);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(async () => Number(await feed.getAttribute('data-start'))).toBeGreaterThan(900);
  await expect(cards.last()).toContainText('SC item 0');
  await page.evaluate(() => window.scrollTo(0, 0)); await expect(feed).toHaveAttribute('data-start', '0');
  await expect(cards.first()).toContainText('SC item 999');
  const search = page.getByRole('searchbox', { name: '本文・投稿者を検索', exact: true });
  await search.fill('SC item 999'); await search.fill('SC item 100');
  await expect(cards).toHaveCount(1); await expect(cards.first()).toContainText('SC item 100');
  await expect(feed).toHaveAttribute('data-start', '0');
  await search.fill(''); await expect(cards).toHaveCount(50);
  await page.getByRole('combobox', { name: '表示列数', exact: true }).selectOption('5');
  await page.getByRole('button', { name: 'リスト表示', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.mouse.wheel(0, 14000); await expect.poll(async () => Number(await feed.getAttribute('data-start'))).toBeGreaterThan(0);
  await expect(feed).toHaveAttribute('aria-busy', 'false');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0)); await expect(feed).toHaveAttribute('data-start', '0');
  await page.getByRole('button', { name: source === 'likes' ? 'ブックマーク' : 'いいね', exact: true }).click();
  await expect(cards).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { syntheticFeed: { max: number } }).syntheticFeed.max)).toBeLessThanOrEqual(50);
  expect(errors).toEqual([]);
});
