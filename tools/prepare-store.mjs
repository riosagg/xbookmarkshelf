import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { deflateRawSync, deflateSync, inflateSync } from 'node:zlib';

const output = 'release/chrome-web-store';
const digest = value => createHash('sha256').update(value).digest('hex');
const check = (condition, message) => { if (!condition) throw new Error(message); };
const checksumTable = Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(value) {
  let crc = 0xffffffff;
  for (const byte of value) crc = checksumTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function pngSize(data) {
  check(data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), 'Expected a PNG');
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}
// Lossless encoding conversion for store uploads. Source screenshots are unchanged.
function opaquePng(data) {
  const [width, height] = pngSize(data);
  check(data[24] === 8 && [2, 6].includes(data[25]) && data[28] === 0, 'Unsupported screenshot PNG encoding');
  const channels = data[25] === 6 ? 4 : 3;
  const pieces = [];
  for (let position = 8; position < data.length;) {
    const size = data.readUInt32BE(position), type = data.subarray(position + 4, position + 8);
    check(crc32(data.subarray(position + 4, position + 8 + size)) === data.readUInt32BE(position + 8 + size), 'PNG checksum mismatch');
    if (type.toString() === 'IDAT') pieces.push(data.subarray(position + 8, position + 8 + size));
    position += size + 12;
  }
  const raw = inflateSync(Buffer.concat(pieces)), stride = width * channels;
  check(raw.length === (stride + 1) * height, 'Unexpected PNG image size');
  const rgb = Buffer.alloc((width * 3 + 1) * height);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1), filter = raw[start];
    check(filter <= 4, 'Unknown PNG filter');
    const row = Buffer.from(raw.subarray(start + 1, start + 1 + stride));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0, up = previous[x], corner = x >= channels ? previous[x - channels] : 0;
      let correction = 0;
      if (filter === 1) correction = left;
      if (filter === 2) correction = up;
      if (filter === 3) correction = Math.floor((left + up) / 2);
      if (filter === 4) {
        const estimate = left + up - corner, a = Math.abs(estimate - left), b = Math.abs(estimate - up), c = Math.abs(estimate - corner);
        correction = a <= b && a <= c ? left : b <= c ? up : corner;
      }
      row[x] = (row[x] + correction) & 255;
    }
    for (let x = 0; x < width; x++) {
      check(channels === 3 || row[x * 4 + 3] === 255, 'Screenshots must be fully opaque');
      row.copy(rgb, y * (width * 3 + 1) + 1 + x * 3, x * channels, x * channels + 3);
    }
    previous = row;
  }
  const chunk = (name, payload) => {
    const type = Buffer.from(name), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(payload.length); checksum.writeUInt32BE(crc32(Buffer.concat([type, payload])));
    return Buffer.concat([length, type, payload, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([data.subarray(0, 8), chunk('IHDR', header), chunk('IDAT', deflateSync(rgb, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
async function filesIn(directory) {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) result.push(...await filesIn(path));
    else { check(item.isFile(), `Unexpected non-file: ${path}`); result.push(path); }
  }
  return result.sort();
}
async function zipDirectory(directory) {
  const local = [], central = []; let offset = 0;
  const files = await filesIn(directory);
  for (const path of files) {
    const name = relative(directory, path).replaceAll('\\', '/');
    check(!name.startsWith('.') && !name.includes('..') && !/\.(?:map|log|db|sqlite|pem|key)$/i.test(name), `Unexpected archive file: ${name}`);
    const filename = Buffer.from(name), data = await readFile(path), compressed = deflateRawSync(data, { level: 9 }), crc = crc32(data);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(8, 8); header.writeUInt16LE(0x21, 12); header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, compressed);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x800, 8); entry.writeUInt16LE(8, 10); entry.writeUInt16LE(0x21, 14); entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(compressed.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(filename.length, 28);
    entry.writeUInt32LE(offset, 42); central.push(entry, filename); offset += header.length + filename.length + compressed.length;
  }
  const directoryData = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directoryData.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directoryData, end]);
}
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function privacyHtml(markdown, language) {
  const targets = { 'PRIVACY.ja.md': 'ja.html', 'PRIVACY.md': 'index.html', 'README.md': 'https://github.com/riosagg/xbookmarkshelf#readme', 'README.ja.md': 'https://github.com/riosagg/xbookmarkshelf/blob/main/README.ja.md' };
  const inline = value => escape(value).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    const target = targets[url] ?? url; check(target.startsWith('https://') || ['ja.html', 'index.html'].includes(target), 'Unexpected privacy link');
    return `<a href="${escape(target)}">${label}</a>`;
  });
  let list = false; const lines = [];
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('- ') && list) { lines.push('</ul>'); list = false; }
    if (line.startsWith('- ')) { if (!list) { lines.push('<ul>'); list = true; } lines.push(`<li>${inline(line.slice(2))}</li>`); }
    else if (line.startsWith('## ')) lines.push(`<h2>${inline(line.slice(3))}</h2>`);
    else if (line.startsWith('# ')) lines.push(`<h1>${inline(line.slice(2))}</h1>`);
    else if (line.trim()) lines.push(`<p>${inline(line)}</p>`);
  }
  if (list) lines.push('</ul>');
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>xbookmarkshelf · Privacy</title><style>body{max-width:760px;margin:48px auto;padding:0 24px;font:16px/1.8 system-ui,sans-serif;color:#222a35;background:#fff}h1,h2{line-height:1.4}h2{margin-top:32px}a{color:#2563a0}code{overflow-wrap:anywhere}</style></head><body>${lines.join('\n')}</body></html>\n`;
}
if (process.argv[2] === '--assets') {
  const mark = JSON.parse(await readFile('assets/brand/mark.json', 'utf8'));
  check(mark.viewBox === '0 0 32 32' && mark.strokeWidth === 2 && /^[MmLlHhVvAaZz0-9.\s-]+$/.test(mark.path), 'Review brand geometry changes');
  const symbol = `<svg x="26" y="26" width="76" height="76" viewBox="${mark.viewBox}" fill="none" stroke="#19202a" stroke-width="${mark.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"><path d="${mark.path}"/></svg>`;
  await writeFile('assets/brand/icon.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">\n  <!-- Original X and stacked-book geometry: assets/brand/mark.json. MIT. -->\n  <rect x="16" y="16" width="96" height="96" rx="22" fill="#e7ebf0"/>\n  ${symbol}\n</svg>\n`);
  const promo = await readFile('assets/store/promo-tile.svg', 'utf8');
  const promoSymbol = `<svg x="60" y="65" width="46" height="50" viewBox="${mark.viewBox}" fill="none" stroke="#19202a" stroke-width="${mark.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"><path d="${mark.path}"/></svg>`;
  check(/<svg data-brand-mark[\s\S]*?<\/svg>/.test(promo), 'Missing promotional brand slot');
  await writeFile('assets/store/promo-tile.svg', promo.replace(/<svg data-brand-mark[\s\S]*?<\/svg>/, promoSymbol.replace('<svg ', '<svg data-brand-mark ')));
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    await page.route('**/*', route => route.abort());
    await mkdir('public/icons', { recursive: true }); await mkdir(output, { recursive: true });
    const icon = await readFile('assets/brand/icon.svg', 'utf8');
    for (const size of [16, 32, 48, 128]) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(`<style>body{margin:0;background:transparent}body>svg{display:block;width:${size}px;height:${size}px}</style>${icon}`);
      await page.screenshot({ path: `public/icons/icon-${size}.png`, omitBackground: true });
    }
    await page.setViewportSize({ width: 440, height: 280 });
    await page.setContent(`<style>body{margin:0}svg{display:block}</style>${await readFile('assets/store/promo-tile.svg', 'utf8')}`);
    await writeFile(`${output}/promo-440x280.png`, opaquePng(await page.screenshot()));
  } finally { await browser.close(); }
  console.log('Rendered original X and stacked-books logo at 16/32/48/128px and a 440x280 promotional tile.');
} else {
  check(process.argv.length === 2, 'Use prepare-store.mjs with no arguments or --assets');
  const manifest = JSON.parse(await readFile('public/manifest.json', 'utf8'));
  check(JSON.stringify(manifest) === JSON.stringify(JSON.parse(await readFile('dist/manifest.json', 'utf8'))), 'Rebuild the extension first');
  check(manifest.manifest_version === 3 && manifest.version === '0.1.0' && manifest.default_locale === 'en', 'Unexpected manifest metadata');
  check(manifest.permissions.join(',') === 'activeTab,scripting,alarms' && !manifest.host_permissions && !manifest.optional_permissions && JSON.stringify(manifest.optional_host_permissions) === JSON.stringify(['http://127.0.0.1/*', 'http://localhost/*', 'https://pbs.twimg.com/*']), 'Review permission changes first');
  for (const [size, name] of Object.entries(manifest.icons)) {
    const source = await readFile(`public/${name}`), built = await readFile(`dist/${name}`);
    check(source.equals(built) && pngSize(built).every(value => value === Number(size)), `Invalid icon: ${name}`);
  }
  const descriptions = {};
  for (const language of ['en', 'ja']) {
    const name = `_locales/${language}/messages.json`, source = await readFile(`public/${name}`), built = await readFile(`dist/${name}`);
    check(source.equals(built), `Stale locale: ${language}`);
    descriptions[language] = JSON.parse(source).extensionDescription.message;
    check(descriptions[language].length > 0 && descriptions[language].length <= 132, `Description too long: ${language}`);
  }
  await mkdir(`${output}/screenshots`, { recursive: true }); await mkdir(`${output}/review`, { recursive: true }); await mkdir(`${output}/privacy`, { recursive: true });
  for (const [i, name] of ['bookmarks', 'backup', 'settings'].entries()) {
    const png = await readFile(`assets/screenshots/${name}.png`);
    check(pngSize(png).join('x') === '1280x800', 'Wrong screenshot size');
    await writeFile(`${output}/screenshots/${String(i + 1).padStart(2, '0')}-${name}.png`, opaquePng(png));
  }
  const promo = await readFile(`${output}/promo-440x280.png`);
  check(pngSize(promo).join('x') === '440x280' && promo[25] === 2, 'Render the promo tile with --assets first');
  await copyFile('public/icons/icon-128.png', `${output}/icon-128.png`);
  const archiveName = `xbookmarkshelf-extension-v${manifest.version}.zip`;
  await writeFile(`${output}/${archiveName}`, await zipDirectory('dist'));
  const timestamp = '2026-10-13T00:00:00.000Z';
  const sample = { format: 'x-bookmark-library', formatVersion: 2, exportedAt: timestamp,
    accounts: [{ id: 'store_demo', handle: 'shelf_demo' }],
    posts: [
      ['101', 'Save a useful reference and add the Reading mark.'],
      ['102', 'Search for the word notebook to find this synthetic post.'],
      ['103', 'This synthetic post has no date. It appears last when sorting by posting date.'],
    ].map(([postId, text], index) => ({ accountId: 'store_demo', postId, text, authorHandle: 'shelf_demo', authorName: 'Synthetic demo',
      url: `https://x.com/shelf_demo/status/${postId}`, postedAt: index === 2 ? null : timestamp, observedAt: timestamp, partial: true, media: [], firstImportedAt: timestamp, lastImportedAt: timestamp })),
    tags: [{ id: 'store_reading', accountId: 'store_demo', name: 'Reading', mark: 'book', markOrder: 0 }],
    postTags: [{ accountId: 'store_demo', postId: '101', tagId: 'store_reading' }],
    userStates: [{ accountId: 'store_demo', postId: '101', read: true, favorite: false }],
  };
  await writeFile(`${output}/review/bookmarks.json`, JSON.stringify(sample, null, 2) + '\n');
  await writeFile(`${output}/review/likes.json`, JSON.stringify({ ...sample, format: 'xbookmarkshelf-likes', formatVersion: 1 }, null, 2) + '\n');
  await writeFile(`${output}/privacy/index.html`, privacyHtml(await readFile('PRIVACY.md', 'utf8'), 'en'));
  await writeFile(`${output}/privacy/ja.html`, privacyHtml(await readFile('PRIVACY.ja.md', 'utf8'), 'ja'));
  await writeFile(`${output}/SUBMISSION.md`, submissionGuide(descriptions, archiveName));
  const checksums = [];
  for (const name of await filesIn(output)) if (!name.endsWith('SHA256SUMS.txt')) checksums.push(`${digest(await readFile(name))}  ${relative(output, name).replaceAll('\\', '/')}`);
  await writeFile(`${output}/SHA256SUMS.txt`, checksums.join('\n') + '\n');
  console.log(`Store submission files prepared in ${output}; EN/JA description lengths ${descriptions.en.length}/${descriptions.ja.length}.`);
}

function submissionGuide(descriptions, archiveName) {
  return `# xbookmarkshelf · Chrome Web Store submission

Version: 0.1.0
Publisher name: riosagg
Category: Productivity / Tools（ダッシュボードに表示される分類から選択）
Primary language: English。日本語の掲載文も用意済み。
Price: Free

## Uploads

- Extension package: ${archiveName}。これだけを拡張ZIPとしてアップロード。
- Store icon: icon-128.png
- Small promo tile: promo-440x280.png
- Screenshots: screenshots/01-bookmarks.png、02-backup.png、03-settings.png
- Reviewer samples: review/bookmarks.json、review/likes.json。審査資料として渡し、製品ZIPへ含めない。
- Privacy page: privacy/index.html、privacy/ja.html。公開先へ配置してURLを入力する。

スクリーンショットは1280×800、紹介画像は440×280。申請用PNGは24ビットRGBで、元画像のRGB画素を保持する。取り込みPopupの375×520画像は今回の提出画像へ含めていない。

## Listing · English

### Name

xbookmarkshelf

### Short description

${descriptions.en}

### Detailed description

xbookmarkshelf is a viewer for organizing and reading your X bookmarks and likes. Keep them in separate libraries, create marks with your own names and icons, and find posts with search and filters.

- Create up to 30 marks per account and add multiple marks to a post.
- Search post text and filter by author, mark, read status, media, links, or posting date.
- Switch between card and list views, light and dark themes, and Japanese and English.
- Sort by save order or posting date and browse with continuous scrolling.
- Back up all posts or one mark as JSON. Export display settings separately.
- Delete selected posts or clear the current library.

To import, sign in to X, open Bookmarks or Likes, and click the extension icon. The extension reads the content displayed on that page and saves it in small batches. You can set a fixed wait or a random wait within a chosen range. Repeated imports avoid duplicates.

Posts and settings are stored in your Chrome profile. Saved post text can be read offline. Image previews load from X's image server and can be turned off. Videos show a cover image and a link to the original post; image and video files are not downloaded for offline storage.

There are no ads, analytics, cloud sync, or developer access to your saved posts. X page changes can affect importing, and complete imports are not guaranteed. Use the DOM import feature at your own risk. This is an independent project and is not affiliated with or endorsed by X.

## 掲載文 · 日本語

### 名前

xbookmarkshelf

### 短い説明

${descriptions.ja}

### 詳細な説明

xbookmarkshelfは、Xのブックマークやいいねを整理して読むためのビューアーです。ブックマークといいねを別々に管理し、自分で名前とアイコンを付けたマークで分類できます。検索やフィルタで読みたい投稿を探せます。

- アカウントごとに30個までマークを作成。1つの投稿に複数付けられます。
- 本文検索と、投稿者・マーク・既読・メディア・リンク・投稿日によるフィルタ。
- カード／リスト表示、ライト／ダーク、日本語／英語の切り替え。
- 保存順や投稿日順での並べ替えと連続スクロール。
- 投稿全体やマークごとのJSONバックアップ。表示設定は別に書き出せます。
- 選択した投稿の削除と、選択中のライブラリの全削除。

取り込みは、Xへログインしてブックマークかいいねの一覧を開き、拡張アイコンから始めます。画面に表示された内容を少量ずつ読み取り、Chrome内に保存します。待機時間は固定、または指定した最短〜最長の間でランダムに設定できます。再取り込みでは重複を除きます。

投稿と設定の保存先は利用中のChromeです。保存した本文はオフラインでも読めます。画像プレビューはXの画像サーバーから読み込み、設定でオフにできます。動画は表紙と元投稿へのリンクを表示します。画像や動画の本体をダウンロードして保管する機能はありません。

広告、アクセス解析、クラウド同期はなく、開発者が保存した投稿を読む仕組みもありません。Xの画面構造が変わると取り込めなくなる場合があり、全件取得は保証しません。DOMを読む取り込み機能の利用は自己責任でお願いします。Xとは関係のない独立したプロジェクトです。

## Privacy practices · 入力用

### Single purpose

Organize, search, filter, and read the user's X bookmarks and likes in a local Chrome library, with user-initiated import and JSON backup.

XのブックマークやいいねをChrome内で分類・検索・閲覧するためのライブラリです。利用者の操作で取り込みとJSONバックアップを行います。

### activeTab justification

Provides temporary access to the X tab after the user clicks the extension icon. The extension checks the selected Bookmarks or Likes page and the signed-in account, then reads the displayed posts for the user's local library. It does not request access to all sites or inspect unrelated tabs.

拡張アイコンを押したときだけXのタブへアクセスし、ブックマーク／いいねの一覧と対象アカウントを確認して、表示された投稿をローカルライブラリへ取り込みます。他のサイトや無関係なタブは読み取りません。

### alarms and optional host access justification

Alarms resume user-started classification jobs; no inference runs without an active job. Optional host access is requested only when connecting to localhost/127.0.0.1 and, if selected, fetching pbs.twimg.com images for local inference. No cloud AI endpoint is supported.

### scripting justification

Injects the packaged content.js into the user-selected X tab to read displayed post text, authors, dates, links, and image URLs. The script scrolls the selected list in small steps while the user-initiated import is running. All executable code is bundled with the extension.

利用者が選んだXのタブへ同梱のcontent.jsを注入し、表示された本文・投稿者・日時・リンク・画像URLを読み取ります。取り込み中は一覧を少しずつスクロールします。実行コードはすべて拡張へ同梱します。

### Remote code

No, I am not using remote code.

All JavaScript and UI code is packaged in the extension. Images from https://pbs.twimg.com are previews, not executable code. No remote scripts, eval, or external code loader is used. Optional AI classification sends typed requests to a user-configured localhost LM Studio Decision API. Responses are validated data, never executable code.

### Data usage

ローカルで扱うデータも申告する。現在の実装に対応する選択は次のとおり。

- Personally identifiable information: X account handles and post author names/handles. Local use only; no passwords, cookies, or tokens.
- Web history: the current X list URL is checked for import and post/link URLs are stored with the saved content. There is no general browser-history collection or history permission.
- User activity: user-chosen marks and read/unread state in this app. No general click, keystroke, mouse, or network monitoring.
- Website content: selected X post text, author/date metadata, links, quoted content, and media URLs. Stored in the local library and user-exported JSON.

Health information、Financial and payment information、Authentication information、Personal communications、Locationは専用の取得機能がないため選択しない。投稿に書かれた内容はWebsite contentとして扱う。申請画面の定義が変わっている場合は、表示された定義と実装を照合する。

データの販売・無関係な目的への利用・信用判断への利用をしない旨の認証3項目は、本文と実装を確認して選択する。画像プレビューは初期オンで、pbs.twimg.comへ通信することを隠さない。

## Reviewer instructions · English

The extension itself has no sign-in or subscription. JSON restore and library features can be tested without an X account using the two synthetic samples provided with this submission.

1. Click the extension icon, then Open library.
2. In Bookmarks, open Backup and select review/bookmarks.json. Confirm the preview and restore it.
3. All bookmarks shows three synthetic posts. The Reading mark contains one post. Read later contains two posts.
4. Search for notebook. One post matches. Clear search and filter Author by @shelf_demo; all three posts match.
5. Assign or remove the Reading mark using the book icon. Open a post to mark it as read. Check the Read later and Unmarked pages.
6. Change posting-date order. The post without a date remains last in both date directions.
7. Export a post backup from Backup. Export/import display settings from Settings and check the confirmation before applying.
8. Switch to Likes and restore review/likes.json from its Backup page. The libraries remain separate.

For live importing, sign in to a test X account using X's own interface. Open https://x.com/i/history and choose Bookmarks, or open https://x.com/i/history/likes. Click the extension icon, select a small per-run limit, and start importing while keeping the X tab visible. Verify the library after the run. No credentials are included in these files. If the review process requires supplied X test credentials, the publisher must provide a dedicated test account separately.

The synthetic samples contain no real posts or media. Their original-post URLs are structural examples, not live test content. The screenshots show the actual UI with publicly available posts from X's own account.

## 審査手順 · 日本語

拡張自体にログインや有料登録はありません。添付した合成JSONで、Xへログインせずに管理機能を確認できます。

1. 拡張アイコンからOpen libraryを押す。
2. BookmarksのBackupでreview/bookmarks.jsonを選び、プレビューを確認して復元する。
3. 合成投稿3件、Readingマーク1件、Read later 2件を確認する。
4. notebookで検索すると1件。検索を消し、Authorへ@shelf_demoを入れると3件になる。
5. 本のアイコンでマークを付け外しし、本文を開いて既読にする。Read laterとUnmarkedの表示を確認する。
6. 投稿日順を変える。投稿日不明の投稿は新しい順・古い順のどちらでも末尾になる。
7. 投稿バックアップと設定バックアップを出力する。設定復元では確認後に適用する。
8. Likesへ切り替え、review/likes.jsonを復元する。分類と既読が別管理であることを確認する。

Xからの取り込み確認には、審査用XアカウントでXへログインし、ブックマーク／いいねの画面を開く必要があります。確認用JSONと製品ZIPには認証情報を含めていません。

## URLs · 公開前に確定

候補のホームページ: https://github.com/riosagg/xbookmarkshelf
候補のサポート: https://github.com/riosagg/xbookmarkshelf/issues
候補のプライバシー: https://github.com/riosagg/xbookmarkshelf/blob/main/PRIVACY.md

GitHubをPrivateのまま使う場合、これらのURLはストアの公開URLとして使えません。別の公開先を使う場合はprivacyフォルダのHTMLを配置する。申請前にシークレットウィンドウで本文が読めることを確認する。連絡先メールは実際の連絡先を開発者アカウントの設定へ入力・確認する。

## 最後に行うこと

1. Chrome Web Store開発者登録・連絡先・2段階認証を確認する。
2. 公開プライバシーURLとホームページ・サポートURLを確定する。
3. ダッシュボードで新しいアイテムを作り、拡張ZIPをアップロードする。
4. 掲載文、画像、Privacy practices、必要なら審査用の追加資料を入力する。
5. 配布地域と公開範囲を選ぶ。最初は審査後の自動公開をオフにし、承認後に手動公開する。
6. 入力内容と権限を確認してから審査へ提出する。

## 開発者モード版からストア版へ移る場合

ストア版は開発者モード版と拡張IDが異なるため、既存のブラウザ内データは自動では引き継がれない。切り替える前にブックマーク・いいねの投稿JSONと設定JSONを保存し、ストア版の対応するライブラリへ復元する。元の拡張を削除するのは復元結果を確認した後にする。

このフォルダの準備は、Xの取得方式の許諾確認やWindowsの未確認試験の完了を意味しない。現在の確認範囲と残る作業はプロジェクトのTASKS・RUNBOOKに記録している。

## Official references

- Images: https://developer.chrome.com/docs/webstore/images
- Privacy fields: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- Local data disclosure: https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
- Limited Use: https://developer.chrome.com/docs/webstore/program-policies/limited-use
- Publication: https://developer.chrome.com/docs/webstore/publish
`;
}
