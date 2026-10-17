# Changelog

English | [日本語](CHANGELOG.ja.md)

## Unreleased

- Import X API v2 list-response JSON in the local library. Choose Bookmarks or Likes and the owning account, and import multiple pages together.
- Keep existing marks, tags and read status while supplementing text, authors, images, video covers and quotes from the JSON. No API connection or key storage is required.

## v0.1.1

- Add optional LM Studio/d1 auto-marking during extension imports, for saved posts in an account scope, and from local search results. Preserve existing marks and leave unmatched posts unchanged.
- Move auto-mark scope, execution and progress to a dedicated page. Preserve the existing post list and keep connection settings at the bottom of Settings.
- Remember the popup's auto-mark on/off choice across reopening. Disable it while AI connection settings are absent, and restore it when reconnected.
- Show import classification progress, results and failures without a separate post-import start or retry button.
- Keep local filters visible and add a close control to operation notices.

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
