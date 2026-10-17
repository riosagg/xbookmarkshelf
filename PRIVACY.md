# Privacy

English | [日本語](PRIVACY.ja.md)

Last updated: October 15, 2026

This policy covers the Chrome extension and local library app, version 0.1.1.

## Data stored

The app stores the post text, authors, accounts, dates, and URLs available during import. It also stores your marks, tags, read status, and display settings. The extension saves import settings, import URLs and optional local AI connection settings. Classification jobs retain post IDs and progress until processed or stopped; import history records the IDs committed during each new import.

Only image and video URLs are stored. It does not save media files for offline use. Optional AI classification reads temporary image bytes as described below. It does not collect or store your X password, cookies, or authentication tokens.

## How data is used

Data is used only to import, organize, search, filter, and read your bookmarks and likes. xbookmarkshelf follows the Chrome Web Store's Limited Use requirements. Data is not sold, used for advertising or credit decisions, or made available to the developer for reading.

Saved data remains in your browser profile or files until you remove it. Deleting posts retains mark definitions and settings, as described below.

## Storage locations

- Chrome extension: posts and settings are stored locally in the Chrome profile you use.
- Local library: clicking "Save" writes posts and settings to a library JSON file on your computer.

The local app keeps only two things in browser storage: the selected file reference for reopening and your image preview preference.

The local app can also convert and add X API v2 JSON files you select on your computer. This does not require an API key or contact the X API. Credentials and raw API error messages in the JSON are not included in saved data. You choose the destination library and account before confirming, then click Save to write the changes to your library file.

## Network connections

The extension imports posts by reading the X page where you are signed in.

Image previews are on by default in the extension. You can turn them off in Settings, and your choice is remembered. The local app starts with previews off.

In both versions, enabling image previews loads images from `https://pbs.twimg.com` without sending the referring page's URL. Opening an original post or a link in its text connects to the destination site.

The app does not send your posts, marks, or tags to the developer. It has no advertising, analytics, or cloud sync.

## Optional local AI classification

Only after you connect in Settings and start classification, the app sends the target post text, quoted text, link-card titles and mark names to your selected LM Studio server on this computer. If AI images are enabled, it reads up to four images from `https://pbs.twimg.com`, resizes them in memory and sends JPEG data to that same local server. This image choice is independent of display previews. No X credentials are sent.

The connection is limited to HTTP localhost or 127.0.0.1. The app does not connect to a cloud AI service. Your local server controls its own request logs and processing; check its settings if you do not want inputs logged. The extension saves the server URL, model ID, threshold and image choice outside display-setting backups. The local app keeps them only for the current session and does not add them to its browser storage or library JSON. No API authentication tokens are collected or stored.

The extension uses alarms to resume work that you started. No classification requests are made while there is no active job. Disconnecting stops its jobs and removes the saved connection setting; it retains assigned marks and ordinary library data.

The extension remembers your on/off choice for classification during import. Restoring that choice does not start an import or classification; you must start the import. Without saved AI connection settings, imports do not send posts to AI.

## Deletion and backups

In the extension, delete selected posts from the list or delete all posts in the current library (Bookmarks or Likes) from Settings. Mark and tag definitions and settings are retained. Your bookmarks and likes on X are unchanged.

Delete local library JSON files and exported backups from wherever you saved them. "Forget selected file" removes the file reference remembered by the browser; it does not delete the library JSON.

Library JSON files and post backups contain your posts, marks, and tags. The app does not encrypt these files.

See the [README](README.md) for usage instructions.
