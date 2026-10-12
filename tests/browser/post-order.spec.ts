import { expect, test, type Page } from './fixtures';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Backup, type CollectionBackup } from '../../src/backup-format';

function fixture(source: 'bookmarks' | 'likes', count = 6): CollectionBackup {
  const dates = [null, '2026-10-12T00:00:00Z', '2026-10-11T00:00:00Z', '2026-10-12T09:00:00+09:00', null, '2026-10-10T00:00:00Z'];
  const backup: Backup = { format: 'x-bookmark-library', formatVersion: 2, exportedAt: '2026-10-13T00:00:00Z', accounts: [{ id: 'a', handle: 'synthetic' }],
    posts: Array.from({ length: count }, (_, i) => ({ accountId: 'a', postId: String(i + 1), text: `Sort ${i + 1}`, authorName: 'Synthetic', authorHandle: 'synthetic',
      url: `https://x.com/synthetic/status/${i + 1}`, postedAt: dates[i % 6]!, observedAt: '2026-10-13T00:00:00Z', partial: false, media: [],
      firstImportedAt: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(), lastImportedAt: '2026-10-13T00:00:00Z' })),
    tags: [{ id: 'mark', accountId: 'a', name: '分類', mark: 'star' }], postTags: [{ accountId: 'a', postId: '1', tagId: 'mark' }],
    userStates: [{ accountId: 'a', postId: '2', read: true, favorite: true }] };
  return source === 'likes' ? { ...backup, format: 'xbookmarkshelf-likes', formatVersion: 1 } : backup;
}
const input = (value: unknown) => ({ name: 'synthetic-sort.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
const orderControl = (page: Page) => page.locator('select').filter({ has: page.locator('option[value="posted-newest"]') });
const contents = (page: Page) => page.locator('.card-grid .post-card :is(summary, .viewer-post-summary)');

for (const source of ['bookmarks', 'likes'] as const) test(`extension ${source}: preserves save order, places unknown dates last, resets selection and bounds date-sorted scrolling`, async ({ page }) => {
  await page.goto(`/library.html?source=${source}`);
  await page.evaluate(async ({ source, value }) => {
    const path = '/src/db.ts'; const { db, storeForSource } = await import(path); const store = storeForSource(source);
    await db.settings.bulkPut([{ key: 'language', value: 'ja' }, { key: 'previews', value: false }]);
    await store.settings.put({ key: 'accounts', value: value.accounts });
    await store.posts.bulkPut(value.posts); await store.tags.bulkPut(value.tags); await store.postTags.bulkPut(value.postTags); await store.userStates.bulkPut(value.userStates);
  }, { source, value: fixture(source) });
  await page.reload(); const order = orderControl(page);
  await expect(contents(page)).toHaveText(['Sort 6', 'Sort 5', 'Sort 4', 'Sort 3', 'Sort 2', 'Sort 1']);
  const before = await page.evaluate(async source => { const path = '/src/backup.ts'; const dbPath = '/src/db.ts'; return (await import(path)).createBackup((await import(dbPath)).storeForSource(source)); }, source);
  await order.selectOption('posted-newest'); await expect(contents(page)).toHaveText(['Sort 4', 'Sort 2', 'Sort 3', 'Sort 6', 'Sort 5', 'Sort 1']);
  await order.selectOption('posted-oldest'); await expect(contents(page)).toHaveText(['Sort 6', 'Sort 3', 'Sort 4', 'Sort 2', 'Sort 5', 'Sort 1']);
  const search = page.getByRole('searchbox', { name: '本文・投稿者を検索', exact: true });
  await search.fill('Sort 5'); await expect(contents(page)).toHaveText(['Sort 5']);
  await search.fill(''); await expect(contents(page)).toHaveCount(6);
  await order.selectOption('oldest'); await expect(contents(page)).toHaveText(['Sort 1', 'Sort 2', 'Sort 3', 'Sort 4', 'Sort 5', 'Sort 6']);
  const after = await page.evaluate(async source => { const path = '/src/backup.ts'; const dbPath = '/src/db.ts'; return (await import(path)).createBackup((await import(dbPath)).storeForSource(source)); }, source);
  expect({ ...after, exportedAt: before.exportedAt }).toEqual(before);
  await page.getByRole('button', { name: '投稿を選択', exact: true }).click(); await page.getByLabel('投稿1を選択', { exact: true }).check();
  await order.selectOption('posted-newest'); await expect(page.locator('.post-selection:checked')).toHaveCount(0);
  await page.evaluate(async ({ source, value }) => { const path = '/src/db.ts'; await (await import(path)).storeForSource(source).posts.bulkPut(value.posts); }, { source, value: fixture(source, 120) });
  await expect(page.locator('.page-heading')).toContainText('120件');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.locator('.post-feed')).toHaveAttribute('aria-busy', 'false');
  await expect(contents(page).last()).toHaveText('Sort 1'); expect(await contents(page).count()).toBeLessThanOrEqual(50);
  await order.selectOption('posted-oldest'); await expect(page.locator('.post-feed')).toHaveAttribute('data-start', '0');
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await page.evaluate(async () => { const path = '/src/db.ts'; await (await import(path)).db.settings.put({ key: 'language', value: 'en' }); });
  await expect(order.locator('option[value="posted-newest"]')).toHaveText('Newest post first');
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const source of ['bookmarks', 'likes'] as const) test(`local ${source}: date and file orders retain unknowns, preserve backup content and keep a 50-post window`, async ({ page }) => {
  await page.goto(pathToFileURL(resolve('local-dist/xbookmarkshelf-local.html')).href);
  await page.getByRole('button', { name: '新しく作る', exact: true }).click();
  await page.locator('input[multiple]').setInputFiles(input(fixture(source)));
  const order = orderControl(page);
  await expect(contents(page)).toHaveText(['Sort 1', 'Sort 2', 'Sort 3', 'Sort 4', 'Sort 5', 'Sort 6']);
  await order.selectOption('posted-newest'); await expect(contents(page)).toHaveText(['Sort 2', 'Sort 4', 'Sort 3', 'Sort 6', 'Sort 1', 'Sort 5']);
  await order.selectOption('posted-oldest'); await expect(contents(page)).toHaveText(['Sort 6', 'Sort 3', 'Sort 2', 'Sort 4', 'Sort 1', 'Sort 5']);
  await page.getByRole('searchbox').fill('Sort 1'); await expect(contents(page)).toHaveText(['Sort 1']);
  await page.getByRole('searchbox').fill(''); await order.selectOption('reverse'); await expect(contents(page)).toHaveText(['Sort 6', 'Sort 5', 'Sort 4', 'Sort 3', 'Sort 2', 'Sort 1']);
  await order.selectOption('original'); await expect(contents(page)).toHaveText(['Sort 1', 'Sort 2', 'Sort 3', 'Sort 4', 'Sort 5', 'Sort 6']);
  await page.getByRole('button', { name: 'バックアップ・取り込み', exact: true }).click();
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: '管理JSONをバックアップ', exact: true }).click();
  const downloaded = await pending; const saved = JSON.parse(await readFile((await downloaded.path())!, 'utf8'));
  expect(saved.libraries[source].posts.map((post: { postId: string; postedAt: string | null }) => [post.postId, post.postedAt])).toEqual(fixture(source).posts.map(post => [post.postId, post.postedAt]));
  await page.getByRole('button', { name: source === 'likes' ? 'すべてのいいね' : 'すべてのブックマーク', exact: false }).click();
  await page.locator('input[multiple]').setInputFiles(input(fixture(source, 120)));
  await expect(page.locator('.toolbar [role="status"]')).toContainText('120');
  await order.selectOption('posted-newest'); await expect(contents(page)).toHaveCount(50);
  await expect(order).toHaveValue('posted-newest');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(contents(page).last()).toHaveText('Sort 119'); expect(await contents(page).count()).toBeLessThanOrEqual(50);
  await order.selectOption('posted-oldest'); await expect(page.locator('.post-feed')).toHaveAttribute('data-start', '0');
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await page.getByRole('button', { name: '設定', exact: true }).click(); await page.getByLabel('言語', { exact: true }).selectOption('en');
  await page.getByRole('button', { name: source === 'likes' ? 'All likes' : 'All bookmarks', exact: false }).click();
  await expect(order.locator('option[value="posted-newest"]')).toHaveText('Newest post first');
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
