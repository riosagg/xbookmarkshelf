import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function seed(page: Page) {
  await page.goto('/library.html');
  await page.evaluate(async () => {
    const path = '/src/db.ts'; const { db } = await import(path);
    const date = '2026-10-11T00:00:00.000Z';
    await db.settings.bulkPut([{ key: 'accounts', value: [{ id: 'synthetic', handle: 'synthetic_user' }] }, { key: 'theme', value: 'dark' }, { key: 'columns', value: 5 }]);
    await db.posts.put({ accountId: 'synthetic', postId: '1', authorHandle: 'synthetic_author', authorName: '日本語の投稿者', text: '日本語の本文と https://example.invalid/long-path は表示言語を変えても残る。', url: 'https://x.com/synthetic_author/status/1', partial: true, postedAt: date, observedAt: date, firstImportedAt: date, lastImportedAt: date, media: [{ kind: 'video', url: 'https://pbs.twimg.com/amplify_video_thumb/synthetic.jpg' }] });
    await db.tags.bulkPut(Array.from({ length: 8 }, (_, i) => ({ id: `mark-${i}`, accountId: 'synthetic', name: i === 7 ? '<script>日本語マーク</script>' + '長い名前'.repeat(15) : i === 0 ? '未読' : `分類${i}`, mark: 'book', markOrder: i })));
    await db.postTags.put({ accountId: 'synthetic', postId: '1', tagId: 'mark-0' });
    await db.userStates.put({ accountId: 'synthetic', postId: '1', read: false, favorite: true });
  });
  await page.reload(); await expect(page.locator('.post-card')).toHaveCount(1);
}
async function posts(page: Page) { return page.evaluate(async () => { const path = '/src/backup.ts'; return (await import(path)).createBackup(); }); }
async function preferences(page: Page) { return page.evaluate(async () => { const path = '/src/db.ts'; return (await import(path)).db.settings.toArray(); }); }
const file = (value: unknown) => ({ name: 'synthetic-settings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });

test('language switches every open surface, keeps content and filters, persists and works offline', async ({ page, context }) => {
  await context.addInitScript(() => {
    const run = { state: 'stopped', reason: 'run_limit', observed: 100, added: 95, existing: 5, intervalMs: 3000, maxPosts: 100, mode: 'full' };
    Object.defineProperty(window, 'chrome', { value: { runtime: { sendMessage: async (message: { type: string }) => message.type === 'STATUS' ? { ok: true, value: run } : { ok: false, error: 'XのHistory画面でBookmarks（ブックマーク）タブを選んでください' }, getURL: (path: string) => path }, tabs: { query: async () => [{ id: 1 }], create: async () => ({}) } } });
  });
  await seed(page);
  const before = await posts(page);
  const other = await context.newPage(); await other.goto('/library.html');
  await other.getByRole('searchbox', { name: '本文・投稿者を検索' }).fill('日本語');
  await expect(other.locator('.post-card')).toHaveCount(1);
  const popup = await context.newPage(); await popup.goto('/popup.html');
  await expect(popup.getByText('実行を完了しました', { exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: '管理', exact: true }).getByRole('button', { name: '設定', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '言語', exact: true })).toHaveValue('system');
  await page.getByRole('combobox', { name: '言語', exact: true }).selectOption('en');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(other.getByRole('heading', { name: 'All bookmarks', exact: true })).toBeVisible();
  await expect(other.getByRole('searchbox', { name: 'Search posts and authors' })).toHaveValue('日本語');
  await expect(other.locator('.post-card summary')).toContainText('日本語の本文');
  await expect(other.locator('.tag-chip')).toHaveText('未読');
  await expect(other.locator('.post-date')).toHaveText('10/11/2026');
  await expect(other.getByRole('button', { name: 'Mark 未読', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(popup.getByText('Run completed', { exact: true })).toBeVisible();
  await expect(popup.getByRole('alert')).toHaveText('Select the Bookmarks tab in X History');
  await expect(popup.getByText('Confirmed 100 · New 95 · Existing 5', { exact: true })).toBeVisible();
  await expect(popup.getByLabel('Wait (seconds)')).toHaveValue('3');
  await expect(popup.locator('#interval-help')).toContainText('minimum wait is 3 seconds');
  expect(await popup.title()).toBe('Import — xbookmarkshelf');
  expect(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const after = await posts(page); expect({ ...after, exportedAt: before.exportedAt }).toEqual(before);
  await other.getByRole('button', { name: 'More marks', exact: true }).click();
  await other.getByRole('searchbox', { name: 'Search mark names' }).fill('<script>');
  const picker = other.getByRole('dialog', { name: 'Choose marks', exact: true });
  await expect(picker.locator('.mark-picker-option')).toHaveCount(1);
  expect(await other.locator('script').filter({ hasText: '日本語マーク' }).count()).toBe(0);
  await other.keyboard.press('Escape');
  await page.setViewportSize({ width: 1200, height: 1000 });
  await page.locator('.workspace').screenshot({ path: 'test-results/library-settings-english.png' });
  for (const target of [page, other]) {
    await target.setViewportSize({ width: 390, height: 844 });
    expect(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole('button', { name: 'Manage marks', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Archive icon', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await other.reload();
  await expect(other.locator('html')).toHaveAttribute('lang', 'en');
  await expect(other.getByRole('heading', { name: 'All bookmarks', exact: true })).toBeVisible();
  await context.setOffline(true);
  await other.getByRole('searchbox', { name: 'Search posts and authors' }).fill('日本語');
  await expect(other.locator('.post-card')).toHaveCount(1);
  await other.locator('summary').click();
  await expect(other.getByRole('dialog', { name: 'Post details', exact: true })).toContainText('日本語の本文');
  await other.getByRole('button', { name: 'Close details', exact: true }).click();
  await page.getByRole('navigation', { name: 'Manage', exact: true }).getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ja');
  await expect(page.getByRole('heading', { name: '設定', exact: true })).toBeVisible();
  await expect(other.getByRole('heading', { name: 'すべてのブックマーク', exact: true })).toBeVisible();
  await expect(popup.getByText('実行を完了しました', { exact: true })).toBeVisible();
});

test('settings transfer includes language, previews changes before applying, and accepts old files', async ({ page }) => {
  await seed(page);
  const before = await posts(page);
  await page.getByRole('navigation', { name: '管理', exact: true }).getByRole('button', { name: '設定', exact: true }).click();
  await page.getByRole('combobox', { name: '言語', exact: true }).selectOption('en');
  const section = page.getByRole('region', { name: 'Settings file', exact: true });
  const download = page.waitForEvent('download');
  await section.getByRole('button', { name: 'Export settings', exact: true }).click();
  const exported = await download; const backup = JSON.parse(await readFile((await exported.path())!, 'utf8'));
  expect(backup.settings.language).toBe('en'); expect(Object.keys(backup.settings)).toHaveLength(5);
  const original = await preferences(page);
  const input = section.getByLabel('Choose settings JSON', { exact: true });
  await input.setInputFiles(file({ ...backup, settings: { ...backup.settings, language: 'fr' } }));
  await expect(section.getByRole('alert')).toContainText('Invalid settings');
  expect(await preferences(page)).toEqual(original);
  const incoming = { ...backup, settings: { ...backup.settings, language: 'ja' } };
  await input.setInputFiles(file(incoming));
  await expect(section.locator('.settings-preview')).toContainText('日本語');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await section.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await preferences(page)).toEqual(original);
  const { language: _language, ...oldSettings } = backup.settings;
  await input.setInputFiles(file({ ...backup, settings: oldSettings }));
  await expect(section.locator('.settings-preview')).toContainText('Keep current language (older file)');
  await section.getByRole('button', { name: 'Apply these settings', exact: true }).click();
  await expect(section.getByRole('status')).toHaveText('Settings applied.');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await input.setInputFiles(file(incoming));
  await section.getByRole('button', { name: 'Apply these settings', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(page.getByRole('region', { name: '設定ファイル', exact: true }).getByRole('status')).toHaveText('設定を適用しました。');
  const after = await posts(page); expect({ ...after, exportedAt: before.exportedAt }).toEqual(before);
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
});

test('cached language applies before the app loads, DB wins over cache, and cache failure is harmless', async ({ page }) => {
  await seed(page);
  await page.evaluate(async () => { const path = '/src/db.ts'; const { db } = await import(path); await db.settings.put({ key: 'language', value: 'en' }); });
  await expect(page.getByRole('heading', { name: 'All bookmarks', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('xbookmarkshelf.language'))).toBe('en');
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/src/library.tsx', async route => { await held; await route.continue(); });
  await page.reload({ waitUntil: 'commit' });
  await expect(page.locator('#app')).toBeEmpty();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(async () => {
    const frames = [];
    for (let i = 0; i < 3; i++) { await new Promise(requestAnimationFrame); frames.push(document.documentElement.lang); }
    return frames;
  })).toEqual(['en', 'en', 'en']);
  release();
  await expect(page.getByRole('heading', { name: 'All bookmarks', exact: true })).toBeVisible();
  await page.unroute('**/src/library.tsx');
  await page.evaluate(() => localStorage.setItem('xbookmarkshelf.language', 'ja'));
  await page.reload(); await expect(page.getByRole('heading', { name: 'All bookmarks', exact: true })).toBeVisible();
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('synthetic-cache-unavailable'); };
    Storage.prototype.setItem = () => { throw new Error('synthetic-cache-unavailable'); };
  });
  await page.reload(); await expect(page.getByRole('heading', { name: 'All bookmarks', exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Manage', exact: true }).getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ja');
  await expect(page.getByRole('heading', { name: '設定', exact: true })).toBeVisible();
});

for (const browserLocale of ['ja-JP', 'en-GB', 'fr-FR']) test(`system language follows Chrome UI ${browserLocale} and keeps manual overrides`, async ({ page, context }) => {
  const expected = browserLocale === 'ja-JP' ? 'ja' : 'en';
  await context.addInitScript(locale => {
    let uiLocale = locale;
    Object.assign(window, { syntheticBrowserLanguage: (value: string) => { uiLocale = value; window.dispatchEvent(new Event('languagechange')); } });
    Object.defineProperty(window, 'chrome', { value: {
      i18n: { getUILanguage: () => uiLocale },
      runtime: { sendMessage: async () => ({ ok: true, value: null }), getURL: (path: string) => path },
      tabs: { query: async () => [], create: async () => ({}) },
    } });
  }, browserLocale);
  // The preferred content language is Japanese; Chrome UI wins when it differs.
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/src/library.tsx', async route => { await held; await route.continue(); });
  await page.goto('/library.html', { waitUntil: 'commit' });
  await expect(page.locator('#app')).toBeEmpty();
  await expect(page.locator('html')).toHaveAttribute('lang', expected);
  await expect(page.locator('html')).toHaveAttribute('data-language-preference', 'system');
  release();
  await expect(page.getByRole('heading', { name: /^(All bookmarks|すべてのブックマーク)$/ })).toBeVisible();
  await page.unroute('**/src/library.tsx');
  await page.getByRole('navigation', { name: /^(Manage|管理)$/ }).getByRole('button', { name: /^(Settings|設定)$/ }).click();
  const choice = page.getByRole('combobox', { name: /^(Language|言語)$/ });
  await expect(choice).toHaveValue('system');
  const other = await context.newPage(); await other.goto('/library.html');
  const popup = await context.newPage(); await popup.goto('/popup.html');
  for (const target of [other, popup]) await expect(target.locator('html')).toHaveAttribute('lang', expected);
  if (browserLocale === 'en-GB') await page.locator('.workspace').screenshot({ path: 'test-results/library-system-language.png' });
  await choice.selectOption('en');
  for (const target of [page, other, popup]) {
    await expect(target.locator('html')).toHaveAttribute('lang', 'en');
    await target.evaluate(() => (window as typeof window & { syntheticBrowserLanguage(value: string): void }).syntheticBrowserLanguage('ja-JP'));
    await expect(target.locator('html')).toHaveAttribute('lang', 'en');
  }
  await choice.selectOption('system');
  for (const target of [page, other, popup]) await expect(target.locator('html')).toHaveAttribute('lang', 'ja');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('xbookmarkshelf.language'))).toBe('system');
  const backup = await page.evaluate(async () => { const path = '/src/settings-backup.ts'; return (await import(path)).createSettingsBackup(); });
  expect(backup.settings.language).toBe('system');
  const manual = { ...backup, settings: { ...backup.settings, language: 'en' } };
  let section = page.getByRole('region', { name: '設定ファイル', exact: true });
  await section.getByLabel('設定JSONを選択', { exact: true }).setInputFiles(file(manual));
  await section.getByRole('button', { name: 'この設定を適用', exact: true }).click();
  await expect(choice).toHaveValue('en');
  section = page.getByRole('region', { name: 'Settings file', exact: true });
  await section.getByLabel('Choose settings JSON', { exact: true }).setInputFiles(file(backup));
  await expect(section.locator('.settings-preview')).toContainText('Follow system');
  await expect(choice).toHaveValue('en');
  await section.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(choice).toHaveValue('en');
  await section.getByLabel('Choose settings JSON', { exact: true }).setInputFiles(file(backup));
  await section.getByRole('button', { name: 'Apply these settings', exact: true }).click();
  await expect(choice).toHaveValue('system');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  for (const target of [page, other, popup]) {
    await target.evaluate(() => (window as typeof window & { syntheticBrowserLanguage(value: string): void }).syntheticBrowserLanguage('fr-FR'));
    await expect(target.locator('html')).toHaveAttribute('lang', 'en');
    await expect(target.locator('html')).toHaveAttribute('data-language-preference', 'system');
  }
  // A restart under a changed Chrome language resolves system again, rather than caching Japanese.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', expected);
  await page.getByRole('navigation', { name: /^(Manage|管理)$/ }).getByRole('button', { name: /^(Settings|設定)$/ }).click();
  await expect(choice).toHaveValue('system');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
