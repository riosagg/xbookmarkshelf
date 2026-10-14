# Changelog

English | [日本語](CHANGELOG.ja.md)

## Unreleased

- Add optional LM Studio/d1 auto-marking during extension imports, from post-import/account buttons, and from local search results. Preserve existing marks and leave unmatched posts unchanged.
- Move auto-mark scope, execution and progress to a dedicated page. Preserve the existing post list and keep connection settings at the bottom of Settings.

## v0.1.0

- Chrome extension and a standalone local library app that stores posts in JSON files.
- Separate Bookmarks and Likes libraries, with matching backup filenames.
- Named marks, read status, text search, filters, and sorting by posting date.
- Exact author filtering with `@handle`, while input without `@` searches names and handles by partial match.
- Image previews and photo enlargement in both versions, video cover images, link cards, and quoted posts. Extension previews are on by default.
- JSON backup and restore, exports by mark, and automatic splitting of large backups.
- Japanese and English interfaces with saved display settings.
- Gradual importing in the extension, with fixed or random wait intervals and configurable import URLs.
- Local library support for up to 200,000 posts in total and library JSON files up to 512 MiB.

See the [README](README.md) for setup, usage, and limitations.
