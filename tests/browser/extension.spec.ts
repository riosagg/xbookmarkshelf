import { chromium, expect, test } from './fixtures';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// All https://x.com requests are fulfilled locally. The isolated test copy grants
// the fixture origin so direct popup navigation can exercise messaging without a toolbar click.
for (const { path, collection } of [{ path: '/i/bookmarks', collection: 'bookmarks' }, { path: '/i/history', collection: 'bookmarks' }, { path: '/i/history', collection: 'likes' }, { path: '/i/history/likes', collection: 'likes' }, { path: '/synthetic_user/likes', collection: 'likes' }, { path: '/i/saved-posts', collection: 'bookmarks' }, { path: '/i/liked-posts', collection: 'likes' }]) test(`MV3 commits virtualized DOM batches on ${path} (${collection}) and preserves scope`, async () => {
  // Multiple import runs include real 3-second waits; budget for the full scenario on hosted runners.
  test.setTimeout(60000);
  const custom = path === '/i/saved-posts' || path === '/i/liked-posts';
  const sourceUrl = `https://x.com${path}`;
  const temp = await mkdtemp(join(tmpdir(), 'xbs-extension-'));
  const extension = join(temp, 'extension');
  await cp(resolve('dist'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['https://x.com/*'];
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  const context = await chromium.launchPersistentContext(join(temp, 'profile'), {
    channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    await context.route('https://pbs.twimg.com/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="green"/></svg>' }));
    await context.route('https://x.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><meta charset="UTF-8"><style>body{min-height:6000px}article{height:140px}</style></head><body><a data-testid="AppTabBar_Profile_Link" href="/synthetic_user">Profile</a><div role="tablist"><button role="tab" aria-selected="${collection === 'bookmarks'}">Bookmarks</button><button role="tab" aria-selected="${collection === 'likes'}">Likes</button></div><main id="feed"></main><script>
      document.querySelectorAll('[role=tab]').forEach(tab=>tab.onclick=()=>document.querySelectorAll('[role=tab]').forEach(item=>item.setAttribute('aria-selected',String(item===tab))));
      function media(id){
        if(id===2)return '<div data-testid="videoPlayer"><video data-fixture="late-video" src="blob:https://x.com/synthetic"></video></div>';
        if(id===3)return Array.from({length:4},(_,i)=>'<div data-testid="tweetPhoto"><img data-fixture="photo-'+(i+1)+'" '+(i<2?'src="https://pbs.twimg.com/media/photo-'+(i+1)+'.jpg"':'')+'></div>').join('');
        if(id===4)return '<div data-testid="videoPlayer" style="background-image:url(https://pbs.twimg.com/media/css-video.jpg)"></div>';
        return '';
      }
      function render(start,end){document.getElementById('feed').innerHTML=Array.from({length:end-start+1},(_,i)=>{const id=start+i;return '<article data-testid="tweet"><div data-testid="User-Name"><span>Author</span></div><a href="/test_author/status/'+id+'"><time datetime="2026-10-10T08:00:00Z"></time></a><div data-testid="tweetText">合成投稿 '+id+'</div>'+media(id)+(id===1?'<div data-testid="card.wrapper"><a href="https://t.co/synthetic" title="https://example.invalid/story"><img src="https://pbs.twimg.com/card_img/synthetic.jpg" alt="Synthetic site title">Example</a></div>':'')+'</article>';}).join('');}
      render(1,12);let advanced=false;window.addEventListener('scroll',()=>{if(scrollY>0&&!advanced){advanced=true;render(13,22);}});
    </script></body></html>` }));
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionId = worker.url().split('/')[2]!;
    const source = await context.newPage(); await source.goto(sourceUrl);
    if (path === '/i/history/likes') await source.locator('[role="tab"]').evaluateAll(tabs => tabs.forEach(tab => tab.removeAttribute('role')));
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html?source=${collection}`);
    const library = await context.newPage(); await library.goto(`chrome-extension://${extensionId}/library.html?source=${collection}`);
    const browserLocale = await library.evaluate(() => chrome.i18n.getUILanguage());
    const initialLanguage = /^ja(?:[-_]|$)/i.test(browserLocale) ? 'ja' : 'en';
    await expect(library.locator('html')).toHaveAttribute('lang', initialLanguage);
    await expect(popup.locator('html')).toHaveAttribute('lang', initialLanguage);
    await library.getByRole('navigation', { name: /^(Manage|管理)$/ }).getByRole('button', { name: /^(Settings|設定)$/ }).click();
    await expect(library.getByRole('combobox', { name: /^(Language|言語)$/ })).toHaveValue('system');
    await library.getByRole('combobox', { name: /^(Language|言語)$/ }).selectOption('ja');
    if (custom) {
      const section = library.getByRole('region', { name: '取得先URL', exact: true });
      await section.getByLabel('ブックマークの取得先URL').fill('https://x.com/i/saved-posts');
      await section.getByLabel('いいねの取得先URL').fill('https://x.com/i/liked-posts');
      await section.getByRole('button', { name: 'URLを保存', exact: true }).click();
      await expect(section.getByRole('status')).toContainText('保存しました');
      await source.bringToFront(); await popup.reload();
      await expect(popup.locator('.account')).toContainText('@synthetic_user');
      await expect(popup.getByLabel('取り込み対象')).toHaveValue(collection);
    }
    await expect(popup.locator('.popup')).toHaveCSS('width', '380px');
    await expect(popup.getByLabel('待機（秒）')).toHaveValue('3');
    await expect(popup.getByLabel('今回の上限（件）')).toHaveValue('100');
    await source.bringToFront();
    if (path.startsWith('/i/history') && collection === 'likes') {
      await expect(popup.getByLabel('取り込み対象')).toBeEnabled();
      await popup.getByLabel('取り込み対象').selectOption('bookmarks');
      await expect.poll(() => popup.evaluate(async () => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('x-bookmark-library'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        try { return await new Promise<string | undefined>((resolve, reject) => { const request = database.transaction('settings').objectStore('settings').get('importPreferences'); request.onsuccess = () => resolve(request.result?.value?.source); request.onerror = () => reject(request.error); }); }
        finally { database.close(); }
      })).toBe('bookmarks');
      await source.bringToFront(); await popup.reload();
      await expect(popup.locator('.account')).toContainText('@synthetic_user');
      await expect(popup.getByLabel('取り込み対象')).toHaveValue('likes');
      await expect(popup.locator('.primary.full')).toBeEnabled();
    }
    await popup.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({ url });
      const tabId = tabs[0]!.id!;
      const inspect = await chrome.runtime.sendMessage({ type: 'INSPECT_TAB', tabId });
      if (!inspect.ok) throw new Error(inspect.error);
      const result = await chrome.runtime.sendMessage({ type: 'START', tabId, handle: inspect.value.handle, source: inspect.value.source, options: { intervalMs: 3000, maxPosts: 20, mode: 'full' } });
      if (!result.ok) throw new Error(result.error);
    }, sourceUrl);
    await source.evaluate(() => {
      setTimeout(() => document.querySelector('[data-fixture="late-video"]')?.setAttribute('poster', 'https://pbs.twimg.com/amplify_video_thumb/123/img/late?format=webp&name=medium'), 1000);
      setTimeout(() => [3, 4].forEach(i => document.querySelector(`[data-fixture="photo-${i}"]`)?.setAttribute('src', `https://pbs.twimg.com/media/photo-${i}.jpg`)), 500);
    });
    if (custom) {
      // Change stored settings without hiding the X fixture. The running reader keeps its worker snapshot.
      await popup.evaluate(async () => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('x-bookmark-library'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
        try { await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction('settings', 'readwrite');
          transaction.objectStore('settings').put({ key: 'importLocations', value: { bookmarks: 'https://x.com/i/bookmarks', likes: 'https://x.com/i/history/likes' } });
          transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
        }); } finally { database.close(); }
      });
    }
    await expect.poll(async () => popup.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'STATUS', source: new URL(location.href).searchParams.get('source') ?? 'bookmarks' })).value?.reason), { timeout: 20000 }).toBe('run_limit');
    const status = await popup.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'STATUS', source: new URL(location.href).searchParams.get('source') ?? 'bookmarks' })).value);
    expect(status.added).toBe(20); expect(status.nextSequence).toBe(3);
    if (custom) {
      expect(status.importLocations).toEqual({ bookmarks: 'https://x.com/i/saved-posts', likes: 'https://x.com/i/liked-posts' });
      const inspect = await popup.evaluate(async url => {
        const tabs = await chrome.tabs.query({ url }); return chrome.runtime.sendMessage({ type: 'INSPECT_TAB', tabId: tabs[0]!.id! });
      }, sourceUrl);
      expect(inspect.ok).toBe(false);
    }
    await popup.reload();
    await expect(popup.getByText('保存確認 20件 · 新規 20件 · 既存 0件')).toBeVisible();
    await library.goto(`chrome-extension://${extensionId}/library.html?source=${collection}`);
    await expect(library.getByText('Author', { exact: true })).toHaveCount(20);
    await expect(library.locator('summary').filter({ hasText: /^合成投稿 1(?:\s|$)/ })).toContainText('https://example.invalid/story');
    await expect(library.locator('summary').filter({ hasText: /^合成投稿 20$/ })).toBeVisible();
    await expect(library.locator('.link-card')).toHaveCount(1);
    await expect(library.locator('.link-card')).toHaveAttribute('href', 'https://example.invalid/story');
    await expect(library.locator('.link-card')).toContainText('Synthetic site title');
    await expect(library.locator('.link-card img')).toHaveCount(1);
    const photoCard = library.locator('.post-card').filter({ has: library.locator('summary').filter({ hasText: /^合成投稿 3$/ }) });
    await expect(photoCard.locator('.media-count')).toHaveText('1 / 4');
    await expect(library.locator('.video-action')).toHaveCount(2);
    await expect(library.locator('.card-media img')).toHaveCount(3);
    await expect(library.getByRole('navigation', { name: 'ライブラリ', exact: true }).getByRole('button', { name: /^タグ/ })).toHaveCount(0);
    await library.getByRole('navigation', { name: '管理', exact: true }).getByRole('button', { name: '設定', exact: true }).click();
    await expect(library.getByLabel('画像プレビューを表示')).toBeChecked();
    await library.getByRole('navigation', { name: 'ライブラリ', exact: true }).getByRole('button', { name: collection === 'likes' ? /^すべてのいいね/ : /^すべてのブックマーク/ }).click();
    const videoCard = library.locator('.post-card').filter({ has: library.locator('summary').filter({ hasText: /^合成投稿 2$/ }) });
    await expect(videoCard.locator('.card-media img')).toHaveAttribute('src', 'https://pbs.twimg.com/amplify_video_thumb/123/img/late?format=webp&name=medium');
    for (const i of [2, 3, 4]) {
      await photoCard.getByRole('button', { name: '次のメディア', exact: true }).click();
      await expect(photoCard.locator('.card-media img')).toHaveAttribute('src', `https://pbs.twimg.com/media/photo-${i}.jpg`);
    }

    await library.getByRole('button', { name: 'ダークモードに切り替える', exact: true }).click();
    await expect.poll(() => library.evaluate(() => localStorage.getItem('xbookmarkshelf.theme'))).toBe('dark');
    await popup.reload();
    await expect(popup.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(popup.locator('html')).toHaveCSS('background-color', 'rgb(16, 19, 24)');
    await library.reload();
    await expect(library.locator('.link-card')).toContainText('Synthetic site title');
    await expect(library.locator('html')).toHaveAttribute('data-theme', 'dark');

    // Language is shared by real extension pages without changing X DOM or stored posts.
    await library.getByRole('navigation', { name: '管理', exact: true }).getByRole('button', { name: '設定', exact: true }).click();
    await library.getByRole('combobox', { name: '言語', exact: true }).selectOption('en');
    await expect(library.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await expect(popup.getByText('Run completed', { exact: true })).toBeVisible();
    await expect(popup.getByText('Confirmed 20 · New 20 · Existing 0', { exact: true })).toBeVisible();
    await popup.reload();
    await expect(popup.locator('html')).toHaveAttribute('lang', 'en');
    await expect(popup.getByLabel('Wait (seconds)')).toHaveValue('3');
    await expect(popup.locator('html')).toHaveAttribute('data-theme', 'dark');
    await library.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ja');
    await expect(popup.getByText('実行を完了しました', { exact: true })).toBeVisible();

    if (path.startsWith('/i/history')) {
      await source.bringToFront();
      if (path === '/i/history/likes') await source.locator('button[aria-selected]').evaluateAll(tabs => tabs.forEach(tab => tab.setAttribute('role', 'tab')));
      await source.getByRole('tab', { name: collection === 'likes' ? 'Bookmarks' : 'Likes', exact: true }).click();
      const inspect = await popup.evaluate(async (url) => {
        const tabs = await chrome.tabs.query({ url });
        return chrome.runtime.sendMessage({ type: 'INSPECT_TAB', tabId: tabs[0]!.id! });
      }, sourceUrl);
      if (path === '/i/history/likes') expect(inspect.ok).toBe(false);
      else { expect(inspect.ok).toBe(true); expect(inspect.value.source).toBe(collection === 'likes' ? 'bookmarks' : 'likes'); }
      await source.getByRole('tab', { name: collection === 'likes' ? 'Likes' : 'Bookmarks', exact: true }).click();
      await popup.evaluate(async (url) => {
        const tabs = await chrome.tabs.query({ url }); const tabId = tabs[0]!.id!;
        const inspect = await chrome.runtime.sendMessage({ type: 'INSPECT_TAB', tabId });
        const started = await chrome.runtime.sendMessage({ type: 'START', tabId, handle: inspect.value.handle, source: inspect.value.source, options: { intervalMs: 3000, maxPosts: 100, mode: 'full' } });
        if (!started.ok) throw new Error(started.error);
      }, sourceUrl);
      await expect.poll(async () => popup.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'STATUS', source: new URL(location.href).searchParams.get('source') ?? 'bookmarks' })).value?.observed)).toBeGreaterThan(0);
      const before = await popup.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'STATUS', source: new URL(location.href).searchParams.get('source') ?? 'bookmarks' })).value.observed);
      await source.getByRole('tab', { name: collection === 'likes' ? 'Bookmarks' : 'Likes', exact: true }).click();
      if (path === '/i/history/likes') await source.evaluate(() => history.replaceState(null, '', '/i/history'));
      await expect.poll(async () => popup.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'STATUS', source: new URL(location.href).searchParams.get('source') ?? 'bookmarks' })).value?.reason)).toBe('source_scope_changed');
      expect(await popup.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'STATUS', source: new URL(location.href).searchParams.get('source') ?? 'bookmarks' })).value.observed)).toBe(before);
      await library.reload();
      await expect.poll(() => library.getByText('Author', { exact: true }).count()).toBeGreaterThanOrEqual(20);
    }
    if (path === '/synthetic_user/likes') {
      await source.evaluate(() => { history.scrollRestoration = 'manual'; window.scrollTo(0, 0); });
      await source.reload(); await source.bringToFront(); await popup.reload();
      await expect(source.locator('article').first()).toContainText('合成投稿 1');
      await expect(popup.locator('.account')).toContainText('@synthetic_user');
      await expect(popup.getByLabel('取り込み対象')).toHaveValue('likes');
      await popup.getByLabel('待機方法').selectOption('random');
      await popup.getByLabel('最長（秒）').fill('4');
      await popup.getByLabel('今回の上限（件）').fill('10');
      await popup.getByLabel('取り込み範囲').selectOption('delta');
      await expect(popup.locator('.primary.full')).toBeEnabled();
      // Keep the fixture X tab visible while exercising the popup's real start handler.
      await source.bringToFront();
      await popup.evaluate(() => document.querySelector<HTMLButtonElement>('button.primary.full')!.click());
      await expect.poll(async () => popup.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'STATUS', source: 'likes' })).value?.id)).not.toBe(status.id);
      await expect.poll(async () => popup.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'STATUS', source: 'likes' })).value?.reason), { timeout: 10000 }).toBe('run_limit');
      const randomRun = await popup.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'STATUS', source: 'likes' })).value);
      expect(randomRun).toMatchObject({ source: 'likes', intervalMs: 3000, intervalMaxMs: 4000, observed: 10, added: 0, existing: 10 });
      const bookmarkRun = await popup.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'STATUS', source: 'bookmarks' })).value);
      expect(bookmarkRun ?? null).toBeNull();
      await popup.reload();
      await expect(popup.getByLabel('待機方法')).toHaveValue('random');
      await expect(popup.getByLabel('最長（秒）')).toHaveValue('4');
      await expect(popup.getByLabel('今回の上限（件）')).toHaveValue('10');
    }
  } finally { await context.close(); await rm(temp, { recursive: true, force: true }); }
});

for (const collection of ['bookmarks', 'likes'] as const) test(`MV3 imports from the visible position on ${collection}, continues and keeps delta at the top`, async () => {
  test.setTimeout(60000);
  const temp = await mkdtemp(join(tmpdir(), 'xbs-visible-import-'));
  const extension = join(temp, 'extension');
  await cp(resolve('dist'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['https://x.com/*'];
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  const context = await chromium.launchPersistentContext(join(temp, 'profile'), {
    channel: 'chromium', headless: true, viewport: { width: 900, height: 600 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    await context.route('https://x.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><style>
      body{margin:0;min-height:20000px}nav{position:fixed;right:0;top:0}main{height:8000px;position:relative}article{position:absolute;height:100px;width:500px;box-sizing:border-box}
      </style></head><body><nav><a data-testid="AppTabBar_Profile_Link" href="/synthetic_user">Profile</a></nav><main></main><script>
      function render(){const start=Math.max(1,Math.floor(scrollY/100)-2),end=Math.min(80,start+16);document.querySelector('main').innerHTML=Array.from({length:Math.max(0,end-start+1)},(_,i)=>{const id=start+i;return '<article data-testid="tweet" style="top:'+((id-1)*100)+'px"><a href="/test_author/status/'+id+'"><time datetime="2026-10-10T08:00:00Z"></time></a><div data-testid="tweetText">Synthetic '+id+'</div></article>';}).join('');}
      render();addEventListener('scroll',render);
      </script></body></html>` }));
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionId = worker.url().split('/')[2]!;
    const sourceUrl = collection === 'likes' ? 'https://x.com/synthetic_user/likes' : 'https://x.com/i/bookmarks';
    const source = await context.newPage(); await source.goto(sourceUrl);
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html?source=${collection}`);
    await source.bringToFront(); await source.evaluate(() => window.scrollTo(0, 930));
    await expect(source.locator('article').first()).toHaveAttribute('style', 'top:600px');
    const start = (mode: 'visible' | 'delta') => popup.evaluate(async ({ sourceUrl, collection, mode }) => {
      const [tab] = await chrome.tabs.query({ url: sourceUrl });
      const inspection = await chrome.runtime.sendMessage({ type: 'INSPECT_TAB', tabId: tab!.id });
      return chrome.runtime.sendMessage({ type: 'START', tabId: tab!.id, handle: inspection.value.handle, source: collection, options: { intervalMs: 3000, maxPosts: 10, mode } });
    }, { sourceUrl, collection, mode });
    const status = () => popup.evaluate(async collection => (await chrome.runtime.sendMessage({ type: 'STATUS', source: collection })).value, collection);
    const savedIds = () => popup.evaluate(async collection => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(collection === 'likes' ? 'xbookmarkshelf-likes' : 'x-bookmark-library'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      try { return await new Promise<string[]>((resolve, reject) => { const request = database.transaction('posts').objectStore('posts').getAll(); request.onsuccess = () => resolve(request.result.map((post: { postId: string }) => post.postId).sort((a: string, b: string) => Number(a) - Number(b))); request.onerror = () => reject(request.error); }); }
      finally { database.close(); }
    }, collection);

    expect((await start('visible')).ok).toBe(true);
    expect(await source.evaluate(() => scrollY)).toBe(930);
    await expect.poll(async () => (await status())?.reason, { timeout: 15000 }).toBe('run_limit');
    expect(await savedIds()).toEqual(Array.from({ length: 10 }, (_, i) => String(i + 10)));
    const position = await source.evaluate(() => scrollY); expect(position).toBeGreaterThan(930);
    expect((await start('visible')).ok).toBe(true);
    expect(await source.evaluate(() => scrollY)).toBe(position);
    await expect.poll(async () => (await status())?.reason, { timeout: 15000 }).toBe('run_limit');
    expect(await status()).toMatchObject({ observed: 10, added: 3, existing: 7 });
    expect(await savedIds()).toEqual(Array.from({ length: 13 }, (_, i) => String(i + 10)));

    expect((await start('delta')).ok).toBe(true);
    expect(await source.evaluate(() => scrollY)).toBe(0);
    await expect.poll(async () => (await status())?.reason, { timeout: 10000 }).toBe('run_limit');
    expect((await status()).importedPostIds).toEqual(Array.from({ length: 10 }, (_, i) => String(i + 1)));
    await source.evaluate(() => window.scrollTo(0, 10000));
    await expect(source.locator('article')).toHaveCount(0);
    const before = await savedIds();
    expect(await start('visible')).toMatchObject({ ok: false, error: '画面内に取り込める投稿がありません。Xの一覧で投稿を表示してください' });
    expect(await status()).toMatchObject({ state: 'stopped', reason: 'error', observed: 0 });
    expect(await savedIds()).toEqual(before); expect(await source.evaluate(() => scrollY)).toBe(10000);
  } finally { await context.close(); await rm(temp, { recursive: true, force: true }); }
});
