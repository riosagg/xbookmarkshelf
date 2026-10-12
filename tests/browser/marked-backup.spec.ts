import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function seed(page: Page) {
  await page.goto('/library.html');
  await page.evaluate(async () => {
    const path = '/src/db.ts'; const { db } = await import(path);
    await db.settings.bulkPut([{ key: 'accounts', value: [{ id: 'a', handle: 'sample_a' }, { id: 'b', handle: 'sample_b' }] }, { key: 'language', value: 'ja' }, { key: 'theme', value: 'dark' }]);
    await db.tags.bulkPut([{ id: 'target', accountId: 'a', name: '同じマーク', mark: 'book', markOrder: 0 }, { id: 'other', accountId: 'b', name: '同じマーク', mark: 'book', markOrder: 0 }, { id: 'also', accountId: 'a', name: '別のマーク', mark: 'star', markOrder: 1 }, { id: 'tag', accountId: 'a', name: '通常タグ' }, { id: 'empty', accountId: 'a', name: '空のマーク', mark: 'heart', markOrder: 2 }]);
    for (const [accountId, postId] of [['a', '1'], ['a', '2'], ['b', '1']]) {
      const date = '2026-10-10T08:00:00.000Z';
      await db.posts.put({ accountId, postId, authorName: 'Synthetic', authorHandle: 'synthetic', text: `合成 ${accountId}/${postId}`, url: `https://x.com/synthetic/status/${postId}`, partial: true, postedAt: date, observedAt: date, firstImportedAt: date, lastImportedAt: date, media: [{ kind: 'image', url: 'https://pbs.twimg.com/media/synthetic-mark.jpg' }] });
      await db.userStates.put({ accountId, postId, read: true, favorite: true });
    }
    await db.postTags.bulkPut([{ accountId: 'a', postId: '1', tagId: 'target' }, { accountId: 'a', postId: '1', tagId: 'also' }, { accountId: 'a', postId: '1', tagId: 'tag' }, { accountId: 'b', postId: '1', tagId: 'other' }]);
  });
  await page.reload(); await expect(page.locator('.card-grid .post-card')).toHaveCount(3);
  await page.getByRole('button', { name: 'バックアップ', exact: true }).click();
}
async function snapshot(page: Page) { return page.evaluate(async () => { const path = '/src/db.ts'; const { db } = await import(path); return Promise.all(db.tables.map(async (table: { name: string; toArray(): Promise<unknown[]> }) => [table.name, await table.toArray()])); }); }
test('mark backup shows exact scope, downloads complete dependencies and restores using the existing JSON UI', async ({ page }) => {
  await seed(page); const before = await snapshot(page);
  const panel = page.getByRole('region', { name: '投稿のJSONバックアップ', exact: true });
  await expect(panel).toContainText('3件が対象です');
  await expect(panel.getByRole('option', { name: '同じマーク · @sample_a', exact: true })).toHaveCount(1);
  await expect(panel.getByRole('option', { name: '同じマーク · @sample_b', exact: true })).toHaveCount(1);
  await panel.getByLabel('バックアップ対象', { exact: true }).selectOption('mark:target');
  await expect(panel).toContainText('1件が対象です');
  const download = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'このマークの投稿をバックアップ', exact: true }).click();
  const file = await download; expect(file.suggestedFilename()).toContain('mark-同じマーク-');
  const bytes = await readFile((await file.path())!); const backup = JSON.parse(bytes.toString('utf8'));
  expect(backup.posts.map((post: { accountId: string; postId: string }) => [post.accountId, post.postId])).toEqual([['a', '1']]);
  expect(backup.tags.map((tag: { id: string }) => tag.id).sort()).toEqual(['also', 'tag', 'target']);
  expect(backup.userStates).toHaveLength(1); expect(backup.accounts).toHaveLength(1); expect(backup.postTags).toHaveLength(3);
  expect(await snapshot(page)).toEqual(before);
  await expect(page.getByRole('status')).toContainText('「同じマーク」の1件');
  await page.evaluate(async () => { const path = '/src/db.ts'; const { db } = await import(path); await db.transaction('rw', db.tables, async () => { for (const table of db.tables) await table.clear(); }); });
  await page.getByLabel('復元するJSON', { exact: true }).setInputFiles({ name: 'synthetic-mark-backup.json', mimeType: 'application/json', buffer: bytes });
  await expect(page.locator('.restore-preview')).toContainText('1件 · 1アカウント');
  await page.getByRole('button', { name: '検証済みJSONを復元', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('新規1件');
  await page.getByRole('navigation', { name: 'ライブラリ', exact: true }).getByRole('button', { name: /^すべてのブックマーク/ }).click();
  await expect(page.locator('.card-grid .post-card')).toHaveCount(1);
  const card = page.locator('.card-grid .post-card'); await expect(card).toContainText('通常タグ'); await expect(card).toContainText('別のマーク'); await expect(card.getByRole('button', { name: '既読 ✓', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
test('empty and disappearing marks cannot fall back to a full backup', async ({ page }) => {
  await seed(page); const panel = page.getByRole('region', { name: '投稿のJSONバックアップ', exact: true });
  await panel.getByLabel('バックアップ対象', { exact: true }).selectOption('mark:empty');
  await expect(panel).toContainText('0件が対象です');
  await expect(panel.getByRole('button', { name: 'このマークの投稿をバックアップ', exact: true })).toBeDisabled();
  await panel.getByLabel('バックアップ対象', { exact: true }).selectOption('mark:target'); await expect(panel).toContainText('1件が対象です');
  await page.evaluate(async () => { const path = '/src/db.ts'; await (await import(path)).db.tags.update('target', { mark: undefined, markOrder: undefined }); });
  await expect(panel).toContainText('対象のマークが見つかりません');
  await expect(panel.getByRole('button', { name: 'このマークの投稿をバックアップ', exact: true })).toBeDisabled();
  expect(await panel.getByLabel('バックアップ対象', { exact: true }).inputValue()).toBe('mark:target');
  await panel.getByLabel('バックアップ対象', { exact: true }).selectOption('all'); await expect(panel).toContainText('3件が対象です');
  const download = page.waitForEvent('download'); await panel.getByRole('button', { name: '全件JSONバックアップ', exact: true }).click();
  const file = await download; expect(JSON.parse(await readFile((await file.path())!, 'utf8')).posts).toHaveLength(3);
});
test('English mark export works offline and contains long or hostile names on a narrow screen', async ({ page, context }) => {
  await seed(page); const longName = '<script>/../' + '長いマーク'.repeat(17);
  await page.evaluate(async name => { const path = '/src/db.ts'; const { db } = await import(path); await db.tags.update('target', { name }); await db.settings.put({ key: 'language', value: 'en' }); }, longName);
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = page.getByRole('region', { name: 'Post backup as JSON', exact: true });
  await panel.getByLabel('Backup scope', { exact: true }).selectOption('mark:target'); await expect(panel).toContainText('1 posts to export');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.setOffline(true);
  const download = page.waitForEvent('download'); await panel.getByRole('button', { name: 'Back up posts with this mark', exact: true }).click();
  const file = await download; expect(file.suggestedFilename()).not.toMatch(/[<>:"/\\|?*]/);
  expect(JSON.parse(await readFile((await file.path())!, 'utf8')).posts).toHaveLength(1);
  await expect(page.getByRole('status')).toContainText(longName);
  await expect(page.locator('script[src*="../"]')).toHaveCount(0);
});
