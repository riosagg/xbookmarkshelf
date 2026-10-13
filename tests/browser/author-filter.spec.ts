import { expect, test } from './fixtures';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { authorBackup } from '../viewer-fixtures';
import { emptyLocalLibrary, mergeLocalImport, parseLocalImport } from '../../src/local-data';

for (const edition of ['extension', 'local'] as const) for (const source of ['bookmarks', 'likes'] as const) {
  test(`${edition} ${source}: @handles match exactly while names/text/quotes and plain partial searches stay separate`, async ({ page }) => {
    const value = authorBackup();
    if (edition === 'extension') {
      await page.goto(`/library.html?source=${source}`);
      await page.evaluate(async ({ source, value }) => {
        const path = '/src/db.ts'; const { db, storeForSource } = await import(path); const store = storeForSource(source);
        await db.settings.bulkPut([{ key: 'language', value: 'ja' }, { key: 'previews', value: false }]);
        await store.settings.put({ key: 'accounts', value: value.accounts });
        await store.posts.bulkPut(value.posts); await store.tags.bulkPut(value.tags); await store.postTags.bulkPut(value.postTags); await store.userStates.bulkPut(value.userStates);
      }, { source, value });
      await page.reload();
    } else {
      const { library } = mergeLocalImport(emptyLocalLibrary(), parseLocalImport(JSON.stringify(value)));
      library.libraries.likes = structuredClone(library.libraries.bookmarks);
      await page.goto(pathToFileURL(resolve('local-dist/xbookmarkshelf-local.html')).href);
      await page.locator('input[multiple]').setInputFiles({ name: 'synthetic-authors.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(library)) });
      await expect(page.locator('.card-grid .post-card')).toHaveCount(6);
      await page.getByRole('button', { name: source === 'bookmarks' ? 'ブックマーク' : 'いいね', exact: true }).click();
      await page.locator('.filter-panel summary').click();
    }
    const cards = page.locator('.card-grid .post-card'); const author = page.getByLabel('投稿者', { exact: true });
    await expect(cards).toHaveCount(6);
    await author.fill('x'); await expect(cards).toHaveCount(5);
    for (const input of ['@x', '@X', '  @x  ', '　＠Ｘ　']) {
      await author.fill(input); await expect(cards).toHaveCount(2);
      await expect(cards).toContainText(['Exact Author', 'Exact Author']);
    }
    await author.fill('@x_extra'); await expect(cards).toHaveCount(1); await expect(cards).toContainText('Extra Author');
    await author.fill('display'); await expect(cards).toHaveCount(1); await expect(cards).toContainText('Display x');
    for (const input of ['@Display x', '@', '@missing', '@@x']) { await author.fill(input); await expect(cards).toHaveCount(0); }
    await author.fill('@x'); await page.getByLabel('アカウント', { exact: true }).selectOption('a'); await expect(cards).toHaveCount(1);
    await page.getByLabel('マーク・タグ', { exact: true }).selectOption(edition === 'extension' ? 'tag:mark-a' : 'mark-a');
    await page.getByLabel(edition === 'extension' ? '既読状態' : '既読', { exact: true }).selectOption('read');
    await page.getByLabel('メディア', { exact: true }).selectOption('without');
    await page.getByLabel('投稿日（開始）', { exact: true }).fill('2026-10-10');
    await expect(cards).toHaveCount(1); await expect(cards).toContainText('保存した投稿');
    await page.getByRole('button', { name: '条件をリセット', exact: true }).click(); await expect(cards).toHaveCount(6);
    const search = page.getByRole('searchbox', { name: edition === 'extension' ? '本文・投稿者を検索' : '本文・投稿者・URLを検索', exact: true });
    await search.fill('@x'); await expect(cards).toHaveCount(2);
    await expect(cards).toContainText(['本文に @x', '本文に @x']); await search.fill(''); await expect(cards).toHaveCount(6);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '設定', exact: true }).click(); await page.getByLabel('言語', { exact: true }).selectOption('en');
    await page.getByRole('button', { name: source === 'bookmarks' ? /^All bookmarks/ : /^All likes/ }).click();
    if (edition === 'local') await page.locator('.filter-panel summary').click();
    await page.getByLabel('Author', { exact: true }).fill('@x'); await expect(cards).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/${edition}-${source}-author-filter.png` });
  });
}
