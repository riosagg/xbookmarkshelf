import { expect, test } from '@playwright/test';

async function seedGallery(page: import('@playwright/test').Page) {
  await page.goto('/library.html');
  await page.evaluate(async () => {
    const path = '/src/db.ts'; const { db } = await import(path);
    await db.settings.put({ key: 'accounts', value: [{ id: 'a', handle: 'design_notes' }, { id: 'b', handle: 'tech_notes' }] });
    const examples: [string, string, string, string, string, string][] = [
      ['1', 'a', 'Design Notes', '余白を整えるだけで、情報は読みやすくなる。\nカードの中には一つの話題を。詳しい内容は開いて読めるように。', 'design', '読書'],
      ['2', 'a', 'Frontend Lab', 'ローカルファーストな道具を作る。\nネットに接続できない日も、保存した知識は手元に残っている。', 'frontend', '開発'],
      ['3', 'a', 'Reading Room', '週末に読みたい記事を集めておく。\n気になった投稿にはタグをつけて、あとから見つけられるように。', 'reading', '読書'],
      ['4', 'a', 'Small Ideas', '軽い道具を、毎日の習慣に。\n検索、整理、読み返す。その小さな繰り返しを気持ちよく。', 'ideas', 'デザイン'],
      ['5', 'b', 'Code Journal', 'IndexedDBのトランザクションで、投稿と状態を保護する。', 'code', '開発'],
      ['6', 'b', 'Daily Capture', '今日見つけたアイデアをメモ。\n大切なものには、お気に入りの星を。', 'daily', 'デザイン'],
    ];
    for (const [postId, accountId, authorName, text, authorHandle, tag] of examples) {
      const date = `2026-10-0${postId}T08:00:00.000Z`;
      await db.posts.put({ accountId, postId, authorName, authorHandle, text, url: `https://x.com/${authorHandle}/status/${postId}`, partial: true, postedAt: date, observedAt: date, firstImportedAt: date, lastImportedAt: date,
        media: ['1', '2', '4'].includes(postId) ? [{ kind: 'image', url: `https://pbs.twimg.com/media/synthetic-${postId}.svg` }] : [] });
      const tagKey: Record<string, string> = { '読書': 'reading', '開発': 'development', 'デザイン': 'design' };
      const tagId = `${accountId}-${tagKey[tag]}`;
      await db.tags.put({ id: tagId, accountId, name: tag });
      await db.postTags.put({ accountId, postId, tagId });
      await db.userStates.put({ accountId, postId, read: ['2', '5'].includes(postId), favorite: ['1', '5'].includes(postId) });
    }
  });
  await page.reload();
  await expect(page.locator('.post-card')).toHaveCount(6);
}

test('bounds legacy tag chips while retaining complete edits and maximum-length URL text', async ({ page }) => {
  await seedGallery(page);
  await page.evaluate(async () => {
    const path = '/src/db.ts'; const { db } = await import(path);
    await db.postTags.where('[accountId+postId]').equals(['a', '1']).delete();
    const tags = Array.from({ length: 1000 }, (_, i) => ({ id: `legacy-${i}`, accountId: 'a', name: `Legacy ${String(i).padStart(4, '0')} ${'長'.repeat(80)}` }));
    await db.tags.bulkPut(tags);
    await db.postTags.bulkPut(tags.map(t => ({ accountId: 'a', postId: '1', tagId: t.id })));
    const url = 'https://example.invalid/';
    await db.posts.update(['a', '1'], { text: url + ')'.repeat(50000 - url.length) });
  });
  await page.setViewportSize({ width: 390, height: 844 }); await page.reload();
  const card = page.locator('.card-grid .post-card').filter({ hasText: 'Design Notes' });
  await expect(card.locator('.tag-chip')).toHaveCount(20);
  await expect(card).toContainText('ほか980個のタグ・マークを保存しています。編集から確認できます。');
  await card.getByRole('button', { name: 'タグを編集', exact: true }).click();
  await expect(card.getByLabel('designのタグ', { exact: true })).toHaveValue(/Legacy 0999/);
  await card.getByRole('button', { name: 'タグを保存', exact: true }).click();
  await expect(card.getByRole('alert')).toContainText('タグは20個まで');
  expect(await page.evaluate(async () => { const path = '/src/db.ts'; return (await (await import(path)).db.postTags.where('[accountId+postId]').equals(['a', '1']).count()); })).toBe(1000);
  await card.getByRole('button', { name: '閉じる', exact: true }).click();
  await card.locator('summary').click();
  const detail = page.getByRole('dialog', { name: '投稿の詳細', exact: true });
  await expect(detail.locator('.post-body a')).toHaveAttribute('href', 'https://example.invalid/');
  await expect(detail.locator('.tag-chip')).toHaveCount(20);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await page.getByLabel('本文URL', { exact: true }).selectOption('with');
  await expect(page.locator('.card-grid .post-card')).toHaveCount(1);
  await page.evaluate(async () => { const path = '/src/db.ts'; await (await import(path)).db.settings.put({ key: 'language', value: 'en' }); });
  await page.reload();
  await expect(page.locator('.card-grid .post-card').filter({ hasText: 'Design Notes' })).toContainText('980 more tags and marks are stored. Open Edit tags to view them.');
});

test('rejects excessive JSON assignments at preview and rolls back mapped union overflow', async ({ page }) => {
  await seedGallery(page);
  const original = await page.evaluate(async () => { const path = '/src/db.ts'; const { db } = await import(path); return Promise.all(db.tables.map(async (table: { name: string; toArray(): Promise<unknown[]> }) => [table.name, await table.toArray()])); });
  const input = await page.evaluate(async () => {
    const path = '/src/backup.ts'; const backup = await (await import(path)).createBackup();
    backup.tags = Array.from({ length: 21 }, (_, i) => ({ id: `incoming-${i}`, accountId: 'a', name: `Incoming ${i}` }));
    backup.postTags = backup.tags.map((t: { id: string }) => ({ accountId: 'a', postId: '1', tagId: t.id }));
    return backup;
  });
  await page.getByRole('button', { name: 'バックアップ', exact: true }).click();
  const file = page.getByLabel('復元するJSON', { exact: true });
  await file.setInputFiles({ name: 'synthetic-overflow.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(input)) });
  await expect(page.getByRole('alert')).toContainText('タグとマークは合計20個までです');
  await expect(page.getByRole('button', { name: '検証済みJSONを復元', exact: true })).toHaveCount(0);
  input.tags.pop(); input.postTags.pop();
  input.posts[0].text = '復元を取り消す合成本文';
  await file.setInputFiles({ name: 'synthetic-union.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(input)) });
  await page.getByRole('button', { name: '検証済みJSONを復元', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('タグとマークは合計20個までです');
  const after = await page.evaluate(async () => { const path = '/src/db.ts'; const { db } = await import(path); return Promise.all(db.tables.map(async (table: { name: string; toArray(): Promise<unknown[]> }) => [table.name, await table.toArray()])); });
  expect(after).toEqual(original);
});

test('opening text marks it read and keeps detail visible after it leaves the unread list', async ({ page }) => {
  await seedGallery(page);
  const nav = page.getByRole('navigation', { name: 'ライブラリ', exact: true });
  await page.getByLabel('アカウント', { exact: true }).selectOption('a');
  await nav.getByRole('button', { name: /^あとで読む/ }).click();
  await expect(page.locator('.card-grid .post-card')).toHaveCount(3);
  const sidebarTop = (await page.locator('.sidebar').boundingBox())!.y;
  await page.locator('.card-grid .post-card').filter({ hasText: 'Design Notes' }).locator('summary').click();
  const detail = page.getByRole('dialog', { name: '投稿の詳細', exact: true });
  await expect(detail).toBeVisible();
  expect((await page.locator('.sidebar').boundingBox())!.y).toBe(sidebarTop);
  await expect(detail.getByRole('button', { name: '既読 ✓', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(async () => { const path = '/src/db.ts'; return (await (await import(path)).db.userStates.get(['a', '1']))?.favorite; })).toBe(true);
  await expect(page.locator('.card-grid .post-card')).toHaveCount(2);
  await expect(detail.locator('.post-body')).toContainText('余白を整える');
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
  await nav.getByRole('button', { name: /^すべてのブックマーク/ }).click();
  const card = page.locator('.card-grid .post-card').filter({ hasText: 'Reading Room' });
  await card.locator('summary').click();
  await expect(detail).toBeVisible();
  await detail.getByRole('button', { name: '詳細を閉じる', exact: true }).click();
  await expect(card.getByRole('button', { name: '既読 ✓', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.card-grid .post-card').filter({ hasText: 'Reading Room' }).getByRole('button', { name: '既読 ✓', exact: true })).toBeVisible();
});

test('named marks promote existing tags, toggle with one click and preserve links on rename, tag save and demotion', async ({ page }) => {
  await seedGallery(page);
  const nav = page.getByRole('navigation', { name: 'ライブラリ', exact: true });
  await page.getByRole('button', { name: 'マークを管理', exact: true }).click();
  await page.getByRole('button', { name: '読書', exact: true }).click();
  await page.getByRole('button', { name: '本のアイコン', exact: true }).click();
  await page.getByRole('button', { name: 'マークを保存', exact: true }).click();
  await expect(page.locator('.side-marks').getByRole('button', { name: /^読書/ })).toContainText('2');
  await page.getByLabel('マークの名前', { exact: true }).fill('研究');
  await page.getByRole('button', { name: '旗のアイコン', exact: true }).click();
  await page.getByRole('button', { name: 'マークを保存', exact: true }).click();
  await expect(page.locator('.side-marks').getByRole('button', { name: /^研究/ })).toBeVisible();
  await nav.getByRole('button', { name: /^すべてのブックマーク/ }).click();
  const card = page.locator('.card-grid .post-card').filter({ hasText: 'Design Notes' });
  const reading = card.getByRole('button', { name: '読書のマーク', exact: true });
  await expect(reading).toHaveAttribute('aria-pressed', 'true');
  await reading.click(); await expect(reading).toHaveAttribute('aria-pressed', 'false');
  await reading.click(); await expect(reading).toHaveAttribute('aria-pressed', 'true');
  await card.getByRole('button', { name: 'タグを編集', exact: true }).click();
  await card.getByLabel('designのタグ', { exact: true }).fill('保存');
  await card.getByRole('button', { name: '研究のマーク', exact: true }).click();
  await expect(card.getByLabel('designのタグ', { exact: true })).toHaveValue('保存');
  await card.getByRole('button', { name: 'タグを保存', exact: true }).click();
  await expect(card.getByRole('status')).toContainText('タグを保存しました');
  await expect(card.getByRole('button', { name: '研究のマーク', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(reading).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.card-grid .post-card').filter({ hasText: 'Code Journal' }).locator('.quick-mark')).toHaveCount(0);
  expect(await page.evaluate(async () => { const path = '/src/db.ts'; return (await (await import(path)).db.userStates.get(['a', '1'])); })).toMatchObject({ read: false, favorite: true });
  await page.reload(); await expect(card.getByRole('button', { name: '研究のマーク', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'マークを管理', exact: true }).click();
  await page.getByRole('button', { name: '研究のマークを編集', exact: true }).click();
  await page.getByLabel('マークの名前', { exact: true }).fill('仕事');
  await page.getByRole('button', { name: '稲妻のアイコン', exact: true }).click();
  await page.getByRole('button', { name: 'マークを保存', exact: true }).click();
  await expect(page.locator('.side-marks').getByRole('button', { name: /^仕事/ })).toContainText('1');
  await page.locator('.side-marks').getByRole('button', { name: /^仕事/ }).click();
  await expect(page.locator('.card-grid .post-card')).toHaveCount(1);
  await expect(card).toContainText('保存');
  await page.getByRole('button', { name: '条件をリセット', exact: true }).click();
  await page.getByLabel('並び順', { exact: true }).selectOption('oldest');
  await expect(page.locator('.card-grid .post-card').first()).toContainText('Design Notes');
  await expect(card.getByRole('button', { name: '読書のマーク', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(card.getByRole('button', { name: '仕事のマーク', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.locator('.card-grid .read-toggle').evaluateAll(buttons => buttons.every(button => !(button as HTMLButtonElement).disabled))).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: 'test-results/library-marks.png', fullPage: true });
  const backup: import('../../src/backup').Backup = await page.evaluate(async () => { const path = '/src/backup.ts'; return (await import(path)).createBackup(); });
  expect(backup.formatVersion).toBe(2); expect(backup.tags.find(t => t.name === '仕事')?.mark).toBe('bolt');
  await page.getByRole('button', { name: 'マークを管理', exact: true }).click();
  await page.getByRole('button', { name: '読書を通常のタグに戻す', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('関連は保持');
  await expect(page.locator('.side-marks').getByRole('button', { name: /^読書/ })).toHaveCount(0);
  await nav.getByRole('button', { name: /^すべてのブックマーク/ }).click();
  await expect(card.locator('.tag-chip').filter({ hasText: /^読書$/ })).toBeVisible();
});

test('merged mark heading and unmarked page stay accurate across accounts, filters and mark toggles', async ({ page }) => {
  await seedGallery(page);
  const originalStates = await page.evaluate(async () => {
    const path = '/src/db.ts'; const { db } = await import(path);
    await db.tags.update('a-reading', { mark: 'book' });
    await db.tags.update('a-development', { mark: 'code' });
    await db.tags.update('b-development', { mark: 'code' });
    await db.postTags.put({ accountId: 'a', postId: '1', tagId: 'a-development' });
    return db.userStates.toArray();
  });
  await page.reload();
  const nav = page.getByRole('navigation', { name: 'ライブラリ', exact: true });
  const unmarked = nav.getByRole('button', { name: /^マークなし/ });
  const manager = page.getByRole('button', { name: 'マークを管理', exact: true });
  await expect(nav.getByRole('button')).toHaveText(['すべてのブックマーク6', 'あとで読む4', 'マークなし2']);
  await expect(manager).toHaveCount(1);
  await manager.locator('span').first().click();
  await expect(page.getByRole('heading', { name: 'マーク', exact: true, level: 1 })).toBeVisible();
  await expect(manager).toHaveAttribute('aria-current', 'page');
  await unmarked.click();
  await expect(unmarked).toHaveAttribute('aria-current', 'page');
  await expect(manager).not.toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'マークなし', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByLabel('マーク・タグ', { exact: true })).toHaveValue('without');
  await expect(page.locator('.card-grid .post-card')).toHaveCount(2);
  await page.getByLabel('アカウント', { exact: true }).selectOption('a');
  await expect(unmarked).toHaveText('マークなし1');
  const ideas = page.locator('.card-grid .post-card').filter({ hasText: 'Small Ideas' });
  await expect(ideas).toBeVisible(); // Its ordinary design tag does not classify it as marked.
  await page.getByLabel('投稿者', { exact: true }).fill('@ideas');
  await page.getByLabel('既読状態', { exact: true }).selectOption('read');
  await expect(page.locator('.card-grid .post-card')).toHaveCount(0);
  await expect(unmarked).toHaveText('マークなし1'); // Sidebar count is independent of extra filters.
  await page.getByLabel('既読状態', { exact: true }).selectOption('all');
  await page.getByLabel('投稿者', { exact: true }).fill('');
  await page.getByLabel('本文・投稿者を検索', { exact: true }).fill('軽い道具');
  await expect(ideas).toBeVisible();
  await expect(page.getByRole('heading', { name: 'マークなし', exact: true, level: 1 })).toBeVisible();
  await page.getByLabel('本文・投稿者を検索', { exact: true }).fill('');
  await ideas.getByRole('button', { name: '読書のマーク', exact: true }).click();
  await expect(page.locator('.card-grid .post-card')).toHaveCount(0);
  await expect(unmarked).toHaveText('マークなし0');
  await nav.getByRole('button', { name: /^すべてのブックマーク/ }).click();
  await ideas.getByRole('button', { name: '読書のマーク', exact: true }).click();
  await expect(unmarked).toHaveText('マークなし1');
  await unmarked.click();
  await expect(ideas).toBeVisible();
  await page.getByLabel('アカウント', { exact: true }).selectOption('b');
  await expect(page.locator('.card-grid .post-card')).toHaveCount(1);
  await expect(page.locator('.card-grid .post-card')).toContainText('Daily Capture');
  await page.locator('.side-marks').getByRole('button', { name: /^開発/ }).click();
  await expect(page.locator('.card-grid .post-card')).toContainText('Code Journal');
  await expect(unmarked).not.toHaveAttribute('aria-current', 'page');
  await unmarked.click();
  await page.getByLabel('マーク・タグ', { exact: true }).selectOption('with');
  await expect(page.getByRole('heading', { name: 'すべてのブックマーク', exact: true, level: 1 })).toBeVisible();
  await expect(page.locator('.card-grid .post-card')).toContainText('Code Journal');
  await page.getByRole('button', { name: '条件をリセット', exact: true }).click();
  await expect(page.locator('.card-grid .post-card')).toHaveCount(6);
  expect(await page.evaluate(async () => { const path = '/src/db.ts'; return (await (await import(path)).db.userStates.toArray()); })).toEqual(originalStates);
  expect(await page.evaluate(async () => { const path = '/src/db.ts'; return (await (await import(path)).db.postTags.get(['a', '4', 'a-design'])); })).toBeDefined();
});

test('mark management remains reachable at narrow widths and long names stay inside the sidebar', async ({ page }) => {
  await seedGallery(page);
  const longName = '長い名前のマーク' + '分類'.repeat(42);
  await page.evaluate(async (name) => {
    const path = '/src/db.ts'; const { db } = await import(path);
    await db.tags.update('a-reading', { name, mark: 'book' });
    await db.tags.update('b-development', { mark: 'code' });
    await db.settings.put({ key: 'theme', value: 'dark' });
  }, longName);
  await page.reload();
  const manager = page.getByRole('button', { name: 'マークを管理', exact: true });
  const nav = page.getByRole('navigation', { name: 'ライブラリ', exact: true });
  const longMark = page.locator('.side-marks').getByRole('button', { name: new RegExp(`^${longName}`) });
  await expect(longMark).toHaveAttribute('title', longName);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(manager).toBeVisible();
  await manager.click();
  await expect(page.getByRole('heading', { name: 'マーク', exact: true, level: 1 })).toBeVisible();
  await nav.getByRole('button', { name: /^マークなし/ }).click();
  await expect(page.locator('.card-grid .post-card')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await longMark.click();
  await expect(page.locator('.card-grid .post-card')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await nav.getByRole('button', { name: /^マークなし/ }).click();
  await expect(page.locator('.card-grid .post-card')).toHaveCount(3);
  expect(await longMark.evaluate(el => el.getBoundingClientRect().right <= el.closest('.sidebar')!.getBoundingClientRect().right)).toBe(true);
  await page.screenshot({ path: 'test-results/library-sidebar-unmarked.png', fullPage: true });
});

test('30 marks fit one row with a lazy searchable overflow picker and preserve account, tags and read state', async ({ page }) => {
  await seedGallery(page);
  const originalStates = await page.evaluate(async () => {
    const path = '/src/db.ts'; const modelPath = '/src/model.ts'; const { db } = await import(path); const { MARK_SYMBOLS } = await import(modelPath);
    for (const [index, mark] of MARK_SYMBOLS.entries()) await db.tags.put({ id: `m${index}`, accountId: 'a', name: `分類${String(index + 1).padStart(2, '0')}`, mark, markOrder: index });
    await db.settings.put({ key: 'theme', value: 'dark' }); return db.userStates.toArray();
  });
  await page.reload(); await page.setViewportSize({ width: 1440, height: 1000 });
  const card = page.locator('.card-grid .post-card').filter({ hasText: 'Design Notes' });
  const overflow = card.getByRole('button', { name: 'その他のマーク', exact: true });
  const picker = page.getByRole('dialog', { name: 'マークを選択', exact: true });
  await expect(card.locator('.quick-marks > .quick-mark')).toHaveCount(7);
  await expect(page.locator('.mark-picker-option')).toHaveCount(0);
  await expect(page.locator('.card-grid .post-card').filter({ hasText: 'Code Journal' }).locator('.quick-marks')).toHaveCount(0);
  async function assertSingleRows() {
    await expect.poll(() => page.locator('.card-grid .quick-marks').evaluateAll(rows => rows.every(row => {
      const buttons = [...row.querySelectorAll(':scope > button')]; const rect = row.getBoundingClientRect();
      return buttons.length <= 7 && new Set(buttons.map(b => Math.round(b.getBoundingClientRect().y))).size === 1 && buttons.every(b => b.getBoundingClientRect().right <= rect.right + 1);
    }))).toBe(true);
  }
  await assertSingleRows();
  await overflow.click(); await expect(picker).toBeVisible();
  await expect(picker.getByLabel('マーク名で検索', { exact: true })).toBeFocused();
  await expect(picker.locator('.mark-picker-option')).toHaveCount(30);
  await picker.getByLabel('マーク名で検索', { exact: true }).fill('分類07');
  const seventh = picker.getByRole('button', { name: '分類07のマーク', exact: true });
  await expect(picker.locator('.mark-picker-option')).toHaveCount(1);
  await seventh.click(); await expect(seventh).toHaveAttribute('aria-pressed', 'true');
  await expect(overflow).toHaveAttribute('data-marked', 'true');
  await page.keyboard.press('Escape'); await expect(picker).toHaveCount(0); await expect(overflow).toBeFocused();
  await overflow.click(); await picker.getByLabel('マーク名で検索', { exact: true }).fill('存在しない');
  await expect(picker.getByText('一致するマークがありません', { exact: true })).toBeVisible();
  await page.getByRole('heading', { name: 'すべてのブックマーク', exact: true, level: 1 }).click();
  await expect(picker).toHaveCount(0);
  expect(await page.evaluate(async () => { const path = '/src/db.ts'; return (await (await import(path)).db.userStates.toArray()); })).toEqual(originalStates);
  expect(await page.evaluate(async () => { const path = '/src/db.ts'; return (await (await import(path)).db.postTags.get(['a', '1', 'a-reading'])); })).toBeDefined();
  await page.getByRole('button', { name: 'マークを管理', exact: true }).click();
  await expect(page.locator('.symbol-options .symbol-option')).toHaveCount(30);
  await expect(page.locator('.mark-count')).toHaveText('30 / 30');
  await expect(page.getByRole('button', { name: 'マークを保存', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '分類01を上へ', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '分類30を下へ', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '分類07を上へ', exact: true }).click();
  await expect(page.locator('.mark-open strong').nth(5)).toHaveText('分類07');
  await expect(page.locator('.side-marks .nav-text').nth(5)).toHaveText('分類07');
  await page.reload(); await page.getByRole('button', { name: 'マークを管理', exact: true }).click();
  await expect(page.locator('.mark-open strong').nth(5)).toHaveText('分類07');
  await page.getByRole('navigation', { name: 'ライブラリ', exact: true }).getByRole('button', { name: /^すべてのブックマーク/ }).click();
  await expect(card.getByRole('button', { name: '分類07のマーク', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const backup: import('../../src/backup').Backup = await page.evaluate(async () => { const path = '/src/backup.ts'; return (await import(path)).createBackup(); });
  expect(backup.tags.find(t => t.name === '分類07')?.markOrder).toBe(5);
  await page.getByLabel('表示列数', { exact: true }).selectOption('5');
  await page.getByLabel('並び順', { exact: true }).selectOption('oldest');
  await expect.poll(() => card.locator('.quick-marks > .quick-mark').count()).toBeLessThan(7);
  await assertSingleRows();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await overflow.click(); await picker.getByLabel('マーク名で検索', { exact: true }).fill('分類30');
  await picker.getByRole('button', { name: '分類30のマーク', exact: true }).click();
  await expect(picker.getByRole('button', { name: '分類30のマーク', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await assertSingleRows();
  await expect.poll(() => card.locator('.quick-marks > .quick-mark').count()).toBeLessThan(7);
  await expect.poll(async () => {
    const anchor = (await overflow.boundingBox())!; const menu = (await picker.boundingBox())!;
    return Math.min(Math.abs(menu.y - anchor.y - anchor.height - 6), Math.abs(menu.y + menu.height - anchor.y + 6));
  }).toBeLessThan(2);
  await page.screenshot({ path: 'test-results/library-mark-overflow.png' });
  await picker.getByRole('button', { name: 'マーク選択を閉じる', exact: true }).click();
  await card.locator('summary').click(); const detail = page.getByRole('dialog', { name: '投稿の詳細', exact: true });
  await detail.getByRole('button', { name: 'その他のマーク', exact: true }).click();
  await expect(picker).toBeVisible(); await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0); await expect(detail).toBeVisible();
  await detail.getByRole('button', { name: '詳細を閉じる', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 }); await assertSingleRows();
  await overflow.click(); await expect(picker).toBeVisible();
  expect(await picker.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('overflow handles long and hostile names, keyboard selection and disappearance from the unmarked page', async ({ page }) => {
  await seedGallery(page);
  const longName = '<script>alert(1)</script>' + '長いマーク'.repeat(14);
  await page.evaluate(async (name) => {
    const path = '/src/db.ts'; const { db } = await import(path);
    for (let i = 0; i < 8; i++) await db.tags.put({ id: `extra${i}`, accountId: 'a', name: i === 7 ? name : `分類${i}`, mark: 'rocket', markOrder: i });
  }, longName);
  await page.reload(); await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('navigation', { name: 'ライブラリ', exact: true }).getByRole('button', { name: /^マークなし/ }).click();
  await expect(page.locator('.card-grid .post-card')).toHaveCount(6);
  const card = page.locator('.card-grid .post-card').filter({ hasText: 'Design Notes' });
  await card.getByRole('button', { name: 'その他のマーク', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'マークを選択', exact: true });
  await picker.getByLabel('マーク名で検索', { exact: true }).fill('長いマーク');
  await expect(picker.locator('.mark-picker-option')).toHaveCount(1);
  await expect(picker.locator('script')).toHaveCount(0);
  expect(await picker.locator('.mark-picker-option').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  await expect(picker).toHaveCount(0); await expect(card).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'ライブラリ', exact: true }).getByRole('button', { name: /^マークなし/ })).toHaveText('マークなし5');
  expect(await page.evaluate(async () => { const path = '/src/db.ts'; return (await (await import(path)).db.userStates.get(['a', '1'])); })).toMatchObject({ read: false, favorite: true });
});

test('author, mark, media, URLs and date filters combine and reset without treating body mentions as authors', async ({ page }) => {
  await seedGallery(page);
  await page.evaluate(async () => {
    const path = '/src/db.ts'; const { db } = await import(path);
    await db.tags.update('a-development', { mark: 'code' });
    await db.posts.update(['a', '2'], { text: '参考 https://example.invalid/docs', media: [{ kind: 'image', url: 'https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/test.jpg' }] });
    await db.posts.update(['a', '3'], { text: 'Frontendという語を含む本文' });
  });
  await page.reload();
  await page.getByLabel('投稿者', { exact: true }).fill('@FRONTEND');
  await page.getByLabel('マーク・タグ', { exact: true }).selectOption('tag:a-development');
  await page.getByLabel('メディア', { exact: true }).selectOption('video');
  await page.getByLabel('既読状態', { exact: true }).selectOption('read');
  await page.getByLabel('本文URL', { exact: true }).selectOption('with');
  await page.getByLabel('投稿日（開始）', { exact: true }).fill('2026-10-02');
  await page.getByLabel('投稿日（終了）', { exact: true }).fill('2026-10-02');
  await expect(page.locator('.card-grid .post-card')).toHaveCount(1);
  await expect(page.locator('.card-grid .post-card')).toContainText('Frontend Lab');
  await page.getByLabel('メディア', { exact: true }).selectOption('image'); await expect(page.locator('.card-grid .post-card')).toHaveCount(0);
  await page.getByRole('button', { name: '条件をリセット', exact: true }).click(); await expect(page.locator('.card-grid .post-card')).toHaveCount(6);
  await page.getByLabel('マーク・タグ', { exact: true }).selectOption('without'); await expect(page.locator('.card-grid .post-card')).toHaveCount(5);
  await page.getByLabel('マーク・タグ', { exact: true }).selectOption('all');
  await page.getByLabel('メディア', { exact: true }).selectOption('without'); await expect(page.locator('.card-grid .post-card')).toHaveCount(3);
  await page.getByLabel('メディア', { exact: true }).selectOption('all');
  await page.getByLabel('投稿日（開始）', { exact: true }).fill('2026-10-04');
  await page.getByLabel('投稿日（終了）', { exact: true }).fill('2026-10-02');
  await expect(page.getByRole('alert')).toContainText('開始日は終了日以前');
  await page.getByRole('button', { name: '条件をリセット', exact: true }).click(); await expect(page.locator('.card-grid .post-card')).toHaveCount(6);
});

test('registered tags can be chosen, reused and deselected without crossing accounts or losing drafts', async ({ page }) => {
  await seedGallery(page);
  await page.evaluate(async () => {
    const path = '/src/db.ts'; const { db } = await import(path);
    await db.tags.bulkPut([{ id: 'comma-tag', accountId: 'a', name: 'Design, UI' }, { id: 'other-tag', accountId: 'b', name: 'Other only' }]);
  });
  await page.reload();
  const first = page.locator('.card-grid .post-card').filter({ hasText: 'Frontend Lab' });
  await first.getByRole('button', { name: 'タグを編集', exact: true }).click();
  await first.getByLabel('frontendのタグ').fill('開発, 研究');
  await first.getByRole('button', { name: 'タグを保存', exact: true }).click();
  await expect(first.getByRole('status')).toContainText('タグを保存しました');
  const second = page.locator('.card-grid .post-card').filter({ hasText: 'Reading Room' });
  await second.getByRole('button', { name: 'タグを編集', exact: true }).click();
  await expect(second.getByRole('button', { name: 'Other onlyを選択', exact: true })).toHaveCount(0);
  const option = second.getByRole('button', { name: '研究を選択', exact: true });
  await option.click(); await expect(option).toHaveAttribute('aria-pressed', 'true');
  await option.click(); await expect(option).toHaveAttribute('aria-pressed', 'false');
  await option.click();
  await second.getByRole('button', { name: 'Design, UIを選択', exact: true }).click();
  await second.getByRole('button', { name: '未読', exact: true }).click();
  await expect(second.getByLabel('readingのタグ')).toHaveValue('読書, 研究, "Design, UI"');
  await second.getByRole('button', { name: 'タグを保存', exact: true }).click();
  await expect(second.getByRole('status')).toContainText('タグを保存しました');
  await page.reload();
  await expect(second.locator('.tag-chips .tag-chip').filter({ hasText: /^研究$/ })).toBeVisible();
  await expect(second.locator('.tag-chips .tag-chip').filter({ hasText: /^Design, UI$/ })).toBeVisible();
  await second.getByRole('button', { name: 'タグを編集', exact: true }).click();
  await second.getByLabel('登録済みタグを検索').fill('研究');
  await expect(second.locator('.tag-option')).toHaveCount(1);
});

test('legacy video thumbnails show a video action and detail URLs are safe clickable text', async ({ page }) => {
  await seedGallery(page);
  await page.evaluate(async () => {
    const path = '/src/db.ts'; const { db } = await import(path);
    await db.posts.update(['a', '2'], { text: '参考資料 https://example.invalid/docs?q=1。\n<script>window.injected = true</script> javascript:alert(1) https://user:password@example.invalid/',
      media: [{ kind: 'image', url: 'https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/synthetic.jpg' }] });
  });
  await page.reload();
  const card = page.locator('.card-grid .post-card').filter({ hasText: 'Frontend Lab' });
  await expect(card.locator('.media-badge')).toHaveCount(0);
  await expect(card.getByRole('link', { name: 'Xで動画を見る', exact: true })).toHaveAttribute('href', 'https://x.com/frontend/status/2');
  expect(await page.locator('video').count()).toBe(0);
  await card.locator('summary').click();
  const detail = page.getByRole('dialog', { name: '投稿の詳細', exact: true });
  const link = detail.getByRole('link', { name: 'https://example.invalid/docs?q=1', exact: true });
  await expect(link).toHaveAttribute('href', 'https://example.invalid/docs?q=1');
  await expect(link).toHaveAttribute('target', '_blank'); await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(detail.locator('.post-body a')).toHaveCount(1);
  expect(await page.evaluate(() => Object.hasOwn(window, 'injected'))).toBe(false);
  await detail.getByRole('button', { name: '詳細を閉じる', exact: true }).click();
  await page.getByRole('button', { name: 'リスト表示', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const mediaBox = (await card.locator('.card-media').boundingBox())!;
  const actionBox = (await card.locator('.video-action').boundingBox())!;
  expect(actionBox.x).toBeGreaterThanOrEqual(mediaBox.x); expect(actionBox.x + actionBox.width).toBeLessThanOrEqual(mediaBox.x + mediaBox.width);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'カード表示', exact: true }).click();
  await page.evaluate(async () => {
    const path = '/src/db.ts'; const { db } = await import(path);
    await db.posts.update(['a', '2'], { text: 'ローカルファーストな道具を作る。\n保存した資料は手元に、動画はXで。\nhttps://example.invalid/docs?q=1' });
  });
  await page.reload();
  await card.locator('summary').click();
  await detail.getByRole('button', { name: 'タグを編集', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/library-post-detail.png' });
});

test('sidebar filters combine account, read state, tags and search, and list settings persist', async ({ page }) => {
  await seedGallery(page);
  const nav = page.getByRole('navigation', { name: 'ライブラリ', exact: true });
  await page.getByLabel('以前のお気に入り', { exact: true }).selectOption('favorite');
  await expect(page.locator('.post-card')).toHaveCount(2);
  await page.getByLabel('アカウント', { exact: true }).selectOption('a');
  await expect(page.getByText('Design Notes', { exact: true })).toBeVisible();
  await expect(page.locator('.post-card')).toHaveCount(1);
  await page.getByLabel('以前のお気に入り', { exact: true }).selectOption('all');
  await nav.getByRole('button', { name: /^あとで読む/ }).click();
  await expect(page.locator('.post-card')).toHaveCount(3);
  await expect(nav.getByRole('button', { name: /^タグ/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'タグ一覧を開く', exact: true })).toHaveCount(0);
  await nav.getByRole('button', { name: /^すべてのブックマーク/ }).click();
  await page.getByLabel('マーク・タグ', { exact: true }).selectOption('tag:a-reading');
  await expect(page.locator('.post-card')).toHaveCount(2);
  await page.getByPlaceholder('本文・投稿者を検索').fill('カード');
  await expect(page.locator('.post-card')).toHaveCount(1);
  await page.getByLabel('既読状態', { exact: true }).selectOption('read');
  await expect(page.locator('.post-card')).toHaveCount(0);
  await page.getByPlaceholder('本文・投稿者を検索').fill('');
  await nav.getByRole('button', { name: /^すべてのブックマーク/ }).click();
  await expect(page.locator('.post-card')).toHaveCount(4);
  await page.getByLabel('並び順').selectOption('oldest');
  await expect(page.locator('.post-card').first()).toContainText('Design Notes');
  await page.getByRole('button', { name: 'リスト表示', exact: true }).click();
  await expect(page.locator('.card-grid')).toHaveClass(/view-list/);
  await page.reload();
  await expect(page.getByRole('button', { name: 'リスト表示', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('all photos can be browsed and opened at their current position while failed images and preview consent stay isolated', async ({ page }) => {
  const requested: string[] = [];
  await page.route('https://pbs.twimg.com/**', async route => {
    const url = route.request().url(); requested.push(url);
    if (url.includes('gallery-3')) { await route.fulfill({ status: 404, body: '' }); return; }
    const colors = ['#607d9a', '#c2b2a3', '#9caaa0', '#708f87'];
    const index = Number(url.match(/gallery-(\d)/)?.[1] ?? '1');
    await route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="640" height="420" fill="${colors[index - 1]}"/><circle cx="440" cy="120" r="65" fill="#ffffff30"/><path d="M0 420 180 170 340 420Z" fill="#ffffff20"/><text x="32" y="370" font-size="56" fill="white" font-family="sans-serif">${index} / 4</text></svg>` });
  });
  await seedGallery(page);
  await page.evaluate(async () => {
    const path = '/src/db.ts'; const { db } = await import(path);
    await db.posts.update(['a', '1'], { media: [1, 2, 3, 4].map(i => ({ kind: 'image', url: `https://pbs.twimg.com/media/gallery-${i}.svg` })) });
    await db.tags.put({ id: 'gallery-mark', accountId: 'a', name: '読み返す', mark: 'book' });
    await db.postTags.put({ accountId: 'a', postId: '1', tagId: 'gallery-mark' });
  });
  await page.reload();
  const card = page.locator('.card-grid .post-card').filter({ hasText: 'Design Notes' });
  await expect(card.locator('.media-count')).toHaveText('1 / 4');
  await card.getByRole('button', { name: '次のメディア', exact: true }).click();
  await expect(card.locator('.media-count')).toHaveText('2 / 4');
  expect(requested).toEqual([]); await expect(card.locator('img')).toHaveCount(0);
  await page.getByRole('navigation', { name: '管理', exact: true }).getByRole('button', { name: '設定', exact: true }).click();
  await page.getByLabel('画像プレビューを表示').check();
  await page.getByRole('button', { name: 'ダークモードに切り替える', exact: true }).click();
  await page.getByRole('navigation', { name: 'ライブラリ', exact: true }).getByRole('button', { name: /^すべてのブックマーク/ }).click();
  await expect(card.locator('img')).toHaveAttribute('src', 'https://pbs.twimg.com/media/gallery-1.svg');
  await card.getByRole('button', { name: '次のメディア', exact: true }).click();
  await expect(card.locator('img')).toHaveAttribute('src', 'https://pbs.twimg.com/media/gallery-2.svg');
  await card.getByRole('button', { name: 'メディア 2 / 4を大きく見る', exact: true }).click();
  const detail = page.getByRole('dialog', { name: '投稿の詳細', exact: true });
  await expect(detail.locator('.media-count')).toHaveText('2 / 4');
  await expect(detail.locator('img')).toHaveCSS('object-fit', 'contain');
  await expect(detail.getByRole('button', { name: '既読 ✓', exact: true })).toBeVisible();
  await detail.getByRole('button', { name: '次のメディア', exact: true }).click();
  await expect(detail.getByText('画像を読み込めませんでした', { exact: true })).toBeVisible();
  await detail.getByRole('button', { name: '次のメディア', exact: true }).click();
  await expect(detail.locator('img')).toHaveAttribute('src', 'https://pbs.twimg.com/media/gallery-4.svg');
  await expect(detail.getByRole('button', { name: '次のメディア', exact: true })).toBeDisabled();
  await detail.locator('.card-media').focus(); await page.keyboard.press('ArrowLeft');
  await expect(detail.locator('.media-count')).toHaveText('3 / 4');
  await page.keyboard.press('ArrowLeft'); await expect(detail.locator('img')).toHaveAttribute('src', 'https://pbs.twimg.com/media/gallery-2.svg');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const mediaBox = (await detail.locator('.card-media').boundingBox())!;
  const nextBox = (await detail.locator('.media-next').boundingBox())!;
  expect(nextBox.x + nextBox.width).toBeLessThanOrEqual(mediaBox.x + mediaBox.width);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/library-media-gallery.png' });
  await detail.getByRole('button', { name: '詳細を閉じる', exact: true }).click();
  await page.getByRole('button', { name: 'リスト表示', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await card.getByRole('button', { name: '次のメディア', exact: true }).click();
  await expect(card.locator('.media-count')).toHaveText('3 / 4');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  const stored = await page.evaluate(async () => { const path = '/src/db.ts'; const { db } = await import(path); return { post: await db.posts.get(['a', '1']), state: await db.userStates.get(['a', '1']), relations: await db.postTags.where('[accountId+postId]').equals(['a', '1']).count() }; });
  expect(stored.post?.media).toHaveLength(4); expect(stored.state).toMatchObject({ read: true, favorite: true }); expect(stored.relations).toBe(2);
});

test('dark reload stays dark before the application module arrives', async ({ page }) => {
  await seedGallery(page);
  await page.getByRole('button', { name: 'ダークモードに切り替える', exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('xbookmarkshelf.theme'))).toBe('dark');
  await page.addInitScript(() => {
    const frames: { theme: string | undefined; background: string }[] = [];
    (window as unknown as { themeFrames: typeof frames }).themeFrames = frames;
    const sample = () => {
      frames.push({ theme: document.documentElement.dataset.theme, background: getComputedStyle(document.documentElement).backgroundColor });
      if (frames.length < 60) requestAnimationFrame(sample);
    }; requestAnimationFrame(sample);
  });
  let unblock!: () => void; const held = new Promise<void>(resolve => { unblock = resolve; });
  await page.route('**/src/library.tsx*', async route => { await held; await route.continue(); });
  try {
    await page.reload({ waitUntil: 'commit' });
    await expect.poll(() => page.evaluate(() => (window as unknown as { themeFrames?: unknown[] }).themeFrames?.length ?? 0)).toBeGreaterThan(3);
    const frames = await page.evaluate(() => (window as unknown as { themeFrames: { theme: string; background: string }[] }).themeFrames);
    expect(frames.every(frame => frame.theme === 'dark' && frame.background === 'rgb(16, 19, 24)')).toBe(true);
    expect(await page.locator('#app').innerHTML()).toBe('');
  } finally { unblock(); }
  await expect(page.locator('.post-card')).toHaveCount(6);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'ライトモードに切り替える', exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('xbookmarkshelf.theme'))).toBe('light');
  await page.unroute('**/src/library.tsx*');
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('saved site thumbnails obey preview consent, open safe links and survive JSON and image failure', async ({ page }) => {
  const requests: string[] = [];
  await page.route('https://pbs.twimg.com/**', route => {
    requests.push(route.request().url());
    expect(route.request().headers()['referer']).toBeUndefined();
    return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="420"><rect width="800" height="420" fill="#cfddcd"/><rect x="80" y="65" width="640" height="290" rx="18" fill="#4e6b57"/><text x="135" y="230" font-family="sans-serif" font-size="43" fill="white">A calmer reading space.</text></svg>' });
  });
  await seedGallery(page);
  await page.evaluate(async () => {
    const path = '/src/db.ts'; const { db } = await import(path);
    await db.posts.update(['a', '1'], { text: '読み返したくなる、落ち着いた読書環境を作る。\nhttps://example.invalid/reading', media: [], linkCards: [{ url: 'https://example.invalid/reading', title: 'A calmer reading space', imageUrl: 'https://pbs.twimg.com/card_img/synthetic-cover.svg' }] });
  });
  await page.reload();
  const card = page.locator('.card-grid .post-card').filter({ hasText: 'Design Notes' });
  const preview = card.locator('.link-card');
  await expect(preview).toContainText('A calmer reading space');
  expect(requests).toHaveLength(0); await expect(preview.locator('img')).toHaveCount(0);
  await page.getByRole('navigation', { name: '管理', exact: true }).getByRole('button', { name: '設定', exact: true }).click();
  await page.getByLabel('画像プレビューを表示').check();
  await page.getByRole('navigation', { name: 'ライブラリ', exact: true }).getByRole('button', { name: /^すべてのブックマーク/ }).click();
  await expect(preview.locator('img')).toBeVisible();
  await expect.poll(() => preview.locator('img').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(preview).toHaveAttribute('href', 'https://example.invalid/reading');
  await expect(preview).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(card.locator('.card-media')).toHaveCount(0);
  await card.locator('summary').click();
  const detail = page.getByRole('dialog', { name: '投稿の詳細', exact: true });
  await expect(detail.locator('.link-card img')).toBeVisible();
  await detail.getByRole('button', { name: '詳細を閉じる', exact: true }).click();
  const saved = await page.evaluate(async () => {
    const path = '/src/backup.ts'; const { createBackup, restoreBackup } = await import(path);
    const backup = await createBackup(); await restoreBackup(backup); return backup.posts.find((p: { postId: string }) => p.postId === '1')!.linkCards;
  });
  expect(saved).toEqual([{ url: 'https://example.invalid/reading', title: 'A calmer reading space', imageUrl: 'https://pbs.twimg.com/card_img/synthetic-cover.svg' }]);
  await page.getByRole('button', { name: 'ダークモードに切り替える', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByLabel('並び順', { exact: true }).selectOption('oldest');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/library-site-preview.png', fullPage: true });
  await page.unroute('https://pbs.twimg.com/**');
  await page.route('https://pbs.twimg.com/**', route => route.abort());
  await page.reload();
  await expect(preview).toContainText('サムネイルを読み込めませんでした');
  await expect(preview).toHaveAttribute('href', 'https://example.invalid/reading');
});

test('preview consent, theme persistence and image failure have working UI', async ({ page }) => {
  let imageRequests = 0;
  await page.route('https://pbs.twimg.com/**', route => {
    imageRequests++;
    const id = route.request().url().match(/synthetic-(\d)/)?.[1];
    const palettes: Record<string, string[]> = { '1': ['#d9e5e9', '#243b53'], '2': ['#e8ddd3', '#74543d'], '4': ['#dce3d7', '#476047'] };
    const [background, foreground] = palettes[id ?? '1']!;
    return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="500"><rect width="900" height="500" fill="${background}"/><circle cx="650" cy="210" r="220" fill="${foreground}" opacity=".13"/><rect x="100" y="110" width="400" height="280" rx="22" fill="${foreground}" opacity=".2"/><text x="140" y="265" fill="${foreground}" font-family="sans-serif" font-size="56">${id === '2' ? 'Local first.' : id === '4' ? 'Small ideas.' : 'Less, but better.'}</text></svg>` });
  });
  await seedGallery(page);
  expect(imageRequests).toBe(0);
  await expect(page.getByText('画像プレビューはオフ', { exact: true })).toHaveCount(3);
  await page.getByRole('navigation', { name: '管理', exact: true }).getByRole('button', { name: '設定', exact: true }).click();
  await page.getByLabel('画像プレビューを表示').check();
  await page.getByRole('navigation', { name: 'ライブラリ', exact: true }).getByRole('button', { name: /^すべてのブックマーク/ }).click();
  await expect(page.locator('.card-media img')).toHaveCount(3);
  await expect.poll(() => imageRequests).toBe(3);
  await expect.poll(() => page.locator('.card-media img').evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/library-redesign.png', fullPage: true });
  await page.getByRole('button', { name: 'ダークモードに切り替える', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.card-media img')).toHaveCount(3);
  await page.unroute('https://pbs.twimg.com/**');
  await page.route('https://pbs.twimg.com/**', route => route.abort());
  await page.reload();
  await expect(page.getByText('画像を読み込めませんでした', { exact: true })).toHaveCount(3);
  await page.screenshot({ path: 'test-results/library-dark.png', fullPage: true });
});

test('library persists edits and safely renders offline text and JSON restore', async ({ page }) => {
  await page.goto('/library.html');
  await expect(page.getByRole('heading', { name: '最初のブックマークを取り込もう' })).toBeVisible();
  await page.evaluate(async () => {
    const path = '/src/db.ts'; const { db } = await import(path);
    await db.settings.put({ key: 'accounts', value: [{ id: 'synthetic-account', handle: 'test_user' }] });
    await db.posts.put({ accountId: 'synthetic-account', postId: '9007199254740993123', authorHandle: 'test_author', authorName: 'テスト投稿者',
      text: '日本語テスト <script>window.injected = true</script>', url: 'https://x.com/test_author/status/9007199254740993123', partial: true,
      postedAt: null, observedAt: '2026-10-10T08:00:00.000Z', firstImportedAt: '2026-10-10T08:00:00.000Z', lastImportedAt: '2026-10-10T08:00:00.000Z', media: [] });
    await db.userStates.put({ accountId: 'synthetic-account', postId: '9007199254740993123', read: false, favorite: true });
  });
  await page.reload();
  await expect(page.getByText('テスト投稿者', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '未読', exact: true }).click();
  await page.getByRole('button', { name: 'タグを編集', exact: true }).click();
  await page.getByLabel('test_authorのタグ').fill('保存, 読書');
  await page.getByRole('button', { name: 'タグを保存' }).click();
  await expect(page.getByRole('status')).toContainText('タグを保存しました');
  await page.reload();
  await expect(page.getByRole('button', { name: '既読 ✓' })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(async () => { const path = '/src/db.ts'; return (await (await import(path)).db.userStates.get(['synthetic-account', '9007199254740993123']))?.favorite; })).toBe(true);
  await page.getByRole('button', { name: 'タグを編集', exact: true }).click();
  await expect.poll(async () => (await page.getByLabel('test_authorのタグ').inputValue()).split(',').map(t => t.trim()).sort()).toEqual(['保存', '読書']);
  expect(await page.evaluate(() => Object.hasOwn(window, 'injected'))).toBe(false);
  const backup: import('../../src/backup').Backup = await page.evaluate(async () => { const path = '/src/backup.ts'; return (await import(path)).createBackup(); });
  await page.getByRole('navigation', { name: '管理' }).getByRole('button', { name: 'バックアップ', exact: true }).click();
  await page.getByLabel('復元するJSON').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await page.getByRole('button', { name: '検証済みJSONを復元' }).click();
  await expect(page.getByRole('status')).toContainText('既存1件');
  await page.getByRole('navigation', { name: 'ライブラリ', exact: true }).getByRole('button', { name: /^すべてのブックマーク/ }).click();
  await page.context().setOffline(true);
  await page.getByPlaceholder('本文・投稿者を検索').fill('日本語');
  await expect(page.getByText('テスト投稿者', { exact: true })).toBeVisible();
  await page.getByPlaceholder('本文・投稿者を検索').fill('見つからない検索');
  await expect(page.getByRole('heading', { name: '一致する投稿がありません' })).toBeVisible();
});

test('library contains long content on narrow and multi-column screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/library.html');
  await expect(page.getByRole('heading', { name: '最初のブックマークを取り込もう' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(async () => {
    const path = '/src/db.ts'; const { db } = await import(path);
    await db.settings.put({ key: 'accounts', value: [{ id: 'synthetic-long', handle: 'long_user' }] });
    await db.tags.put({ id: 'long-mark', accountId: 'synthetic-long', name: '長いマーク名'.repeat(16), mark: 'heart' });
    await db.posts.put({ accountId: 'synthetic-long', postId: '90071992547409931234567890', authorHandle: 'test_author', authorName: '長い投稿者名'.repeat(25),
      text: '長文とURLの表示確認\nhttps://example.invalid/' + 'abcdefghij'.repeat(400) + '\nC:\\Users\\Synthetic\\' + '長いパス'.repeat(40),
      url: 'https://x.com/test_author/status/90071992547409931234567890', partial: true, postedAt: null,
      observedAt: '2026-10-10T08:00:00.000Z', firstImportedAt: '2026-10-10T08:00:00.000Z', lastImportedAt: '2026-10-10T08:00:00.000Z', media: [], linkCards: [{ url: 'https://example.invalid/' + 'path'.repeat(250), title: '長いリンク先の見出し'.repeat(25), imageUrl: 'https://pbs.twimg.com/card_img/long.jpg' }] });
  });
  await page.reload();
  await page.getByRole('button', { name: `${'長いマーク名'.repeat(16)}のマーク`, exact: true }).click();
  await page.locator('summary').click();
  const detail = page.getByRole('dialog', { name: '投稿の詳細', exact: true });
  await expect(detail.locator('.post-body')).toBeVisible();
  await detail.getByRole('button', { name: 'タグを編集', exact: true }).click();
  await detail.getByLabel('test_authorのタグ').fill('長いタグ名'.repeat(20));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await detail.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/library-narrow.png' });
  await detail.getByRole('button', { name: '詳細を閉じる', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const columns of [1, 2, 3, 4, 5]) {
    await page.getByLabel('表示列数').selectOption(String(columns));
    await expect.poll(() => page.locator('.card-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(columns);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: 'test-results/library-wide.png' });
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect.poll(() => page.locator('.card-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(2);
  await page.getByLabel('表示列数').selectOption('1');
  await expect.poll(() => page.locator('.card-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(1);
});
