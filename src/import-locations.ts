import { isLibraryUrl, librarySourceUrl, type ImportLocations, type LibrarySource } from './model';

export const DEFAULT_IMPORT_LOCATIONS: Readonly<ImportLocations> = {
  bookmarks: 'https://x.com/i/bookmarks',
  likes: 'https://x.com/i/history/likes',
};
export const IMPORT_URL_MAX_LENGTH = 2048;

export function importSourceUrl(source: LibrarySource, locations: ImportLocations, handle?: unknown): string {
  return locations[source] === DEFAULT_IMPORT_LOCATIONS[source] ? librarySourceUrl(source, handle) : locations[source];
}

function xUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length > IMPORT_URL_MAX_LENGTH || /[\s\\\u0000-\u001f\u007f]/.test(value) || !/^https:\/\/x\.com\//i.test(value)) return null;
  try {
    const url = new URL(value);
    return url.origin === 'https://x.com' && !url.username && !url.password ? url : null;
  } catch { return null; }
}
function pathKey(url: URL): string { return url.pathname.replace(/\/+$/, '') || '/'; }
function routeKey(url: URL): string {
  const params = new URLSearchParams(url.search); params.sort();
  return `${pathKey(url)}?${params}`;
}
function normalizeLocation(value: unknown): string {
  const url = xUrl(typeof value === 'string' ? value.trim() : value);
  // A setting identifies a list, never a profile, post, editor, or account action.
  if (!url || url.hash || /%/.test(url.pathname) || pathKey(url) === '/' ||
      /^\/(home|explore|search|notifications|messages|settings|login|logout|intent|compose)(\/|$)/i.test(url.pathname) ||
      /^\/i\/(flow|oauth|api|web\/status|status)(\/|$)/i.test(url.pathname) || /\/status(\/|$)/i.test(url.pathname) ||
      /^\/[a-zA-Z0-9_]{1,15}$/.test(pathKey(url))) throw new Error('取得先にはXの一覧ページのURLを指定してください');
  return url.href;
}
export function validateImportLocations(value: unknown): ImportLocations {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('取得先URLの設定が不正です');
  const input = value as ImportLocations;
  const bookmarks = normalizeLocation(input.bookmarks); const likes = normalizeLocation(input.likes);
  const bookPath = pathKey(new URL(bookmarks)); const likePath = pathKey(new URL(likes));
  if (bookPath === '/i/history/likes' || /^\/[a-zA-Z0-9_]{1,15}\/likes$/.test(bookPath) || likePath === '/i/bookmarks') throw new Error('ブックマークといいねの取得先を確認してください');
  if (routeKey(new URL(bookmarks)) === routeKey(new URL(likes))) throw new Error('ブックマークといいねには別々のURLを指定してください');
  return { bookmarks, likes };
}
// Legacy runs omit the setting snapshot. Malformed explicit snapshots fail closed.
export function runImportLocations(value: unknown): ImportLocations | null {
  if (value === undefined) return { ...DEFAULT_IMPORT_LOCATIONS };
  try { return validateImportLocations(value); } catch { return null; }
}
export function configuredImportSource(value: unknown, locations: ImportLocations): LibrarySource | null {
  const url = xUrl(value);
  if (!url) return null;
  for (const source of ['bookmarks', 'likes'] as const) {
    const target = xUrl(locations[source]);
    if (target && routeKey(url) === routeKey(target)) return source;
  }
  return null;
}
export function isImportPageUrl(value: unknown, locations: ImportLocations): value is string {
  return xUrl(value) !== null && (isLibraryUrl(value) || configuredImportSource(value, locations) !== null);
}
