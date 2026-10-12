import { expect, test, type Page } from './fixtures';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { viewerBackup } from '../viewer-fixtures';
import { prepareBackupFiles } from '../../src/backup-parts';
import { parseViewerText } from '../../src/viewer-data';
const localUrl = pathToFileURL(resolve('local-dist/xbookmarkshelf-local.html')).href;
function quotedBackup() {
  const value = viewerBackup(); const post = value.posts[0]!; post.text = ''; post.media = [];
  post.quote = { postId: '456', authorHandle: 'quoted', authorName: 'Quoted author', url: 'https://x.com/quoted/status/456', postedAt: null,
    text: '<script>alert(1)</script> 引用を検索 ' + 'LongContinuousText'.repeat(400), media: [{ kind: 'image', url: 'https://pbs.twimg.com/media/quote.jpg' }] };
  return value;
}
async function images(page: Page) { await page.route('https://pbs.twimg.com/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="blue"/></svg>' })); }
test('extension and local library show quote-only content with attribution, safe text and narrow-screen search', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await images(page);
  await page.goto('/library.html');
  await page.evaluate(async value => {
    const module = '/src/db.ts'; const { db } = await import(module);
    await db.settings.bulkPut([{ key: 'accounts', value: value.accounts }, { key: 'language', value: 'ja' }, { key: 'previews', value: true }]); await db.posts.bulkPut(value.posts);
  }, quotedBackup()); await page.reload();
  await page.getByRole('searchbox', { name: '本文・投稿者を検索', exact: true }).fill('引用を検索');
  await expect(page.locator('.card-grid .post-card')).toHaveCount(1);
  await expect(page.locator('.quote-badge')).toHaveText('引用'); await expect(page.locator('.quote-heading')).toContainText('@quoted');
  await expect(page.locator('.quote-media img')).toHaveCount(1); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.quote-summary').click(); await expect(page.getByRole('dialog')).toContainText('<script>alert(1)</script>');
  await page.goto(localUrl); await page.locator('input[multiple]').setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(quotedBackup())) });
  await expect(page.locator('.card-grid .post-card')).toHaveCount(3); await expect(page.locator('.quote-badge')).toHaveText('引用');
  await page.getByRole('searchbox', { name: '本文・投稿者・URLを検索', exact: true }).fill('引用を検索');
  await expect(page.locator('.card-grid .post-card')).toHaveCount(1); await page.locator('.quote-summary').click();
  await expect(page.getByRole('dialog')).toContainText('Quoted author'); await expect(page.getByRole('dialog')).toContainText('<script>alert(1)</script>');
  await page.keyboard.press('Escape'); await page.getByRole('searchbox', { name: '本文・投稿者・URLを検索', exact: true }).fill('');
  await expect(page.locator('.card-grid .post-card')).toHaveCount(3);
  const card = page.locator('[data-post-key="a:2"]'); await card.locator('.media-next').click();
  await page.getByLabel('画像プレビュー', { exact: true }).check();
  await expect(card.locator('.card-media img')).toHaveAttribute('src', /synthetic-viewer-2/);
  await card.locator('.local-read').click(); await expect(card.locator('.card-media img')).toHaveAttribute('src', /synthetic-viewer-2/);
  await card.getByRole('button', { name: '資料のマーク', exact: true }).click(); await expect(card.locator('.card-media img')).toHaveAttribute('src', /synthetic-viewer-2/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('multi-file restore and local import reject missing parts and apply a complete set', async ({ page }) => {
  const value = viewerBackup(); value.posts.forEach(p => { p.text = '分割合成'.repeat(600); });
  const files = prepareBackupFiles(value, undefined, 18000).map(f => ({ name: f.name, mimeType: 'application/json', buffer: Buffer.from(f.text) })); expect(files.length).toBeGreaterThan(1);
  await page.goto('/library.html'); await page.getByRole('button', { name: 'バックアップ', exact: true }).click();
  await page.getByLabel('復元するJSON', { exact: true }).setInputFiles(files.slice(0, 1)); await expect(page.getByRole('alert')).toContainText('すべてのファイル');
  await expect(page.locator('.restore-preview')).toHaveCount(0);
  await page.getByLabel('復元するJSON', { exact: true }).setInputFiles(files); await expect(page.locator('.restore-preview')).toContainText('3件');
  await page.getByRole('button', { name: '検証済みJSONを復元', exact: true }).click(); await expect(page.getByRole('status')).toContainText('新規3件');
  await page.goto(localUrl); await page.locator('input[multiple]').setInputFiles(files.slice(0, 1)); await expect(page.getByRole('alert')).toContainText('全ファイル');
  await page.locator('input[multiple]').setInputFiles(files); await expect(page.locator('.card-grid .post-card')).toHaveCount(3);
});
test('oversized full backup offers all parts, verifies each download and does not claim completion inside delete confirmation', async ({ page }) => {
  await page.goto('/library.html');
  await page.evaluate(async () => {
    const module = '/src/db.ts'; const { db } = await import(module); const date = new Date().toISOString();
    await db.settings.put({ key: 'accounts', value: [{ id: 'a', handle: 'sample' }] });
    await db.posts.bulkPut(Array.from({ length: 430 }, (_, i) => ({ accountId: 'a', postId: String(i + 1), authorHandle: 'sample', authorName: 'Synthetic',
      text: 'x'.repeat(50000), url: `https://x.com/sample/status/${i + 1}`, partial: true, postedAt: null, observedAt: date, firstImportedAt: date, lastImportedAt: date, media: [] })));
  }); await page.reload(); await page.getByRole('button', { name: 'バックアップ', exact: true }).click();
  await page.getByRole('region', { name: '投稿のJSONバックアップ', exact: true }).getByRole('button', { name: '全件JSONバックアップ', exact: true }).click();
  await expect(page.locator('.backup-parts button')).toHaveCount(2); const downloads = [];
  for (let i = 0; i < 2; i++) { const waiting = page.waitForEvent('download'); await page.locator('.backup-parts button').nth(i).click(); const file = await waiting;
    const bytes = await readFile((await file.path())!); expect(bytes.length).toBeLessThanOrEqual(20 * 1024 * 1024); downloads.push(parseViewerText(bytes.toString()).posts.length); }
  expect(downloads.reduce((a, b) => a + b, 0)).toBe(430);
  await page.getByRole('button', { name: '設定', exact: true }).click(); await page.getByRole('button', { name: '投稿データを全削除', exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: '全件JSONバックアップ', exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(page.locator('.backup-parts button')).toHaveCount(2);
  await expect(page.getByTestId('saved-post-count')).toHaveText('430件');
});
