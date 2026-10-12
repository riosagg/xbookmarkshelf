import { expect, test, type Page } from './fixtures';
import { readFile } from 'node:fs/promises';

async function seed(page: Page, count = 4) {
  await page.goto('/library.html');
  await page.evaluate(async count => {
    const path = '/src/db.ts'; const { db } = await import(path);
    await db.settings.bulkPut([{ key: 'accounts', value: [{ id: 'a', handle: 'sample_a' }, { id: 'b', handle: 'sample_b' }] }, { key: 'theme', value: 'dark' }, { key: 'language', value: 'ja' }, { key: 'columns', value: 5 }]);
    await db.tags.put({ id: 'mark', accountId: 'a', name: '保存するマーク', mark: 'book', markOrder: 0 });
    for (let index = 0; index < count; index++) {
      const accountId = index === 1 ? 'b' : 'a'; const postId = index === 1 ? '1' : String(index + 1);
      const date = `2026-10-10T08:${String(index).padStart(2, '0')}:00.000Z`;
      const media = [{ kind: 'image', url: 'https://pbs.twimg.com/media/synthetic-delete.jpg' }];
      await db.posts.put({ accountId, postId, authorName: `Synthetic ${index}`, authorHandle: 'synthetic', text: `合成本文 ${index} ${'長い本文'.repeat(50)}`, url: `https://x.com/synthetic/status/${postId}`, partial: true, postedAt: date, observedAt: date, firstImportedAt: date, lastImportedAt: date, media });
      await db.media.put({ accountId, postId, index: 0, ...media[0] });
      await db.userStates.put({ accountId, postId, read: false, favorite: true });
      if (accountId === 'a') await db.postTags.put({ accountId, postId, tagId: 'mark' });
    }
  }, count);
  await page.reload(); await expect(page.locator('.card-grid .post-card')).toHaveCount(Math.min(50, count));
}
async function snapshot(page: Page) {
  return page.evaluate(async () => { const path = '/src/db.ts'; const { db } = await import(path); return Promise.all(db.tables.map(async (table: { name: string; toArray(): Promise<unknown[]> }) => [table.name, await table.toArray()])); });
}

test('selected deletion confirms exact keys, cancels safely and offers a recoverable backup', async ({ page }) => {
  await seed(page);
  const original = await snapshot(page);
  await page.getByRole('button', { name: '投稿を選択', exact: true }).click();
  await page.locator('.post-card').filter({ hasText: 'Synthetic 0' }).getByRole('checkbox').check();
  await page.getByRole('button', { name: '選択した投稿を削除', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '選択した投稿を削除', exact: true });
  await expect(dialog).toContainText('選択した1件の投稿を削除します。');
  await expect(dialog.getByRole('button', { name: 'キャンセル', exact: true })).toBeFocused();
  expect(await snapshot(page)).toEqual(original);
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: '選択した投稿を削除', exact: true }).click();
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '全件JSONバックアップ', exact: true }).click();
  const file = await download; const backup = JSON.parse(await readFile((await file.path())!, 'utf8'));
  expect(backup.posts).toHaveLength(4); expect(backup.userStates).toHaveLength(4);
  await expect(dialog.getByRole('status')).toContainText('JSONを書き出しました');
  await dialog.getByRole('button', { name: '削除する', exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(page.locator('.card-grid .post-card')).toHaveCount(3);
  await expect(page.getByRole('status')).toContainText('1件の投稿を削除しました');
  const after = await snapshot(page);
  for (const table of ['posts', 'userStates', 'media', 'postTags']) {
    expect(after.find(row => row[0] === table)![1]).toEqual((original.find(row => row[0] === table)![1] as { accountId: string; postId: string }[]).filter(row => !(row.accountId === 'a' && row.postId === '1')));
  }
  for (const table of ['tags', 'settings', 'importRuns', 'savedFilters']) expect(after.find(row => row[0] === table)).toEqual(original.find(row => row[0] === table));
});

test('settings show all-account counts and estimated usage; all deletion preserves definitions and preferences', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator.storage, 'estimate', { configurable: true, value: async () => ({ usage: 43008, quota: 999999999 }) }); });
  await seed(page); const before = await snapshot(page);
  await page.getByLabel('アカウント', { exact: true }).selectOption('a');
  await page.getByRole('button', { name: '設定', exact: true }).click();
  const panel = page.getByRole('region', { name: '投稿データの管理', exact: true });
  await expect(panel.getByTestId('saved-post-count')).toHaveText('4件');
  await expect(panel.getByTestId('storage-usage')).toHaveText('42 KiB');
  await panel.getByRole('button', { name: '投稿データを全削除', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '投稿データを全削除', exact: true });
  await expect(dialog).toContainText('全アカウントの4件');
  await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
  await panel.getByRole('button', { name: '投稿データを全削除', exact: true }).click();
  await dialog.getByRole('button', { name: '削除する', exact: true }).click();
  await expect(panel.getByTestId('saved-post-count')).toHaveText('0件');
  await expect(panel.getByRole('button', { name: '投稿データを全削除', exact: true })).toBeDisabled();
  const after = await snapshot(page);
  for (const table of ['posts', 'userStates', 'media', 'postTags']) expect(after.find(row => row[0] === table)![1]).toEqual([]);
  for (const table of ['tags', 'settings', 'importRuns', 'savedFilters']) expect(after.find(row => row[0] === table)).toEqual(before.find(row => row[0] === table));
  await page.reload(); await page.getByRole('button', { name: '設定', exact: true }).click();
  await expect(panel.getByTestId('saved-post-count')).toHaveText('0件');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'マークを管理', exact: true }).click(); await expect(page.locator('.mark-directory')).toContainText('保存するマーク');
});

test('all deletion rejects data changes or a newly started import after confirmation', async ({ page }) => {
  await seed(page); await page.getByRole('button', { name: '設定', exact: true }).click();
  const button = page.getByRole('button', { name: '投稿データを全削除', exact: true });
  await button.click();
  const dialog = page.getByRole('dialog', { name: '投稿データを全削除', exact: true });
  await page.evaluate(async () => { const path = '/src/db.ts'; const { db } = await import(path); const post = await db.posts.get(['a', '1']); await db.posts.put({ ...post, postId: '99', url: 'https://x.com/synthetic/status/99' }); });
  const before = await snapshot(page);
  await dialog.getByRole('button', { name: '削除する', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('選び直してください');
  expect(await snapshot(page)).toEqual(before);
  await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click(); await button.click();
  await page.evaluate(async () => { const path = '/src/db.ts'; const { db, newRun } = await import(path); const model = '/src/model.ts'; const { DEFAULT_OPTIONS } = await import(model); await db.importRuns.put(newRun({ id: 'a', handle: 'sample_a' }, 1, 'synthetic', DEFAULT_OPTIONS)); });
  const active = await snapshot(page);
  await dialog.getByRole('button', { name: '削除する', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('取り込みを停止');
  expect(await snapshot(page)).toEqual(active);
  await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await expect(button).toBeDisabled();
});

test('selection follows the rendered window, resets with filters and deletion adjusts a shortened feed', async ({ page }) => {
  await seed(page, 55);
  await page.getByRole('button', { name: '投稿を選択', exact: true }).click();
  await page.getByLabel('表示中をすべて選択', { exact: true }).check();
  await expect(page.locator('.selection-toolbar')).toContainText('50件選択中');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(async () => Number(await page.locator('.post-feed').getAttribute('data-start'))).toBeGreaterThan(0);
  await expect(page.locator('.selection-toolbar')).toContainText('0件選択中');
  await page.getByLabel('本文・投稿者を検索', { exact: true }).fill('合成本文');
  await expect(page.locator('.post-feed')).toHaveAttribute('data-start', '0');
  await expect(page.locator('.card-grid .post-card')).toHaveCount(50);
  for (let i = 0; i < 5; i++) await page.locator('.post-selection').nth(i).check();
  await page.getByRole('button', { name: '選択した投稿を削除', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '削除する', exact: true }).click();
  await expect(page.locator('.card-grid .post-card')).toHaveCount(50);
  await expect(page.locator('.page-heading')).toContainText('50件のブックマーク');
  await expect(page.locator('.selection-toolbar')).toContainText('0件選択中');
  await expect(page.locator('.pagination')).toHaveCount(0);
});

test('English storage controls handle estimate failures, narrow screens and offline deletion', async ({ page, context }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator.storage, 'estimate', { configurable: true, value: async () => { throw new Error('Synthetic unavailable'); } }); });
  await seed(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByLabel('言語', { exact: true }).selectOption('en');
  const panel = page.getByRole('region', { name: 'Manage post data', exact: true });
  await expect(panel.getByTestId('storage-usage')).toHaveText('Unavailable');
  await panel.getByRole('button', { name: 'Refresh storage usage', exact: true }).click();
  await expect(panel.getByTestId('storage-usage')).toHaveText('Unavailable');
  await context.setOffline(true);
  await panel.getByRole('button', { name: 'Delete all post data', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete all post data', exact: true });
  await expect(dialog).toContainText('Delete 4 posts from all accounts.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Delete posts', exact: true }).click();
  await expect(panel.getByTestId('saved-post-count')).toHaveText('0 posts');
  await expect(page.getByRole('status')).toContainText('Deleted 4 posts');
});

test('saving a stale tag editor cannot recreate assignments after another tab deletes the post', async ({ page }) => {
  await seed(page);
  const card = page.locator('.card-grid .post-card').filter({ hasText: 'Synthetic 0' });
  await card.getByRole('button', { name: 'タグを編集', exact: true }).click();
  await card.getByLabel('syntheticのタグ', { exact: true }).fill('作成しないタグ');
  await page.evaluate(async () => { const path = '/src/post-data.ts'; const { deletePosts, prepareDeletion } = await import(path); await deletePosts(await prepareDeletion('selected', [['a', '1']])); });
  await card.getByRole('button', { name: 'タグを保存', exact: true }).click();
  await expect(card.getByRole('alert')).toContainText('投稿が見つかりません');
  const after = await snapshot(page);
  expect((after.find(row => row[0] === 'postTags')![1] as { accountId: string; postId: string }[]).some(row => row.accountId === 'a' && row.postId === '1')).toBe(false);
  expect((after.find(row => row[0] === 'tags')![1] as { name: string }[]).some(row => row.name === '作成しないタグ')).toBe(false);
});
