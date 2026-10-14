import { expect, test, type Page } from './fixtures';

async function openPopup(page: Page, source: 'bookmarks' | 'likes', language = 'ja', initialRun: unknown = null, inspectionFailures = 0) {
  await page.addInitScript(({ source, language, initialRun, inspectionFailures }) => {
    const sent: Record<string, unknown>[] = []; const opened: string[] = []; let run = initialRun as Record<string, unknown> | null;
    const inspection = { source, failures: inspectionFailures, malformed: false, legacyStatus: false, deferNext: false, release: null as (() => void) | null };
    Object.assign(window, { syntheticPopup: { sent, opened, inspection }, chrome: {
      i18n: { getUILanguage: () => language },
      runtime: { id: 'synthetic-popup', getURL: (path: string) => `${location.origin}/${path}`, sendMessage: async (message: Record<string, unknown>) => {
        sent.push(structuredClone(message));
        if (message.type === 'INSPECT_TAB') {
          if (inspection.failures-- > 0) return { ok: false, error: 'Xのブックマーク画面を開いてください' };
          const value = { handle: 'synthetic_user', documentId: 'doc', source: inspection.malformed ? undefined : inspection.source };
          if (inspection.deferNext) { inspection.deferNext = false; await new Promise<void>(resolve => { inspection.release = resolve; }); }
          return { ok: true, value };
        }
        if (message.type === 'START') { run = { ...(message.options as Record<string, unknown>), source: message.source, id: 'synthetic-run', state: 'running', reason: null, observed: 0, added: 0, existing: 0 }; }
        return { ok: true, value: inspection.legacyStatus ? { ...run, source: undefined } : run?.source === message.source ? run : undefined };
      } },
      tabs: { query: async () => [{ id: 11 }], create: async ({ url }: { url: string }) => { opened.push(url); return { id: 12 }; } },
    } });
  }, { source, language, initialRun, inspectionFailures });
  await page.setViewportSize({ width: 380, height: 600 });
  await page.goto(`/popup.html?source=${source}`);
  if (inspectionFailures < 3) await expect(page.locator('.account')).toContainText('@synthetic_user');
  else await expect(page.getByRole('button', { name: /^(対象を再確認|Check current page again)$/ })).toBeEnabled();
  await expect(page.locator('html')).toHaveAttribute('lang', language);
}
async function lastStart(page: Page) {
  return page.evaluate(() => (window as unknown as { syntheticPopup: { sent: Record<string, unknown>[] } }).syntheticPopup.sent.slice().reverse().find(message => message.type === 'START'));
}
async function savedPreferences(page: Page) {
  return page.evaluate(async () => { const path = '/src/popup-preferences.ts'; return (await import(path)).loadPopupPreferences(); });
}
async function syntheticAiConnection(page: Page, connected = true) {
  await page.evaluate(async connected => { const path = '/src/db.ts'; const { db } = await import(path);
    if (connected) await db.settings.put({ key: 'decisionConnection', value: { endpoint: 'http://127.0.0.1:1234', model: 'd1-3b', threshold: 0.8, images: false } });
    else await db.settings.delete('decisionConnection');
  }, connected);
}
for (const source of ['bookmarks', 'likes'] as const) test(`normalizes full-width fixed/random wait and count inputs for ${source}, remembers them and sends numeric options`, async ({ page }) => {
  await openPopup(page, source);
  await page.getByLabel('待機（秒）').fill('５'); await page.getByLabel('今回の上限（件）').fill('２００');
  await expect(page.getByLabel('待機（秒）')).toHaveValue('5'); await expect(page.getByLabel('今回の上限（件）')).toHaveValue('200');
  await expect.poll(() => savedPreferences(page)).toMatchObject({ source, intervalMs: 5000, maxPosts: 200 });
  await page.reload(); await expect(page.getByLabel('待機（秒）')).toHaveValue('5'); await expect(page.getByLabel('今回の上限（件）')).toHaveValue('200');
  await page.getByLabel('待機方法').selectOption('random');
  await page.getByLabel('最長（秒）').fill('９'); await page.getByLabel('最短（秒）').fill('４．');
  await expect(page.getByLabel('最短（秒）')).toHaveValue('4.');
  await page.getByLabel('最短（秒）').press('5'); await expect(page.getByLabel('最短（秒）')).toHaveValue('4.5');
  await expect(page.getByLabel('最長（秒）')).toHaveValue('9');
  await expect.poll(() => savedPreferences(page)).toMatchObject({ source, waitMode: 'random', intervalMs: 4500, intervalMaxMs: 9000, maxPosts: 200 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (source === 'likes') await page.screenshot({ path: '/tmp/xbs-popup-normalized-ja.png' });
  await page.locator('.primary.full').click();
  await expect.poll(() => lastStart(page)).toMatchObject({ source, options: { intervalMs: 4500, intervalMaxMs: 9000, maxPosts: 200 } });
});
test('IME composition keeps the draft and last saved value until confirmation, while blanks and invalid numbers cannot start', async ({ page }) => {
  await openPopup(page, 'likes', 'en');
  const wait = page.getByLabel('Wait (seconds)');
  await wait.fill('5'); await expect.poll(() => savedPreferences(page)).toHaveProperty('intervalMs', 5000);
  await wait.evaluate(input => {
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    (input as HTMLInputElement).value = '４';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '４', inputType: 'insertCompositionText', isComposing: true }));
  });
  await expect(wait).toHaveValue('４'); await expect(page.locator('.primary.full')).toBeDisabled();
  expect(await savedPreferences(page)).toHaveProperty('intervalMs', 5000); expect(await lastStart(page)).toBeUndefined();
  await wait.evaluate(input => input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '４' })));
  await expect(wait).toHaveValue('4'); await expect.poll(() => savedPreferences(page)).toHaveProperty('intervalMs', 4000);
  await expect(page.locator('.primary.full')).toBeEnabled();
  for (const value of ['３秒', '', '３１', '１x２']) {
    await wait.fill(value); await expect(page.locator('.primary.full')).toBeDisabled();
    expect(await savedPreferences(page)).toHaveProperty('intervalMs', 4000);
  }
  await expect(wait).toHaveValue('1x2'); await wait.fill('６');
  await expect.poll(() => savedPreferences(page)).toHaveProperty('intervalMs', 6000);
  await page.getByLabel('Posts per run').fill('１００１'); await expect(page.locator('.primary.full')).toBeDisabled();
  expect(await savedPreferences(page)).toHaveProperty('maxPosts', 100);
  await page.getByLabel('Posts per run').fill('２００．５'); await expect(page.locator('.primary.full')).toBeDisabled();
  expect(await savedPreferences(page)).toHaveProperty('maxPosts', 100);
  await page.getByLabel('Posts per run').fill('２００'); await expect(page.locator('.primary.full')).toBeEnabled();
  await expect.poll(() => savedPreferences(page)).toMatchObject({ intervalMs: 6000, maxPosts: 200 });
});
test('visible Likes overrides a stored bookmark choice and stale source URL without resetting wait options', async ({ page }) => {
  await openPopup(page, 'likes');
  await page.getByLabel('取り込み対象').selectOption('bookmarks');
  await page.getByLabel('待機（秒）').fill('7'); await page.getByLabel('今回の上限（件）').fill('20');
  await expect.poll(() => savedPreferences(page)).toMatchObject({ source: 'bookmarks', intervalMs: 7000, maxPosts: 20 });
  await page.goto('/popup.html?source=bookmarks');
  await expect(page.getByLabel('取り込み対象')).toHaveValue('likes');
  await expect(page.getByLabel('待機（秒）')).toHaveValue('7'); await expect(page.getByLabel('今回の上限（件）')).toHaveValue('20');
  await expect(page.locator('.primary.full')).toBeEnabled(); await expect(page.locator('.popup-target-hint')).toHaveCount(0);
  await page.locator('.primary.full').click(); await expect.poll(() => lastStart(page)).toMatchObject({ source: 'likes', options: { intervalMs: 7000, maxPosts: 20 } });
});
test('an initially loading History collection is checked again before enabling import', async ({ page }) => {
  await openPopup(page, 'likes', 'ja', null, 2);
  await expect(page.getByLabel('取り込み対象')).toHaveValue('likes'); await expect(page.locator('.primary.full')).toBeEnabled();
  const calls = await page.evaluate(() => (window as unknown as { syntheticPopup: { sent: { type: string }[] } }).syntheticPopup.sent.filter(m => m.type === 'INSPECT_TAB').length);
  expect(calls).toBe(3); await expect(page.getByRole('alert')).toHaveCount(0); expect(await lastStart(page)).toBeUndefined();
});
test('a failed first inspection can be retried and no stale bookmark error remains on Likes', async ({ page }) => {
  await openPopup(page, 'likes', 'en', null, 3);
  await expect(page.locator('.primary.full')).toBeDisabled(); await expect(page.getByRole('alert')).toContainText('Reload the extension');
  await page.getByRole('button', { name: 'Check current page again', exact: true }).click();
  await expect(page.locator('.account')).toContainText('@synthetic_user'); await expect(page.locator('.primary.full')).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0); await expect(page.getByLabel('Import source')).toHaveValue('likes');
});
test('an inspection with a missing source stays blocked until a valid page can be checked', async ({ page }) => {
  await openPopup(page, 'likes', 'en');
  await page.evaluate(() => { (window as unknown as { syntheticPopup: { inspection: { malformed: boolean } } }).syntheticPopup.inspection.malformed = true; });
  await page.getByLabel('Import source').selectOption('bookmarks');
  await expect(page.getByRole('alert')).toContainText('Reload the extension'); await expect(page.locator('.primary.full')).toBeDisabled();
  expect(await lastStart(page)).toBeUndefined();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/xbs-popup-recheck-en.png' });
  await page.evaluate(() => { (window as unknown as { syntheticPopup: { inspection: { malformed: boolean } } }).syntheticPopup.inspection.malformed = false; });
  await page.getByRole('button', { name: 'Check current page again', exact: true }).click();
  await expect(page.getByLabel('Import source')).toHaveValue('likes'); await expect(page.locator('.primary.full')).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test('a late response from an earlier source selection cannot disable the newer matching target', async ({ page }) => {
  await openPopup(page, 'bookmarks');
  await page.evaluate(() => { const inspection = (window as unknown as { syntheticPopup: { inspection: { source: string; deferNext: boolean } } }).syntheticPopup.inspection; inspection.source = 'likes'; inspection.deferNext = true; });
  await page.getByLabel('取り込み対象').selectOption('likes');
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { syntheticPopup: { inspection: { release: unknown } } }).syntheticPopup.inspection.release)).toBe('function');
  await page.evaluate(() => { (window as unknown as { syntheticPopup: { inspection: { source: string } } }).syntheticPopup.inspection.source = 'bookmarks'; });
  await page.getByLabel('取り込み対象').selectOption('bookmarks'); await expect(page.locator('.primary.full')).toBeEnabled();
  await page.evaluate(async () => { (window as unknown as { syntheticPopup: { inspection: { release: () => void } } }).syntheticPopup.inspection.release(); await new Promise<void>(resolve => setTimeout(resolve, 0)); });
  await expect(page.getByLabel('取り込み対象')).toHaveValue('bookmarks'); await expect(page.locator('.primary.full')).toBeEnabled();
  await page.locator('.primary.full').click(); await expect.poll(() => lastStart(page)).toHaveProperty('source', 'bookmarks');
});
test('manual source selection refreshes page identity and opposite-source legacy history cannot be displayed or stopped', async ({ page }) => {
  await openPopup(page, 'bookmarks');
  await page.evaluate(() => { (window as unknown as { syntheticPopup: { inspection: { source: string } } }).syntheticPopup.inspection.source = 'likes'; });
  await page.getByLabel('取り込み対象').selectOption('likes'); await expect(page.locator('.primary.full')).toBeEnabled();
  await page.locator('.primary.full').click(); await expect.poll(() => lastStart(page)).toHaveProperty('source', 'likes');
  await page.evaluate(() => { (window as unknown as { syntheticPopup: { inspection: { legacyStatus: boolean } } }).syntheticPopup.inspection.legacyStatus = true; });
  await expect(page.locator('.progress')).toHaveCount(0); await expect(page.getByRole('alert')).toContainText('再読み込み');
  await expect(page.getByRole('button', { name: '一時停止', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { syntheticPopup: { sent: { type: string }[] } }).syntheticPopup.sent.filter(m => m.type === 'STOP').length)).toBe(0);
});

test('explicit Likes selection cannot start from Bookmarks and opens the owner’s Likes', async ({ page }) => {
  await openPopup(page, 'bookmarks');
  await expect(page.getByLabel('取り込み対象')).toHaveValue('bookmarks');
  await page.getByLabel('取り込み対象').selectOption('likes');
  await expect(page.locator('.primary.full')).toBeDisabled();
  await expect(page.locator('.popup-target-hint')).toContainText('自分のいいね');
  await page.getByRole('button', { name: 'Xのいいねを開く', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { syntheticPopup: { opened: string[] } }).syntheticPopup.opened)).toEqual(['https://x.com/synthetic_user/likes']);
  expect(await lastStart(page)).toBeUndefined();
  await page.getByLabel('取り込み対象').selectOption('bookmarks'); await expect(page.locator('.primary.full')).toBeEnabled();
});
test('random bounds validate in the popup and Likes start sends the range in milliseconds', async ({ page }) => {
  await openPopup(page, 'likes'); await expect(page.getByLabel('待機方法')).toHaveValue('fixed');
  await page.getByLabel('待機方法').selectOption('random'); await page.getByLabel('最長（秒）').fill('8');
  await page.getByLabel('最短（秒）').fill('2'); await expect(page.locator('.primary.full')).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('3〜30秒');
  await page.getByLabel('最短（秒）').fill('3'); await page.getByLabel('最長（秒）').fill('2'); await expect(page.locator('.primary.full')).toBeDisabled();
  await page.getByLabel('最長（秒）').fill('31'); await expect(page.locator('.primary.full')).toBeDisabled();
  await page.getByLabel('最長（秒）').fill('8'); await page.getByLabel('今回の上限（件）').fill('10');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/xbs-popup-random-ja.png' });
  await page.locator('.primary.full').click();
  await expect.poll(() => lastStart(page)).toMatchObject({ source: 'likes', tabId: 11, handle: 'synthetic_user', options: { intervalMs: 3000, intervalMaxMs: 8000, maxPosts: 10, mode: 'full' } });
  await expect(page.getByLabel('取り込み対象')).toBeDisabled(); await expect(page.getByLabel('最短（秒）')).toBeDisabled();
});
test('English popup hydrates a saved random run and fixed restart omits the optional upper bound', async ({ page }) => {
  await openPopup(page, 'likes', 'en', { id: 'saved', source: 'likes', state: 'paused', reason: 'user_pause', intervalMs: 6000, intervalMaxMs: 9000, maxPosts: 100, mode: 'full', observed: 10, added: 10, existing: 0 });
  await expect(page.getByLabel('Wait mode')).toHaveValue('random'); await expect(page.getByLabel('Minimum (seconds)')).toHaveValue('6');
  await expect(page.getByLabel('Maximum (seconds)')).toHaveValue('9');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/xbs-popup-random-en.png' });
  await page.getByLabel('Wait mode').selectOption('fixed'); await expect(page.getByLabel('Maximum (seconds)')).toHaveCount(0);
  await page.locator('.primary.full').click();
  await expect.poll(() => lastStart(page)).toMatchObject({ source: 'likes', options: { intervalMs: 6000, maxPosts: 100, mode: 'full' } });
  const sent = await lastStart(page);
  expect(sent?.options).not.toHaveProperty('intervalMaxMs');
});

test('remembers unstarted options while selecting the visible collection after reopening', async ({ page }) => {
  await openPopup(page, 'bookmarks');
  await syntheticAiConnection(page); await page.getByLabel('取り込み中に自動マークを付ける').check();
  await page.getByLabel('取り込み対象').selectOption('likes');
  await page.getByLabel('待機方法').selectOption('random');
  await page.getByLabel('最長（秒）').fill('9');
  await page.getByLabel('最短（秒）').fill('5');
  await page.getByLabel('今回の上限（件）').fill('250');
  await page.getByLabel('取り込み範囲').selectOption('delta');
  await expect.poll(() => savedPreferences(page)).toMatchObject({ source: 'likes', waitMode: 'random', intervalMs: 5000, intervalMaxMs: 9000, maxPosts: 250, mode: 'delta', autoMark: true });
  expect(await lastStart(page)).toBeUndefined();
  await page.goto('/popup.html');
  await expect(page.getByLabel('取り込み対象')).toHaveValue('bookmarks');
  await expect(page.getByLabel('取り込み中に自動マークを付ける')).toBeChecked();
  await expect(page.getByLabel('最短（秒）')).toHaveValue('5'); await expect(page.getByLabel('最長（秒）')).toHaveValue('9');
  await expect(page.getByLabel('今回の上限（件）')).toHaveValue('250'); await expect(page.getByLabel('取り込み範囲')).toHaveValue('delta');
  await expect(page.locator('.primary.full')).toBeEnabled();
  await page.getByLabel('待機方法').selectOption('fixed');
  await expect.poll(() => savedPreferences(page)).toHaveProperty('waitMode', 'fixed');
  await page.reload(); await expect(page.getByLabel('待機方法')).toHaveValue('fixed');
  await expect(page.getByLabel('待機（秒）')).toHaveValue('5');
  await page.getByLabel('待機方法').selectOption('random'); await expect(page.getByLabel('最長（秒）')).toHaveValue('9');
  await page.getByLabel('取り込み中に自動マークを付ける').uncheck(); await expect.poll(() => savedPreferences(page)).toHaveProperty('autoMark', false);
  await page.getByLabel('最短（秒）').fill(''); await page.getByLabel('取り込み中に自動マークを付ける').check();
  await expect.poll(() => savedPreferences(page)).toMatchObject({ autoMark: true, intervalMs: 5000, intervalMaxMs: 9000, maxPosts: 250 });
  await expect(page.getByLabel('最短（秒）')).toHaveValue('');
  await page.getByLabel('取り込み中に自動マークを付ける').uncheck(); await expect.poll(() => savedPreferences(page)).toHaveProperty('autoMark', false);
  await page.reload(); await expect(page.getByLabel('取り込み中に自動マークを付ける')).not.toBeChecked();
  await page.locator('.primary.full').click(); await expect.poll(() => lastStart(page)).toHaveProperty('autoMark', false);
});
test('retains the auto-mark choice while disconnected, gates START, and restores it when reconnected', async ({ page }) => {
  await openPopup(page, 'likes', 'en');
  await page.evaluate(async () => { const path = '/src/popup-preferences.ts'; const { savePopupPreferences, preferencesFromOptions } = await import(path);
    await savePopupPreferences(preferencesFromOptions('likes', { intervalMs: 3000, maxPosts: 100, mode: 'full' }, true));
  });
  await page.reload(); const checkbox = page.getByLabel('Auto-mark during import', { exact: true });
  await expect(checkbox).toBeDisabled(); await expect(checkbox).not.toBeChecked();
  await expect(page.getByText('Connect to local AI in Settings.', { exact: true })).toBeVisible();
  expect(await savedPreferences(page)).toHaveProperty('autoMark', true); expect(await lastStart(page)).toBeUndefined();
  await page.locator('.primary.full').click(); await expect.poll(() => lastStart(page)).toHaveProperty('autoMark', false);
  await page.reload(); await syntheticAiConnection(page); await expect(checkbox).toBeChecked(); await expect(checkbox).toBeEnabled();
  await page.reload(); await expect(checkbox).toBeChecked(); expect(await lastStart(page)).toBeUndefined();
  await syntheticAiConnection(page, false); await expect(checkbox).toBeDisabled(); await expect(checkbox).not.toBeChecked();
  expect(await savedPreferences(page)).toHaveProperty('autoMark', true);
  await syntheticAiConnection(page); await expect(checkbox).toBeChecked(); await expect(checkbox).toBeEnabled();
  await page.locator('.primary.full').click(); await expect.poll(() => lastStart(page)).toHaveProperty('autoMark', true);
});
test('stopped status cannot replace newer edits and invalid edits keep the last valid saved values', async ({ page }) => {
  await openPopup(page, 'likes', 'en', { id: 'saved', source: 'likes', state: 'stopped', reason: 'run_limit', intervalMs: 6000, intervalMaxMs: 9000, maxPosts: 100, mode: 'full', observed: 10, added: 10, existing: 0 });
  await expect(page.getByLabel('Minimum (seconds)')).toHaveValue('6');
  await page.getByLabel('Maximum (seconds)').fill('12'); await page.getByLabel('Posts per run').fill('200');
  await expect.poll(() => savedPreferences(page)).toMatchObject({ intervalMaxMs: 12000, maxPosts: 200 });
  await page.getByLabel('Maximum (seconds)').fill('2'); await expect(page.locator('.primary.full')).toBeDisabled();
  await page.reload();
  await expect(page.getByLabel('Maximum (seconds)')).toHaveValue('12'); await expect(page.getByLabel('Posts per run')).toHaveValue('200');
  await expect.poll(() => page.evaluate(() => (window as unknown as { syntheticPopup: { sent: { type: string }[] } }).syntheticPopup.sent.filter(message => message.type === 'STATUS').length)).toBeGreaterThan(1);
  await expect(page.getByLabel('Maximum (seconds)')).toHaveValue('12');
});
test('running options override the remembered form without overwriting the remembered choices', async ({ page }) => {
  const run = { id: 'active', source: 'likes', state: 'running', reason: null, intervalMs: 6000, intervalMaxMs: 9000, maxPosts: 100, mode: 'full', observed: 10, added: 10, existing: 0 };
  await openPopup(page, 'likes', 'en', run);
  await syntheticAiConnection(page);
  await page.evaluate(async () => { const path = '/src/popup-preferences.ts'; const { savePopupPreferences } = await import(path); await savePopupPreferences({ source: 'likes', waitMode: 'fixed', intervalMs: 3000, intervalMaxMs: 8000, maxPosts: 250, mode: 'delta', autoMark: true }); });
  await page.reload(); await expect(page.getByLabel('Minimum (seconds)')).toHaveValue('6'); await expect(page.getByLabel('Maximum (seconds)')).toHaveValue('9');
  await expect(page.getByLabel('Minimum (seconds)')).toBeDisabled();
  await expect(page.getByLabel('Auto-mark during import', { exact: true })).toBeChecked();
  expect(await savedPreferences(page)).toMatchObject({ waitMode: 'fixed', intervalMs: 3000, maxPosts: 250 });
});
test('a failed preference write reports the failure and retains the last committed values', async ({ page }) => {
  await openPopup(page, 'likes', 'en');
  await page.getByLabel('Wait (seconds)').fill('5');
  await expect.poll(() => savedPreferences(page)).toHaveProperty('intervalMs', 5000);
  await syntheticAiConnection(page); await page.getByLabel('Auto-mark during import', { exact: true }).check();
  await expect.poll(() => savedPreferences(page)).toHaveProperty('autoMark', true);
  await page.evaluate(async () => { const path = '/src/db.ts'; const { db } = await import(path); db.settings.put = async () => { throw new Error('synthetic-quota'); }; });
  await page.getByLabel('Wait (seconds)').fill('6');
  await page.getByLabel('Auto-mark during import', { exact: true }).uncheck();
  await expect(page.getByRole('alert')).toHaveText('Could not save import preferences');
  await expect(page.getByLabel('Wait (seconds)')).toHaveValue('6');
  await page.reload(); await expect(page.getByLabel('Wait (seconds)')).toHaveValue('5');
  await expect(page.getByLabel('Auto-mark during import', { exact: true })).toBeChecked();
});
