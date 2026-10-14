import { expect, test, type Page } from './fixtures';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { likesScript, viewerBackup } from '../viewer-fixtures';
import type { LocalLibrary } from '../../src/local-data';

const url = pathToFileURL(resolve('local-dist/xbookmarkshelf-local.html')).href;
async function start(page: Page) {
  await page.addInitScript(() => {
    const calls: string[] = []; Object.assign(window, { syntheticStorageCalls: calls });
    Storage.prototype.setItem = function () { calls.push('storage'); throw new Error('Synthetic storage guard'); };
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (name, version) { if (name !== 'xbookmarkshelf-local-session') { calls.push('idb'); throw new Error('Synthetic storage guard'); } return open.call(this, name, version); };
    if (typeof CacheStorage !== 'undefined') CacheStorage.prototype.open = function () { calls.push('cache'); throw new Error('Synthetic storage guard'); };
    const state = { contents: '', writes: 0, failure: '', cancel: false, delay: 0 };
    Object.assign(window, { syntheticFile: state });
    const handle = { kind: 'file', name: 'synthetic-library.json', async queryPermission() { return 'granted'; }, async getFile() { return new File([state.contents], handle.name); }, async createWritable() {
      if (state.failure === 'permission') throw new DOMException('Synthetic permission denial', 'NotAllowedError');
      let pending = ''; return { async write(text: string) { pending = text; if (state.delay) await new Promise(r => setTimeout(r, state.delay)); if (state.failure === 'write') throw new Error('Synthetic write failure'); },
        async close() { if (state.failure === 'close') throw new Error('Synthetic close failure'); state.contents = pending; state.writes++; }, async abort() {} };
    } };
    Object.assign(window, { async showSaveFilePicker() { if (state.cancel) throw new DOMException('Synthetic cancellation', 'AbortError'); return handle; }, async showOpenFilePicker() { if (state.cancel) throw new DOMException('Synthetic cancellation', 'AbortError'); return [handle]; } });
  });
  await page.goto(url); await expect(page.getByRole('heading', { name: 'ローカルライブラリ', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '新しく作る', exact: true })).toBeEnabled();
}
async function add(page: Page, text: string, name = 'synthetic-like.js') {
  await page.locator('input[multiple]').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await expect(page.locator('.local-save')).toBeEnabled();
}
async function savedText(page: Page) { return page.evaluate(() => (window as unknown as { syntheticFile: { contents: string } }).syntheticFile.contents); }
async function state(page: Page, values: object) { await page.evaluate(values => Object.assign((window as unknown as { syntheticFile: object }).syntheticFile, values), values); }
async function backup(page: Page) { await page.getByRole('button', { name: 'バックアップ・取り込み', exact: true }).click(); }
test('20,838 likes stay off browser storage, search/scroll offline and separate unknown media', async ({ page, context }) => {
  await context.setOffline(true); const requests: string[] = []; page.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
  await start(page); await add(page, likesScript(20838)); await expect(page.getByRole('heading', { name: 'すべてのいいね', exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(async () => Number(await page.locator('.post-feed').getAttribute('data-start'))).toBeGreaterThan(20000);
  expect(await page.locator('.card-grid .post-card').count()).toBeLessThanOrEqual(50);
  await expect(page.locator('.card-grid .post-card').last()).toContainText('合成');
  await page.evaluate(() => window.scrollTo(0, 0)); await expect(page.locator('.post-feed')).toHaveAttribute('data-start', '0');
  await expect(page.locator('.pagination')).toHaveCount(0);
  await page.getByRole('searchbox', { name: '本文・投稿者・URLを検索', exact: true }).fill('shelf 日本語'); await expect(page.locator('.card-grid .post-card')).toHaveCount(1);
  await page.getByRole('combobox', { name: 'メディア', exact: true }).selectOption('without'); await expect(page.locator('.card-grid .post-card')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'メディア', exact: true }).selectOption('unknown'); await expect(page.locator('.card-grid .post-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'ブックマーク', exact: true }).click(); await expect(page.locator('.card-grid .post-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'いいね', exact: true }).click(); await expect(page.locator('.card-grid .post-card')).toHaveCount(50);
  expect(requests).toEqual([]); expect(await page.evaluate(() => (window as unknown as { syntheticStorageCalls: string[] }).syntheticStorageCalls)).toEqual([]);
});
test('200,000 posts above 64 MiB open, classify, save and reopen; oversized files preserve the library', async ({ page, context }) => {
  test.setTimeout(90000); await context.setOffline(true); await start(page);
  const bytes = await page.evaluate(() => {
    const stamp = '2026-10-12T00:00:00.000Z';
    const collection = () => ({ accounts: [{ id: 'a', handle: 'synthetic' }], tags: [{ id: 'm', accountId: 'a', name: '容量', mark: 'star' as const, markOrder: 0 }], posts: [] as LocalLibrary['libraries']['likes']['posts'] });
    const lib: LocalLibrary = { format: 'xbookmarkshelf-local', formatVersion: 1, updatedAt: stamp, settings: { language: 'ja', theme: 'dark', columns: 3, layout: 'grid' }, libraries: { bookmarks: collection(), likes: collection() } };
    for (let i = 0; i < 200000; i++) {
      const postId = String(i % 100000 + 1); const source = i < 100000 ? 'bookmarks' : 'likes';
      lib.libraries[source].posts.push({ accountId: 'a', postId, authorHandle: 'synthetic', authorName: '合成投稿者',
        text: `${i === 199999 ? '大容量の最後' : '合成投稿'} ${i} ` + '資料容量測定'.repeat(8), url: `https://x.com/synthetic/status/${postId}`, postedAt: stamp, observedAt: stamp, firstImportedAt: stamp, lastImportedAt: stamp,
        partial: false, media: [], linkCards: [], mediaStatus: 'observed', dateSource: 'provided', read: false, favorite: i === 199999, tagIds: [] });
    }
    const file = (window as unknown as { syntheticFile: { contents: string } }).syntheticFile; file.contents = JSON.stringify(lib);
    return new TextEncoder().encode(file.contents).length;
  });
  expect(bytes).toBeGreaterThan(64 * 1024 * 1024);
  await page.getByRole('button', { name: '管理JSONを開く', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'すべてのブックマーク', exact: true })).toBeVisible({ timeout: 15000 });
  expect(await page.locator('.card-grid .post-card').count()).toBeLessThanOrEqual(50);
  await page.getByRole('button', { name: 'いいね', exact: true }).click();
  const search = page.getByRole('searchbox', { name: '本文・投稿者・URLを検索', exact: true }); await search.fill('大容量の最後');
  const card = page.locator('.card-grid .post-card'); await expect(card).toHaveCount(1);
  await card.getByRole('button', { name: '容量のマーク', exact: true }).click(); await card.getByRole('button', { name: '既読にする', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click(); await expect(page.locator('.local-file-bar')).toContainText('保存済み', { timeout: 15000 });
  const saved = await page.evaluate(() => {
    const lib = JSON.parse((window as unknown as { syntheticFile: { contents: string } }).syntheticFile.contents) as LocalLibrary;
    return { version: lib.formatVersion, bookmarks: lib.libraries.bookmarks.posts.length, likes: lib.libraries.likes.posts.length,
      lastLike: { read: lib.libraries.likes.posts.at(-1)!.read, favorite: lib.libraries.likes.posts.at(-1)!.favorite, tags: lib.libraries.likes.posts.at(-1)!.tagIds }, bookmarkRead: lib.libraries.bookmarks.posts.at(-1)!.read };
  });
  expect(saved).toEqual({ version: 1, bookmarks: 100000, likes: 100000, lastLike: { read: true, favorite: true, tags: ['m'] }, bookmarkRead: false });
  await page.getByRole('button', { name: '管理JSONを開く', exact: true }).click(); await expect(page.getByRole('heading', { name: 'すべてのブックマーク', exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: '設定', exact: true }).click(); await expect(page.getByText('合計200,000件・管理JSON 512MiBまで', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'いいね', exact: true }).click(); await search.fill('大容量の最後'); await expect(card).toHaveCount(1);
  await expect(card.getByRole('button', { name: '容量のマーク', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(card.getByRole('button', { name: '未読に戻す', exact: true })).toBeVisible();
  await page.evaluate(() => {
    Object.assign(window, { oversizedFileRead: false, async showOpenFilePicker() {
      const file = new File([], 'synthetic-over-limit.json'); Object.defineProperty(file, 'size', { value: 512 * 1024 * 1024 + 1 });
      file.text = async () => { Object.assign(window, { oversizedFileRead: true }); throw new Error('Must reject before reading'); };
      return [{ name: file.name, async getFile() { return file; } }];
    } });
  });
  await page.getByRole('button', { name: '管理JSONを開く', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('512MiB');
  await expect(card).toHaveCount(1); await expect(card.getByRole('button', { name: '容量のマーク', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => (window as unknown as { oversizedFileRead: boolean }).oversizedFileRead)).toBe(false);
  expect(await page.evaluate(() => (window as unknown as { syntheticStorageCalls: string[] }).syntheticStorageCalls)).toEqual([]);
});
test('marks, imported tags, read state, favorite and display settings save and reopen, with cumulative imports', async ({ page }) => {
  await start(page); await add(page, JSON.stringify(viewerBackup()), 'synthetic-posts.json'); await expect(page.locator('.card-grid .post-card')).toHaveCount(3);
  await page.getByRole('button', { name: 'マークを管理', exact: true }).click(); await page.getByLabel('マークの名前', { exact: true }).fill('LLM'); await page.getByRole('button', { name: 'マークを保存', exact: true }).click();
  await page.getByRole('button', { name: /^すべてのブックマーク/ }).click(); const card = page.locator('[data-post-key="a:2"]');
  await card.getByRole('button', { name: 'LLMのマーク', exact: true }).click(); await expect(card.getByRole('button', { name: 'LLMのマーク', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await card.getByRole('button', { name: '投稿の詳細', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '投稿の詳細', exact: true });
  await expect(dialog.getByLabel('タグ（カンマ区切り）', { exact: true })).toHaveCount(0); await expect(dialog.locator('.tag-chips')).toContainText('LLM'); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '設定', exact: true }).click(); await page.getByLabel('テーマ', { exact: true }).selectOption('dark'); await page.getByLabel('言語', { exact: true }).selectOption('en');
  await page.getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.locator('.local-file-bar')).toContainText('Saved');
  const contents = await savedText(page); const lib = JSON.parse(contents) as LocalLibrary;
  expect(lib.libraries.bookmarks.posts.find(p => p.accountId === 'a' && p.postId === '2')).toMatchObject({ read: true });
  expect(lib.libraries.bookmarks.posts[0]).toMatchObject({ favorite: true }); expect(lib.settings).toMatchObject({ language: 'en', theme: 'dark' });
  await page.reload(); await expect(page.getByRole('button', { name: '管理JSONを開く', exact: true })).toBeEnabled(); await state(page, { contents }); await page.getByRole('button', { name: '管理JSONを開く', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'All bookmarks', exact: true })).toBeVisible(); await expect(page.locator('.card-grid .post-card')).toHaveCount(3); await expect(page.locator('.card-grid')).toContainText('通常タグ');
  await add(page, JSON.stringify(viewerBackup()), 'synthetic-repeated.json'); await expect(page.locator('.card-grid .post-card')).toHaveCount(3); await expect(page.locator('.card-grid')).toContainText('LLM');
  await add(page, likesScript(2)); await expect(page.locator('.card-grid .post-card')).toHaveCount(2); await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((JSON.parse(await savedText(page)) as LocalLibrary).libraries.bookmarks.posts).toHaveLength(3);
});
test('cancel, permission/close failure and external modifications keep edits and prevent false saved status', async ({ page }) => {
  await start(page); await add(page, likesScript(2)); await state(page, { cancel: true }); await page.getByRole('button', { name: '保存', exact: true }).click(); await expect(page.locator('.local-file-bar')).toContainText('未保存'); await expect(page.getByRole('alert')).toHaveCount(0);
  await state(page, { cancel: false, failure: 'permission' }); await page.getByRole('button', { name: '保存', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('保存できません'); expect(await savedText(page)).toBe('');
  await state(page, { failure: 'close' }); await page.getByRole('button', { name: '保存', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('保存できません'); expect(await savedText(page)).toBe('');
  await state(page, { failure: '' }); await page.getByRole('button', { name: '保存', exact: true }).click(); await expect(page.locator('.local-file-bar')).toContainText('保存済み');
  const previous = await savedText(page); await page.locator('.card-grid .post-card').first().getByRole('button', { name: '既読にする', exact: true }).click();
  await state(page, { contents: previous + ' ' }); await page.getByRole('button', { name: '保存', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('上書きを止めました'); await expect(page.locator('.local-file-bar')).toContainText('未保存');
  expect(await savedText(page)).toBe(previous + ' ');
});
test('scoped JSON backups download and the bookmarks format remains compatible', async ({ page }) => {
  await start(page); await add(page, JSON.stringify(viewerBackup()), 'synthetic-posts.json'); await backup(page);
  await page.getByLabel('バックアップの範囲', { exact: true }).selectOption('mark-a');
  let pending = page.waitForEvent('download'); await page.getByRole('button', { name: '管理JSONをバックアップ', exact: true }).click(); let downloaded = await pending;
  const local = JSON.parse(await readFile((await downloaded.path())!, 'utf8')) as LocalLibrary;
  expect(local.libraries.bookmarks.posts).toHaveLength(1); expect(local.libraries.likes.posts).toHaveLength(0); expect(local.libraries.bookmarks.tags).toHaveLength(2);
  pending = page.waitForEvent('download'); await page.getByRole('button', { name: '拡張用の投稿JSONを出力', exact: true }).click(); downloaded = await pending;
  expect(downloaded.suggestedFilename()).toMatch(/^xbookmarkshelf-bookmarks-local-\d{4}-\d{2}-\d{2}\.json$/);
  const posts = JSON.parse(await readFile((await downloaded.path())!, 'utf8')); expect(posts.format).toBe('x-bookmark-library'); expect(posts.posts).toHaveLength(1); expect(posts.userStates[0].favorite).toBe(true);
  await add(page, likesScript(3)); await backup(page); await page.getByLabel('バックアップの範囲', { exact: true }).selectOption('entire');
  pending = page.waitForEvent('download'); await page.getByRole('button', { name: '管理JSONをバックアップ', exact: true }).click(); downloaded = await pending;
  const whole = JSON.parse(await readFile((await downloaded.path())!, 'utf8')) as LocalLibrary; expect(whole.libraries.bookmarks.posts).toHaveLength(3); expect(whole.libraries.likes.posts).toHaveLength(3);
  await expect(page.getByRole('button', { name: '拡張用の投稿JSONを出力', exact: true })).toHaveCount(0);
});
test('invalid import batch and save target never replace current data or execute text', async ({ page }) => {
  await start(page); await add(page, likesScript(1)); await expect(page.locator('.post-card')).toHaveCount(1);
  await page.locator('input[multiple]').setInputFiles([{ name: 'synthetic-valid.js', mimeType: 'text/plain', buffer: Buffer.from(likesScript(2)) }, { name: 'synthetic-bad.js', mimeType: 'text/plain', buffer: Buffer.from('window.YTD.like.part0 = []; window.syntheticExecuted = true;') }]);
  await expect(page.getByRole('alert')).toBeVisible(); await expect(page.locator('.post-card')).toHaveCount(1); expect(await page.evaluate(() => 'syntheticExecuted' in window)).toBe(false);
  await state(page, { contents: JSON.stringify(viewerBackup()) }); await page.getByRole('button', { name: '保存', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('管理JSON'); await expect(page.locator('.local-file-bar')).toContainText('未保存');
  expect(JSON.parse(await savedText(page)).format).toBe('x-bookmark-library');
});
test('long names, one-row overflow marks and dark UI fit 390px; discard confirmation protects unsaved work', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' }); await page.setViewportSize({ width: 390, height: 844 }); await start(page);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim())).toBe('#101318');
  const b = viewerBackup(); b.tags = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, accountId: 'a', name: `${i} <script>${'長い名前'.repeat(12)}`, mark: 'star' as const, markOrder: i })); b.postTags = [];
  b.posts[0]!.text = '<img src=x onerror=alert(1)> ' + 'x'.repeat(5000) + ' https://example.com/synthetic';
  await add(page, JSON.stringify(b), 'synthetic-' + '長いファイル'.repeat(20) + '.json'); await expect(page.locator('.card-grid .post-card')).toHaveCount(3);
  const card = page.locator('[data-post-key="a:1"]'); await expect(card.locator('.quick-mark')).toHaveCount(7); await card.getByRole('button', { name: 'その他のマーク', exact: true }).click();
  const chooser = page.getByRole('dialog', { name: 'マークを選択', exact: true }); await chooser.getByRole('searchbox').fill('29'); await expect(chooser.locator('.mark-picker-option')).toHaveCount(1); await chooser.locator('.mark-picker-option').click(); await expect(chooser.locator('.mark-picker-option')).toHaveAttribute('aria-pressed', 'true'); await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await card.getByRole('button', { name: '投稿の詳細', exact: true }).click(); await expect(page.getByRole('dialog')).toContainText('<img src=x'); await expect(page.locator('img[src="x"]')).toHaveCount(0); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'マークを管理', exact: true }).click(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('button', { name: '新しく作る', exact: true }).click(); await expect(page.locator('.mark-directory .mark-item')).toHaveCount(30);
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '新しく作る', exact: true }).click(); await expect(page.locator('.post-card')).toHaveCount(0);
});
