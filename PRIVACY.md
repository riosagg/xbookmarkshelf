# Privacy

English | [日本語](PRIVACY.ja.md)

Last updated: October 13, 2026

This policy covers the Chrome extension and local library app, version 0.1.0.

## Data stored

The app stores the post text, authors, accounts, dates, and URLs available during import. It also stores your marks, tags, read status, and display settings. The extension saves import settings and import URLs as well.

Only image and video URLs are stored. The app has no media download feature. It does not collect or store your X password, cookies, or authentication tokens.

## How data is used

Data is used only to import, organize, search, filter, and read your bookmarks and likes. xbookmarkshelf follows the Chrome Web Store's Limited Use requirements. Data is not sold, used for advertising or credit decisions, or made available to the developer for reading.

Saved data remains in your browser profile or files until you remove it. Deleting posts retains mark definitions and settings, as described below.

## Storage locations

- Chrome extension: posts and settings are stored locally in the Chrome profile you use.
- Local library: clicking "Save" writes posts and settings to a library JSON file on your computer.

The local app keeps only two things in browser storage: the selected file reference for reopening and your image preview preference.

## Network connections

The extension imports posts by reading the X page where you are signed in.

Image previews are on by default in the extension. You can turn them off in Settings, and your choice is remembered. The local app starts with previews off.

In both versions, enabling image previews loads images from `https://pbs.twimg.com` without sending the referring page's URL. Opening an original post or a link in its text connects to the destination site.

The app does not send your posts, marks, or tags to the developer. It has no advertising, analytics, or cloud sync.

## Deletion and backups

In the extension, delete selected posts from the list or delete all posts in the current library (Bookmarks or Likes) from Settings. Mark and tag definitions and settings are retained. Your bookmarks and likes on X are unchanged.

Delete local library JSON files and exported backups from wherever you saved them. "Forget selected file" removes the file reference remembered by the browser; it does not delete the library JSON.

Library JSON files and post backups contain your posts, marks, and tags. The app does not encrypt these files.

See the [README](README.md) for usage instructions.
