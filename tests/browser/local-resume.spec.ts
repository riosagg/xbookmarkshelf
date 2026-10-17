import { expect, test, type Page } from './fixtures';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { likesScript } from '../viewer-fixtures';

const fileUrl = pathToFileURL(resolve('local-dist/xbookmarkshelf-local.html')).href;
const sessionDb = 'xbookmarkshelf-local-session';
async function metadata(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('xbookmarkshelf-local-session', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try { return await new Promise<{ keys: IDBValidKey[]; values: unknown[]; stores: string[] }>((resolve, reject) => {
      const tx = db.transaction('preferences', 'readonly'); const s = tx.objectStore('preferences'); const keys = s.getAllKeys(); const values = s.getAll();
      tx.oncomplete = () => resolve({ keys: keys.result, values: values.result.map(v => typeof v === 'boolean' ? v : { name: v.name, kind: v.kind, native: v instanceof FileSystemFileHandle }), stores: Array.from(db.objectStoreNames) });
      tx.onabort = () => reject(tx.error);
    }); } finally { db.close(); }
  });
}
async function addAndSave(page: Page) {
  await page.locator('input[multiple]').setInputFiles({ name: 'synthetic-like.js', mimeType: 'text/plain', buffer: Buffer.from(likesScript(2)) });
  await expect(page.locator('.post-card')).toHaveCount(2); await expect(page.locator('.local-save')).toBeEnabled(); await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.local-file-bar')).toContainText('保存済み'); await expect(page.locator('.local-save')).toBeEnabled();
}
// Native handles can be structured-cloned. OPFS is used ONLY by the isolated test
// fixture at an HTTP origin, never by the shipped app or for the user's files.
async function nativeStart(page: Page, permission: PermissionState = 'granted') {
  const html = await readFile('local-dist/xbookmarkshelf-local.html', 'utf8');
  await page.route('http://127.0.0.1:4173/synthetic-local.html', route => route.fulfill({ body: html, contentType: 'text/html' }));
  await page.addInitScript(({ permission, sessionDb }) => {
    const calls: string[] = []; Object.assign(window, { syntheticPermission: permission, syntheticCalls: calls });
    const nativeGetDirectory = navigator.storage.getDirectory.bind(navigator.storage);
    const nativeHandle = async () => { const dir = await nativeGetDirectory(); return dir.getFileHandle('synthetic-library.json', { create: true }); };
    Object.assign(window, { syntheticHandle: nativeHandle });
    navigator.storage.getDirectory = async () => { calls.push('opfs'); throw new Error('The app must not use OPFS'); };
    Storage.prototype.setItem = () => { calls.push('storage'); throw new Error('The app must not use Web Storage'); };
    const nativeOpen = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (name, version) { if (name !== sessionDb) { calls.push('other-db'); throw new Error('Unexpected database'); } return nativeOpen.call(this, name, version); };
    const proto = FileSystemFileHandle.prototype as FileSystemFileHandle & { queryPermission(): Promise<PermissionState>; requestPermission(options: { mode: string }): Promise<PermissionState> };
    proto.queryPermission = async () => (window as unknown as { syntheticPermission: PermissionState }).syntheticPermission;
    proto.requestPermission = async options => { calls.push(`permission:${options.mode}`); const s = window as unknown as { syntheticPermission: PermissionState }; if (s.syntheticPermission !== 'denied') s.syntheticPermission = 'granted'; return s.syntheticPermission; };
    Object.assign(window, { async showOpenFilePicker() { calls.push('picker'); return [await nativeHandle()]; }, async showSaveFilePicker() { calls.push('picker'); return nativeHandle(); } });
  }, { permission, sessionDb });
  await page.goto('http://127.0.0.1:4173/synthetic-local.html'); await expect(page.getByRole('button', { name: '新しく作る', exact: true })).toBeEnabled();
}
test('welcome actions are centered with no top-right duplicates; file:// preview ON/OFF survives reload', async ({ page }) => {
  await page.goto(fileUrl); const welcome = page.locator('.viewer-welcome'); await expect(welcome.getByRole('button', { name: '新しく作る' })).toBeEnabled();
  await expect(page.locator('.local-file-bar')).toHaveCount(0); await expect(page.locator('.topbar')).toHaveCount(0); await expect(welcome.locator('p')).toHaveText('管理JSONを開くか新しく作成してください。X API v2のJSON、like.js、拡張の投稿バックアップを追加できます。');
  const center = await welcome.evaluate(element => { const buttons = element.querySelector('.actions')!; const box = element.getBoundingClientRect(); const children = [...buttons.children].map(e => e.getBoundingClientRect()); return Math.abs((children[0]!.left + children.at(-1)!.right) / 2 - (box.left + box.right) / 2); }); expect(center).toBeLessThan(2);
  await welcome.getByRole('button', { name: '新しく作る' }).click(); await page.getByRole('checkbox', { name: '画像プレビュー', exact: true }).check();
  await expect.poll(async () => (await metadata(page)).values).toEqual([true]); page.once('dialog', d => d.accept()); await page.reload();
  await page.getByRole('button', { name: '新しく作る', exact: true }).click(); await expect(page.getByRole('checkbox', { name: '画像プレビュー', exact: true })).toBeChecked();
  await page.getByRole('checkbox', { name: '画像プレビュー', exact: true }).uncheck(); await expect.poll(async () => (await metadata(page)).values).toEqual([false]); page.once('dialog', d => d.accept()); await page.reload();
  await page.getByRole('button', { name: '新しく作る', exact: true }).click(); await expect(page.getByRole('checkbox', { name: '画像プレビュー', exact: true })).not.toBeChecked();
  expect((await metadata(page)).keys).toEqual(['previews']);
});
test('native handle and previews reopen automatically without keeping post JSON in IndexedDB', async ({ page }) => {
  await nativeStart(page); await addAndSave(page); await page.getByRole('checkbox', { name: '画像プレビュー', exact: true }).check();
  await expect.poll(async () => (await metadata(page)).keys).toEqual(['file', 'previews']);
  const m = await metadata(page); expect(m.stores).toEqual(['preferences']); expect(m.values).toEqual([{ name: 'synthetic-library.json', kind: 'file', native: true }, true]);
  await page.reload(); await expect(page.getByRole('heading', { name: 'すべてのいいね', exact: true })).toBeVisible(); await expect(page.locator('.post-card')).toHaveCount(2);
  await expect(page.getByRole('checkbox', { name: '画像プレビュー', exact: true })).toBeChecked(); await expect(page.locator('.viewer-welcome')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { syntheticCalls: string[] }).syntheticCalls)).toEqual([]);
  await page.getByRole('button', { name: '設定', exact: true }).click(); await page.getByRole('button', { name: '選択の記憶を消す', exact: true }).click();
  await expect.poll(async () => (await metadata(page)).keys).toEqual(['previews']); await page.reload(); await expect(page.getByRole('heading', { name: 'ローカルライブラリ', exact: true })).toBeVisible();
});
test('permission expiry keeps the file selected and requests only read access on an Open click', async ({ page }) => {
  await nativeStart(page, 'prompt'); await addAndSave(page); await page.reload(); const welcome = page.locator('.viewer-welcome'); await expect(welcome).toContainText('synthetic-library.json');
  await expect(welcome.getByRole('button', { name: '開く', exact: true })).toBeEnabled(); expect(await page.evaluate(() => (window as unknown as { syntheticCalls: string[] }).syntheticCalls)).toEqual([]);
  await welcome.getByRole('button', { name: '開く', exact: true }).click(); await expect(page.locator('.post-card')).toHaveCount(2);
  expect(await page.evaluate(() => (window as unknown as { syntheticCalls: string[] }).syntheticCalls)).toEqual(['permission:read']);
});
test('permission refusal, corrupt or missing files retain the remembered selection and allow recovery', async ({ page }) => {
  await nativeStart(page, 'denied'); await addAndSave(page); await page.reload(); await page.getByRole('button', { name: '開く', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('許可されません');
  await page.evaluate(async () => { const w = window as unknown as { syntheticPermission: PermissionState; syntheticHandle(): Promise<FileSystemFileHandle> }; w.syntheticPermission = 'granted'; const h = await w.syntheticHandle(); const s = await h.createWritable(); await s.write('malformed'); await s.close(); });
  await page.getByRole('button', { name: '開く', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('ファイルを開けません'); await expect(page.locator('.viewer-welcome')).toContainText('synthetic-library.json');
  await page.evaluate(async () => { const h = await (window as unknown as { syntheticHandle(): Promise<FileSystemFileHandle & { remove(): Promise<void> }> }).syntheticHandle(); await h.remove(); });
  await page.getByRole('button', { name: '開く', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('ファイルを開けません');
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '選択の記憶を消す', exact: true }).click(); await expect(page.locator('.viewer-welcome')).not.toContainText('synthetic-library.json'); await page.getByRole('button', { name: '新しく作る', exact: true }).click(); await expect(page.locator('.local-save')).toBeEnabled();
});
