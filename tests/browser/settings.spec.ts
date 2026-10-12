import { expect, test } from './fixtures';
import { readFile } from 'node:fs/promises';

async function seed(page: import('@playwright/test').Page) {
  await page.goto('/library.html');
  await page.evaluate(async () => {
    const path = '/src/db.ts'; const { db } = await import(path);
    const date = '2026-10-11T00:00:00.000Z';
    await db.settings.bulkPut([{ key: 'accounts', value: [{ id: 'synthetic-account', handle: 'synthetic_user' }] }, { key: 'theme', value: 'light' }, { key: 'columns', value: 4 }, { key: 'layout', value: 'grid' }, { key: 'previews', value: false }]);
    await db.posts.put({ accountId: 'synthetic-account', postId: '1', authorHandle: 'synthetic_author', authorName: '確認用の投稿者', text: '設定を変えても、この投稿と分類は残ります。', url: 'https://x.com/synthetic_author/status/1', partial: true, postedAt: null, observedAt: date, firstImportedAt: date, lastImportedAt: date, media: [{ kind: 'image', url: 'https://pbs.twimg.com/media/synthetic.jpg' }] });
    await db.tags.put({ id: 'synthetic-mark', accountId: 'synthetic-account', name: '読書', mark: 'book' });
    await db.postTags.put({ accountId: 'synthetic-account', postId: '1', tagId: 'synthetic-mark' });
    await db.userStates.put({ accountId: 'synthetic-account', postId: '1', read: true, favorite: true });
  });
  await page.reload();
  await expect(page.locator('.post-card')).toHaveCount(1);
  await page.getByRole('navigation', { name: '管理', exact: true }).getByRole('button', { name: '設定', exact: true }).click();
}
const settingsInput = (value: unknown, name = 'settings.json') => ({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });

test('settings export and confirmed import preserve posts and classification and persist all display preferences', async ({ page }) => {
  let images = 0;
  await page.route('https://pbs.twimg.com/**', route => { images++; return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><rect width="30" height="30" fill="green"/></svg>' }); });
  await seed(page);
  const section = page.getByRole('region', { name: '設定ファイル', exact: true });
  const before = await page.evaluate(async () => { const path = '/src/backup.ts'; return (await import(path)).createBackup(); });
  const download = page.waitForEvent('download');
  await section.getByRole('button', { name: '設定をエクスポート', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^xbookmarkshelf-settings-\d{4}-\d{2}-\d{2}\.json$/);
  const settings = JSON.parse(await readFile((await file.path())!, 'utf8'));
  expect(Object.keys(settings).sort()).toEqual(['exportedAt', 'format', 'formatVersion', 'settings']);
  expect(settings.settings).toEqual({ theme: 'light', columns: 4, layout: 'grid', previews: false, language: 'system' });
  const incoming = { ...settings, settings: { theme: 'dark', columns: 2, layout: 'list', previews: true } };
  const input = section.getByLabel('設定JSONを選択', { exact: true });
  await input.setInputFiles(settingsInput(incoming));
  await expect(section.getByText('適用する設定', { exact: true })).toBeVisible();
  await expect(section.locator('.settings-preview')).toContainText('2列');
  await expect(section.locator('.settings-preview')).toContainText('リスト');
  await expect(section.getByText(/適用すると.*pbs.twimg.com/)).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByLabel('画像プレビューを表示')).not.toBeChecked();
  expect(images).toBe(0);
  await section.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await expect(section.getByText('適用する設定', { exact: true })).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await input.setInputFiles(settingsInput(incoming, '設定ファイル'.repeat(28) + '.json'));
  await section.getByRole('button', { name: 'この設定を適用', exact: true }).click();
  await expect(section.getByRole('status')).toContainText('設定を適用しました');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByLabel('画像プレビューを表示')).toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem('xbookmarkshelf.theme'))).toBe('dark');
  const after = await page.evaluate(async () => { const path = '/src/backup.ts'; return (await import(path)).createBackup(); });
  expect({ ...after, exportedAt: before.exportedAt }).toEqual(before);
  expect(images).toBe(0);
  await page.setViewportSize({ width: 1200, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: 'test-results/library-settings-transfer.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await input.setInputFiles(settingsInput(incoming, '設定ファイル'.repeat(28) + '.json'));
  await expect(section.getByText('適用する設定', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'リスト表示', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.getByLabel('表示列数', { exact: true }).inputValue()).toBe('2');
  await expect(page.locator('.post-card')).toHaveCount(1);
  await expect(page.locator('.post-card').getByRole('button', { name: '既読 ✓', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.post-card').getByRole('button', { name: '読書のマーク', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => images).toBe(1);
});

test('settings import refuses invalid and oversized files and each page rejects the other file type', async ({ page }) => {
  await seed(page);
  const section = page.getByRole('region', { name: '設定ファイル', exact: true });
  const input = section.getByLabel('設定JSONを選択', { exact: true });
  const base = await page.evaluate(async () => { const path = '/src/settings-backup.ts'; return (await import(path)).createSettingsBackup(); });
  const before = await page.evaluate(async () => { const path = '/src/db.ts'; return (await import(path)).db.settings.toArray(); });
  const posts = await page.evaluate(async () => { const path = '/src/backup.ts'; return (await import(path)).createBackup(); });
  const invalid = [posts, { ...base, formatVersion: 99 }, { ...base, settings: { ...base.settings, columns: 6 } }, { ...base, settings: { ...base.settings, accounts: [] } }];
  for (const value of invalid) {
    await input.setInputFiles(settingsInput(value));
    await expect(section.getByRole('alert')).toBeVisible();
    await expect(section.getByRole('button', { name: 'この設定を適用', exact: true })).toHaveCount(0);
    expect(await page.evaluate(async () => { const path = '/src/db.ts'; return (await import(path)).db.settings.toArray(); })).toEqual(before);
  }
  await input.setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await expect(section.getByRole('alert')).toContainText('読み込めません');
  await input.setInputFiles({ name: 'large.json', mimeType: 'application/json', buffer: Buffer.alloc(64 * 1024 + 1, 32) });
  await expect(section.getByRole('alert')).toContainText('64KB');
  await page.getByRole('navigation', { name: '管理', exact: true }).getByRole('button', { name: 'バックアップ', exact: true }).click();
  await page.getByLabel('復元するJSON', { exact: true }).setInputFiles(settingsInput(base));
  await expect(page.getByRole('alert')).toContainText('対応するJSONバックアップではありません');
  await expect(page.getByRole('button', { name: '検証済みJSONを復元', exact: true })).toHaveCount(0);
  expect(await page.evaluate(async () => { const path = '/src/db.ts'; return (await import(path)).db.settings.toArray(); })).toEqual(before);
});
