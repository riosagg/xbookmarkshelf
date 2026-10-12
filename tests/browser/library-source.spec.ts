import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

async function seed(page: Page) {
  await page.goto('/library.html');
  await page.evaluate(async () => {
    const path = '/src/db.ts'; const { db, likesDB } = await import(path);
    const date = '2026-10-10T08:00:00.000Z';
    await db.settings.bulkPut([{ key: 'theme', value: 'dark' }, { key: 'previews', value: true }]);
    for (const store of [db, likesDB]) {
      await store.settings.put({ key: 'accounts', value: [{ id: 'same', handle: 'sample' }] });
      await store.tags.put({ id: 'same-mark', accountId: 'same', name: store.source === 'likes' ? 'いいね分類' : 'ブック分類', mark: 'heart', markOrder: 0 });
      await store.posts.put({ accountId: 'same', postId: '1', authorName: 'Synthetic', authorHandle: 'test_author', text: `${store.source} 合成本文`, url: 'https://x.com/test_author/status/1', partial: true,
        postedAt: date, observedAt: date, firstImportedAt: date, lastImportedAt: date, media: [] });
    }
  });
  await page.reload(); await expect(page.locator('.card-grid .post-card')).toHaveCount(1);
}
async function switchLikes(page: Page) { await page.getByRole('group', { name: 'ライブラリ切替', exact: true }).getByRole('button', { name: 'いいね', exact: true }).click(); }
async function manage(page: Page, name: string) { await page.getByRole('navigation', { name: '管理', exact: true }).getByRole('button', { name, exact: true }).click(); }

test('switches separate posts, marks and read states and retains source/shared settings on reload', async ({ page }) => {
  await seed(page); await switchLikes(page);
  await expect(page.getByRole('heading', { name: 'すべてのいいね', exact: true })).toBeVisible();
  const card = page.locator('.card-grid .post-card'); await expect(card.locator('summary')).toHaveText('likes 合成本文');
  await card.getByRole('button', { name: 'いいね分類のマーク', exact: true }).click();
  await card.locator('summary').click(); await page.getByRole('button', { name: '詳細を閉じる', exact: true }).click();
  await expect(card.getByRole('button', { name: '既読 ✓', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(card.locator('.tag-chips')).toContainText('いいね分類');
  await page.reload(); await expect(card.locator('summary')).toHaveText('likes 合成本文');
  await manage(page, '設定'); await expect(page.getByLabel('画像プレビューを表示')).toBeChecked();
  await page.getByRole('group', { name: 'ライブラリ切替', exact: true }).getByRole('button', { name: 'ブックマーク', exact: true }).click();
  await expect(card.locator('summary')).toHaveText('bookmarks 合成本文');
  await expect(card.getByRole('button', { name: '未読', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(card.locator('.tag-chips')).toBeEmpty();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
test('exports Likes only, rejects opposite JSON, restores locally and deletes only Likes', async ({ page }) => {
  await seed(page); await switchLikes(page); await manage(page, 'バックアップ');
  const download = page.waitForEvent('download'); await page.getByRole('region', { name: '投稿のJSONバックアップ' }).getByRole('button', { name: '全件JSONバックアップ', exact: true }).click();
  const file = await download; expect(file.suggestedFilename()).toContain('xbookmarkshelf-likes-');
  const bytes = await readFile((await file.path())!); const backup = JSON.parse(bytes.toString());
  expect(backup.format).toBe('xbookmarkshelf-likes'); expect(backup.posts[0].text).toBe('likes 合成本文');
  await page.getByLabel('復元するJSON', { exact: true }).setInputFiles({ name: 'wrong-source.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...backup, format: 'x-bookmark-library', formatVersion: 2 })) });
  await expect(page.getByRole('alert')).toContainText('いいね'); await expect(page.locator('.restore-preview')).toHaveCount(0);
  await manage(page, '設定'); await page.getByRole('button', { name: '投稿データを全削除', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '削除する', exact: true }).click();
  await expect(page.getByTestId('saved-post-count')).toHaveText('0件');
  const counts = await page.evaluate(async () => { const path = '/src/db.ts'; const { db, likesDB } = await import(path); return [await db.posts.count(), await likesDB.posts.count(), await likesDB.tags.count()]; });
  expect(counts).toEqual([1, 0, 1]);
  await manage(page, 'バックアップ'); await page.getByLabel('復元するJSON', { exact: true }).setInputFiles({ name: 'likes.json', mimeType: 'application/json', buffer: bytes });
  await page.getByRole('button', { name: '検証済みJSONを復元', exact: true }).click(); await expect(page.getByRole('status')).toContainText('新規1件');
  await page.goto(pathToFileURL(resolve('local-dist/xbookmarkshelf-local.html')).href); await page.getByRole('button', { name: '新しく作る', exact: true }).click();
  await page.locator('input[multiple]').setInputFiles({ name: 'likes.json', mimeType: 'application/json', buffer: bytes });
  await expect(page.getByRole('heading', { name: 'すべてのいいね', exact: true })).toBeVisible();
  await expect(page.locator('.card-grid .post-card')).toContainText('likes 合成本文');
});
test('English source switching works at narrow width with long marks and common settings', async ({ page }) => {
  await seed(page); await page.evaluate(async () => { const path = '/src/db.ts'; const { db, likesDB } = await import(path); await db.settings.put({ key: 'language', value: 'en' }); await likesDB.tags.update('same-mark', { name: 'LongMark'.repeat(12) }); });
  await page.reload(); await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('group', { name: 'Switch library' }).getByRole('button', { name: 'Likes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'All likes', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('navigation', { name: 'Manage', exact: true }).getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Show image previews')).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
