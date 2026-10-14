import { chromium, expect, test } from './fixtures';
import { createServer, type Server } from 'node:http';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { emptyLocalLibrary, type LocalPost } from '../../src/local-data';
const SYNTHETIC_IMAGE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAb0lEQVR4nO3PAQkAAAyEwO9feoshgnABdLep8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3IPanc8OLDQitxAAAAAElFTkSuQmCC', 'base64');
let server: Server; let endpoint: string; let sawImages = false;
const importImageCounts: number[] = [];
let holdDecisions = false; const heldResponses: (() => void)[] = [];
test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'content-type'); res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.end(); return; }
    let body = ''; req.on('data', part => body += part); req.on('end', () => {
      const data = JSON.parse(body); const state = JSON.stringify(data.state); if (data.images?.length) sawImages = true;
      if (!data.questions.connection) importImageCounts.push(data.images?.length ?? 0);
      const answers = Object.fromEntries(Object.entries(data.questions).map(([id, q]) => [id, { type: 'noul', noul: id === 'connection' || !state.includes('unrelated') && (q as { instructions: string }).instructions.includes('Programming') ? 0.99 : 0.01 }]));
      res.setHeader('Content-Type', 'application/json');
      const send = () => { if (!res.destroyed) res.end(JSON.stringify({ answers })); };
      if (holdDecisions && !data.questions.connection) heldResponses.push(send); else send();
    });
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { await new Promise<void>(done => server.close(() => done())); });
async function extension(images = false) {
  const temp = await mkdtemp(join(tmpdir(), 'xbs-ai-')); const path = join(temp, 'extension'); await cp(resolve('dist'), path, { recursive: true });
  const manifest = JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8')); manifest.host_permissions = ['http://127.0.0.1/*', 'https://x.com/*', ...(images ? ['https://pbs.twimg.com/*'] : [])]; await writeFile(join(path, 'manifest.json'), JSON.stringify(manifest));
  const context = await chromium.launchPersistentContext(join(temp, 'profile'), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`] });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'); const id = worker.url().split('/')[2]!;
  const page = await context.newPage(); await page.goto(`chrome-extension://${id}/library.html`);
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>(done => { const r = indexedDB.open('x-bookmark-library'); r.onsuccess = () => done(r.result); });
    await new Promise<void>((done, reject) => { const t = database.transaction(['settings', 'tags'], 'readwrite');
      t.objectStore('settings').put({ key: 'language', value: 'ja' }); t.objectStore('settings').put({ key: 'accounts', value: [{ id: 'a', handle: 'synthetic_user' }] }); t.objectStore('settings').put({ key: 'previews', value: false });
      t.objectStore('tags').put({ id: 'old', accountId: 'a', name: 'Manual', mark: 'star' }); t.objectStore('tags').put({ id: 'code', accountId: 'a', name: 'Programming', mark: 'code' }); t.oncomplete = () => done(); t.onabort = () => reject(t.error);
    }); database.close();
  });
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('lang', 'ja'); await page.getByRole('button', { name: '自動マーク', exact: true }).click();
  await expect(page.getByRole('button', { name: '投稿一覧へ戻る', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '接続設定を開く', exact: true }).click();
  await expect(page.locator('.settings-stack > :last-child')).toHaveClass(/ai-settings/);
  await page.getByLabel('LM StudioのURL', { exact: true }).fill(endpoint); await page.getByLabel('画像も判定に使う', { exact: true }).setChecked(images);
  await page.getByRole('button', { name: '接続を確認して保存', exact: true }).click(); await expect(page.locator('.ai-connection')).toContainText('接続設定済み');
  return { context, page, worker, id, async close() { await context.close(); await rm(temp, { recursive: true, force: true }); } };
}
test('real MV3 import-result and account buttons process beyond 50 posts and preserve existing marks', async () => {
  const env = await extension();
  try {
    await env.page.evaluate(async () => {
      const d = await new Promise<IDBDatabase>(done => { const r = indexedDB.open('x-bookmark-library'); r.onsuccess = () => done(r.result); });
      await new Promise<void>(done => { const t = d.transaction(['posts', 'postTags', 'userStates', 'importRuns'], 'readwrite');
        for (let i = 1; i <= 55; i++) t.objectStore('posts').put({ accountId: 'a', postId: String(i), authorHandle: 'sample', authorName: 'Synthetic', text: i === 55 ? 'unrelated' : 'Python programming', media: [], partial: false, url: `https://x.com/sample/status/${i}`, postedAt: null, observedAt: '2026-10-14T00:00:00Z', firstImportedAt: '2026-10-14T00:00:00Z', lastImportedAt: '2026-10-14T00:00:00Z' });
        t.objectStore('postTags').put({ accountId: 'a', postId: '1', tagId: 'old' }); t.objectStore('userStates').put({ accountId: 'a', postId: '1', read: true, favorite: true });
        t.objectStore('importRuns').put({ id: 'synthetic-run', accountId: 'a', handle: 'synthetic_user', source: 'bookmarks', state: 'stopped', reason: 'run_limit', startedAt: '2026-10-14T00:00:00Z', observed: 2, added: 2, existing: 0, importedPostIds: ['1', '55'] }); t.oncomplete = () => done(); }); d.close();
    });
    await env.page.getByRole('button', { name: '取り込み', exact: true }).click(); await env.page.getByRole('button', { name: '今回取り込んだ投稿を自動マーク', exact: true }).click();
    await expect(env.page.locator('.ai-progress')).toContainText('自動マーク完了'); await expect(env.page.locator('.ai-progress')).toContainText('該当なし 1');
    await env.page.getByRole('button', { name: /^すべてのブックマーク/ }).click(); await expect(env.page.locator('main .ai-controls')).toHaveCount(0);
    const nav = env.page.getByRole('navigation', { name: 'ライブラリ', exact: true }); await expect(nav.getByRole('button').nth(3)).toHaveAccessibleName('自動マーク');
    await nav.getByRole('button', { name: '自動マーク', exact: true }).click(); await expect(env.page.locator('.ai-target')).toContainText('55');
    await expect(env.page.getByRole('button', { name: '接続設定を開く', exact: true })).toHaveCount(0);
    await expect(env.page.getByRole('button', { name: 'このアカウント範囲を自動マーク', exact: true })).toHaveClass(/primary/);
    holdDecisions = true; await env.page.getByRole('button', { name: 'このアカウント範囲を自動マーク', exact: true }).click();
    await expect.poll(() => heldResponses.length).toBe(1); await expect(nav.locator('.ai-nav-status')).toHaveText('処理中');
    await env.page.getByRole('button', { name: /^すべてのブックマーク/ }).click(); await expect(env.page.locator('main .ai-controls')).toHaveCount(0); await expect(nav.locator('.ai-nav-status')).toHaveText('処理中');
    await nav.getByRole('button', { name: '自動マーク', exact: true }).click(); await expect(env.page.locator('.ai-progress')).toContainText('自動マーク中');
    holdDecisions = false; heldResponses.shift()!();
    await expect(env.page.locator('.ai-progress')).toContainText('55 / 55', { timeout: 30000 }); await expect(env.page.locator('.ai-progress')).toContainText('自動マーク完了');
    const rows = await env.page.evaluate(async () => { const d = await new Promise<IDBDatabase>(done => { const r = indexedDB.open('x-bookmark-library'); r.onsuccess = () => done(r.result); }); const values = await new Promise<any[]>(done => { const r = d.transaction('postTags').objectStore('postTags').getAll(); r.onsuccess = () => done(r.result); }); d.close(); return values; });
    expect(rows.filter(r => r.tagId === 'code')).toHaveLength(54); expect(rows.filter(r => r.tagId === 'old')).toHaveLength(1);
    await env.page.setViewportSize({ width: 390, height: 844 }); expect(await env.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { holdDecisions = false; heldResponses.splice(0).forEach(send => send()); await env.close(); }
});
test('auto-marking during a 20-post image import continues after the popup closes', async () => {
  test.setTimeout(45000);
  importImageCounts.length = 0;
  const env = await test.step('Configure extension', () => extension(true));
  try {
    await env.context.route('https://pbs.twimg.com/**', route => route.fulfill({ contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: SYNTHETIC_IMAGE }));
    await env.context.route('https://x.com/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body><a data-testid="AppTabBar_Profile_Link" href="/synthetic_user">Profile</a><main>'+Array.from({ length: 20 }, (_, i) => `<article data-testid="tweet"><div data-testid="User-Name">Synthetic</div><a href="/sample/status/${i+1}"><time datetime="2026-10-14T00:00:00Z"></time></a><div data-testid="tweetText">Python programming</div><div data-testid="${i % 2 ? 'videoPlayer' : 'tweetPhoto'}"><img src="https://pbs.twimg.com/media/synthetic-${i+1}.png"></div></article>`).join('')+'</main></body></html>' }));
    const source = await env.context.newPage(); await source.goto('https://x.com/i/bookmarks');
    const popup = await env.context.newPage(); await source.bringToFront(); await popup.goto(`chrome-extension://${env.id}/popup.html`);
    await popup.getByLabel('今回の上限（件）').fill('20'); await popup.getByLabel('取り込み中に自動マークを付ける').check(); await source.bringToFront();
    await popup.getByRole('button', { name: '少量ずつ自動取り込み', exact: true }).click(); await expect(popup.locator('.progress strong')).toHaveText('読み取り中'); await popup.close(); await source.bringToFront();
    await expect.poll(async () => env.worker.evaluate(async () => { const d = await new Promise<IDBDatabase>(done => { const r = indexedDB.open('x-bookmark-library'); r.onsuccess = () => done(r.result); }); const v = await new Promise<any>(done => { const r = d.transaction('settings').objectStore('settings').get('decisionJob'); r.onsuccess = () => done(r.result?.value); }); d.close(); return v?.state === 'completed' ? v?.marked : 0; }), { timeout: 30000 }).toBe(20);
    expect(importImageCounts).toEqual(Array(20).fill(1));
  } finally { await env.close(); }
});
test('file app connects through CORS, sends image bytes and saves additive marks in JSON', async ({ page }) => {
  sawImages = false; await page.goto('file://' + resolve('local-dist/xbookmarkshelf-local.html'));
  const lib = emptyLocalLibrary(); lib.libraries.bookmarks = { accounts: [{ id: 'a', handle: 'sample' }], tags: [{ id: 'old', accountId: 'a', name: 'Manual', mark: 'star' }, { id: 'code', accountId: 'a', name: 'Programming', mark: 'code' }], posts: [{ accountId: 'a', postId: '1', authorHandle: 'sample', authorName: 'Synthetic', text: 'Python programming', postedAt: null, observedAt: '2026-10-14T00:00:00Z', firstImportedAt: '2026-10-14T00:00:00Z', lastImportedAt: '2026-10-14T00:00:00Z', url: 'https://x.com/sample/status/1', partial: false, media: [{ kind: 'image', url: 'https://pbs.twimg.com/media/synthetic.png' }], mediaStatus: 'observed', dateSource: 'unknown', read: true, favorite: true, tagIds: ['old'] }] };
  await page.getByLabel('管理JSONを開く', { exact: true }).setInputFiles({ name: 'synthetic-library.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(lib)) });
  await page.route('https://pbs.twimg.com/**', route => route.fulfill({ contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: SYNTHETIC_IMAGE }));
  await page.getByRole('button', { name: /^(設定|Settings)$/ }).click(); await page.getByLabel('LM StudioのURL', { exact: true }).fill(endpoint); await page.getByLabel('モデルID', { exact: true }).fill('m'.repeat(200)); await page.getByRole('button', { name: '接続を確認して適用', exact: true }).click(); await expect(page.locator('.ai-connection')).toContainText('接続設定済み');
  await expect(page.locator('.settings-stack > :last-child')).toHaveClass(/ai-settings/); await expect(page.locator('main .ai-controls')).toHaveCount(0);
  await page.getByRole('button', { name: '自動マーク', exact: true }).click(); await expect(page.getByRole('heading', { name: '自動マーク', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '接続設定を開く', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '投稿一覧へ戻る', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '検索結果を自動マーク', exact: true })).toHaveClass(/primary/);
  await page.getByRole('button', { name: '検索結果を自動マーク', exact: true }).click(); await expect(page.locator('.ai-progress')).toContainText('自動マーク完了'); await expect(page.locator('.ai-progress')).toContainText('該当 1'); expect(sawImages).toBe(true);
  await page.getByRole('button', { name: /^すべてのブックマーク/ }).click(); const card = page.locator('.card-grid .post-card'); await expect(card.getByRole('button', { name: 'Manualのマーク', exact: true })).toHaveAttribute('aria-pressed', 'true'); await expect(card.getByRole('button', { name: 'Programmingのマーク', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }); });
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '保存', exact: true }).click(); const file = await download; const saved = JSON.parse(await readFile((await file.path())!, 'utf8')); expect(saved.libraries.bookmarks.posts[0]).toMatchObject({ tagIds: ['old', 'code'], read: true, favorite: true }); expect(saved.settings.decisionConnection).toBeUndefined();
  await expect(page.getByText('直接保存はデスクトップ版Chromeに対応。このブラウザではJSONをダウンロードします。', { exact: true })).toHaveCount(0);
  await expect(page.locator('.local-notice')).toContainText('管理JSONをダウンロードしました。'); await page.getByRole('button', { name: '通知を閉じる', exact: true }).click(); await expect(page.locator('.local-notice')).toHaveCount(0);
  await expect(page.locator('.local-file-bar')).toContainText('未保存の変更があります'); await expect(card.getByRole('button', { name: 'Programmingのマーク', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
test('local auto-mark page retains filtered scope and progress across navigation, and Stop rejects a late result', async ({ page }) => {
  const lib = emptyLocalLibrary(); lib.settings.language = 'ja'; lib.settings.theme = 'dark';
  const post = (postId: string, text: string): LocalPost => ({ accountId: 'a', postId, authorHandle: 'sample', authorName: 'Synthetic', text, postedAt: null, observedAt: '2026-10-14T00:00:00Z', firstImportedAt: '2026-10-14T00:00:00Z', lastImportedAt: '2026-10-14T00:00:00Z', url: `https://x.com/sample/status/${postId}`, partial: false, media: [], mediaStatus: 'observed', dateSource: 'unknown', read: true, favorite: true, tagIds: ['old'] });
  lib.libraries.bookmarks = { accounts: [{ id: 'a', handle: 'sample' }], tags: [{ id: 'old', accountId: 'a', name: 'Manual', mark: 'star' }, { id: 'code', accountId: 'a', name: 'Programming', mark: 'code' }], posts: [post('1', 'Python programming'), post('2', 'Python programming'), post('3', 'unrelated')] };
  lib.libraries.likes.tags = [{ id: 'old', accountId: 'likes', name: 'Manual', mark: 'star' }]; lib.libraries.likes.posts = [{ ...post('4', 'Python programming'), accountId: 'likes' }];
  try {
    await page.goto('file://' + resolve('local-dist/xbookmarkshelf-local.html'));
    await page.getByLabel('管理JSONを開く', { exact: true }).setInputFiles({ name: 'synthetic-navigation.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(lib)) });
    await page.getByRole('button', { name: '自動マーク', exact: true }).click(); await page.getByRole('button', { name: '接続設定を開く', exact: true }).click(); await page.getByLabel('LM StudioのURL', { exact: true }).fill(endpoint); await page.getByLabel('画像も判定に使う', { exact: true }).uncheck(); await page.getByRole('button', { name: '接続を確認して適用', exact: true }).click(); await expect(page.locator('.ai-connection')).toBeVisible();
    await page.getByRole('button', { name: /^すべてのブックマーク/ }).click(); await page.getByRole('searchbox').fill('Python'); await expect(page.locator('.card-grid .post-card')).toHaveCount(2);
    const nav = page.getByRole('navigation', { name: 'ローカルライブラリ', exact: true }); await expect(nav.getByRole('button').nth(3)).toHaveAccessibleName('自動マーク');
    await page.getByRole('button', { name: '自動マーク', exact: true }).click(); await expect(page.locator('.ai-target')).toContainText('現在の検索結果'); await expect(page.locator('.ai-target dd').last()).toHaveText('2');
    await expect(page.getByRole('button', { name: '接続設定を開く', exact: true })).toHaveCount(0);
    holdDecisions = true; await page.getByRole('button', { name: '検索結果を自動マーク', exact: true }).click(); await expect.poll(() => heldResponses.length).toBe(1);
    await page.getByRole('button', { name: /^すべてのブックマーク/ }).click(); await expect(page.locator('.card-grid .post-card')).toHaveCount(2); await expect(page.locator('main .ai-controls, main .ai-progress')).toHaveCount(0); await expect(nav.locator('.ai-nav-status')).toHaveText('処理中');
    await page.setViewportSize({ width: 390, height: 844 }); await expect(nav.locator('.ai-nav-status')).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole('button', { name: '設定', exact: true }).click(); await expect(page.locator('.ai-connection')).toBeVisible(); await expect(page.locator('main .ai-controls')).toHaveCount(0);
    await page.getByRole('button', { name: '自動マーク', exact: true }).click(); heldResponses.shift()!(); await expect.poll(() => heldResponses.length).toBe(1); await expect(page.locator('.ai-progress')).toContainText('1 / 2');
    await page.getByRole('button', { name: '自動マークを停止', exact: true }).click(); await expect(page.locator('.ai-progress')).toContainText('自動マークを停止しました'); await expect(nav.locator('.ai-nav-status')).toHaveCount(0); heldResponses.shift()!(); holdDecisions = false;
    await page.evaluate(() => { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }); });
    const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: '保存', exact: true }).click(); const saved = JSON.parse(await readFile((await (await downloading).path())!, 'utf8'));
    expect(saved.libraries.bookmarks.posts.map((p: LocalPost) => p.tagIds)).toEqual([['old', 'code'], ['old'], ['old']]); expect(saved.libraries.likes).toMatchObject({ ...lib.libraries.likes });
    await page.getByRole('button', { name: '設定', exact: true }).click(); await page.getByLabel('言語', { exact: true }).selectOption('en'); await page.getByRole('button', { name: 'Auto-mark', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Auto-mark', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open connection settings', exact: true })).toHaveCount(0);
    const englishDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Save', exact: true }).click(); await englishDownload;
    await page.getByRole('button', { name: 'Dismiss notification', exact: true }).click(); await expect(page.locator('.local-notice')).toHaveCount(0); await expect(page.locator('.local-file-bar')).toContainText('Unsaved changes');
    await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await page.getByRole('button', { name: 'Auto-mark', exact: true }).click(); await expect(page.getByRole('button', { name: 'Open connection settings', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Auto-mark search results', exact: true })).toBeDisabled();
  } finally { holdDecisions = false; heldResponses.splice(0).forEach(send => send()); }
});
