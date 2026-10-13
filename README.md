# xbookmarkshelf

A viewer for organizing and reading your X bookmarks and likes. Create marks with your own names and icons to group posts by topic, then search and filter your library. Available as a Chrome extension and a standalone local library app that opens JSON files on your computer.

Version 0.1.0 is designed for Chrome on Windows.

## Install the Chrome extension

The packaged extension requires Chrome 120 or later. You do not need Node.js, npm, or a server to use it.

1. Extract the extension ZIP.
2. Open `chrome://extensions` in Chrome and enable Developer mode.
3. Click "Load unpacked" and select the extracted folder containing `manifest.json`.

To update, replace the files in the same folder and reload the extension, X tab, and library. Use the same extension ID and Chrome profile to retain your data.

## Import bookmarks and likes

The extension reads content displayed on X's pages (the DOM). Use it at your own risk.

1. Sign in to X and open Bookmarks or Likes in [History](https://x.com/i/history). The regular bookmarks page and the likes page on your own profile are also supported.
2. Click the extension icon and check the import target, scope, wait mode, and posts per run.
3. Click "Import gradually" and keep the X tab visible.

Posts are saved in batches of up to 10. The default is a fixed three-second wait and 100 posts per run. Choose a fixed wait or a random wait between a minimum and maximum, within 3–30 seconds. The three-second minimum helps reduce load on X. The limit can be set to 10–1,000 posts, and your import settings are remembered.

You can change the bookmarks and likes URLs under "Settings → Import URLs" and restore the defaults with "Reset URLs". Only HTTPS URLs on `x.com` are supported. Normally, no changes are needed. These settings can handle URL changes; changes to X's page structure may still require an extension update.

Importing continues after you close the popup, and repeated imports avoid duplicate posts. It stops if the X tab is hidden, you navigate away, or an access restriction is detected. Complete imports and full synchronization are not guaranteed.

## Browse and organize your library

Click "Open library", then use the switch below the logo to choose Bookmarks or Likes. Posts, marks, and read status are managed separately; display settings are shared.

- Search post text and filter by author, account, mark, read state, media, links in the text, or posting date.
- Create up to 30 marks per account, each with a name and icon. A post can have multiple marks, with up to 20 marks and tags combined.
- Click a mark icon to assign or remove it. Find additional marks under "…" and change their order on the marks page.
- Opening a post marks it as read and removes it from "Read later". "Unmarked" shows posts without a mark.
- Sort by save order or by newest or oldest posting date. Posts with unknown dates appear last when sorting by posting date.
- Use continuous scrolling, card or list view, 1–5 columns, light or dark themes, and Japanese or English. The default language follows your browser's language.

## Images, videos, and link cards

Image previews are on by default in the extension. The local library starts with previews off and remembers your choice. When enabled, images load from their saved URLs. In both versions, click a photo to enlarge it and use the arrows to browse multiple images. Videos show a cover image and a link to the original post. The extension also saves link cards and quoted posts displayed on X.

Images load only from `https://pbs.twimg.com`. There is no feature for downloading image or video files. Images may be unavailable offline or when their URLs expire.

## Backups and deletion

Post backups and display settings use separate JSON files.

| File | Contents and location |
| --- | --- |
| Post backup | Posts, read status, marks, tags, and media URLs. Export all posts or one mark from the backup page. |
| Settings file | Language, theme, columns, view, and image previews. Export or import from Settings. |

Post backup filenames use `xbookmarkshelf-bookmarks-…json` for bookmarks and `xbookmarkshelf-likes-…json` for likes. Older files with `posts` in the name can still be imported.

Post backup imports are limited to 20 MiB per file; settings files to 64 KiB. Post backups do not include display settings or import history. Restore bookmarks and likes into their corresponding libraries. Reimporting preserves read status, marks, and tags.

Large backups are split automatically. Save every part and select all parts together when restoring or adding them to the local library.

Delete selected posts from the list, or delete all posts in the current library from Settings. Settings also shows the post count and estimated storage usage. Mark and tag definitions, settings, and your bookmarks and likes on X are retained. Back up your posts before deleting them, and check that every part of a split backup has been saved.

## Use the local library

Open `xbookmarkshelf-local.html` in desktop Chrome. The HTML file is the app; a separate library JSON file stores your posts. No extension or server is required.

1. Start with "Create library" or "Open library JSON".
2. Use "Add import" to select `data/like.js` from an X archive, an extension post backup, or a library JSON. Select every part of a split backup together.
3. Search and organize posts as you would in the extension. Click "Save" to write the library JSON after importing or editing.
4. On your next visit, the app can reopen the previous library JSON. If file access needs permission again, click "Open".

The local library supports up to 200,000 posts in total and a library JSON of up to 512 MiB. Source like.js files and post backups are limited to 20 MiB per file. It uses memory while open. The browser remembers only the selected file reference and your image preview preference.

Back up the entire library, Bookmarks or Likes, or one mark. Bookmarks can also be exported as post JSON for the extension. Display settings are included in the library JSON. Sort by file order, reverse order, or posting date.

Author details and images missing from like.js are not fetched automatically. Dates calculated from post IDs are posting dates, not the time you liked a post. Multiple like.js files are merged into one collection.

If saving fails, your unsaved changes remain in the open app. Retry or use "Save as", and avoid editing the same library JSON in multiple windows. Browsers without direct file saving download the JSON instead.

## License

The product code is licensed under the [MIT License](LICENSE), copyright 2026 riosagg. Third-party code and the posts and images you save remain subject to their respective licenses and rights.

Bundled library licenses are listed in [THIRD_PARTY_NOTICES.txt](public/THIRD_PARTY_NOTICES.txt) for the extension and in the local app's license section. Keep the included license notices when redistributing the app.

[Changelog](CHANGELOG.md) · [Security](SECURITY.md) · [Privacy](PRIVACY.md)

<details>
<summary>Build from source</summary>

Requires Node.js 22.12 or later and npm.

```sh
npm ci
npm run build
```

Load the `dist` folder into Chrome for the extension. Open `local-dist/xbookmarkshelf-local.html` for the local library.

</details>
