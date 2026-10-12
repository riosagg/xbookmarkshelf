import { db, type LibraryDB } from './db';
import type { Theme } from './theme';
import { isLanguagePreference, type LanguagePreference } from './messages';

export interface DisplaySettings {
  theme: Theme;
  columns: number;
  layout: 'grid' | 'list';
  previews: boolean;
  language?: LanguagePreference;
}
export interface SettingsBackup {
  format: 'xbookmarkshelf-settings';
  formatVersion: 1;
  exportedAt: string;
  settings: DisplaySettings;
}
export const MAX_SETTINGS_FILE_BYTES = 64 * 1024;
export const DEFAULT_DISPLAY_SETTINGS: Readonly<DisplaySettings> = { theme: 'light', columns: 3, layout: 'grid', previews: true, language: 'system' };
const LEGACY_SETTINGS_KEYS = ['theme', 'columns', 'layout', 'previews'] as const;
const SETTINGS_KEYS = [...LEGACY_SETTINGS_KEYS, 'language'] as const;

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
export function validateSettingsBackup(input: unknown): SettingsBackup {
  if (!hasExactKeys(input, ['format', 'formatVersion', 'exportedAt', 'settings'])
    || input.format !== 'xbookmarkshelf-settings' || input.formatVersion !== 1) {
    throw new Error('対応する設定ファイルではありません。設定画面から書き出したJSONを選んでください。');
  }
  if (typeof input.exportedAt !== 'string' || input.exportedAt.length > 40 || !Number.isFinite(Date.parse(input.exportedAt))) {
    throw new Error('設定ファイルの日時が不正です。');
  }
  const settings = input.settings;
  if ((!hasExactKeys(settings, SETTINGS_KEYS) && !hasExactKeys(settings, LEGACY_SETTINGS_KEYS))
    || (settings.theme !== 'light' && settings.theme !== 'dark')
    || typeof settings.columns !== 'number' || !Number.isInteger(settings.columns) || settings.columns < 1 || settings.columns > 5
    || (settings.layout !== 'grid' && settings.layout !== 'list') || typeof settings.previews !== 'boolean'
    || (Object.hasOwn(settings, 'language') && !isLanguagePreference(settings.language))) {
    throw new Error('設定値が不正です。言語・テーマ・列数・表示形式・画像プレビューを確認してください。');
  }
  return { format: 'xbookmarkshelf-settings', formatVersion: 1, exportedAt: input.exportedAt,
    settings: { theme: settings.theme, columns: settings.columns, layout: settings.layout, previews: settings.previews,
      ...(Object.hasOwn(settings, 'language') ? { language: settings.language as LanguagePreference } : {}) } };
}
export async function readSettingsFile(file: Blob): Promise<SettingsBackup> {
  if (file.size > MAX_SETTINGS_FILE_BYTES) throw new Error('設定ファイルは64KBまでです。');
  let input: unknown;
  try { input = JSON.parse(await file.text()); }
  catch { throw new Error('設定JSONを読み込めません。ファイルの内容を確認してください。'); }
  return validateSettingsBackup(input);
}
export async function createSettingsBackup(store: LibraryDB = db): Promise<SettingsBackup> {
  return store.transaction('r', store.settings, async () => {
    const [theme, columns, layout, previews, language] = await store.settings.bulkGet([...SETTINGS_KEYS]);
    const settings: DisplaySettings = {
      theme: theme?.value === 'dark' ? 'dark' : 'light',
      columns: typeof columns?.value === 'number' && Number.isInteger(columns.value) && columns.value >= 1 && columns.value <= 5 ? columns.value : DEFAULT_DISPLAY_SETTINGS.columns,
      layout: layout?.value === 'list' ? 'list' : 'grid',
      previews: previews ? previews.value === true : DEFAULT_DISPLAY_SETTINGS.previews,
      language: isLanguagePreference(language?.value) ? language.value : 'system',
    };
    return { format: 'xbookmarkshelf-settings', formatVersion: 1, exportedAt: new Date().toISOString(), settings };
  });
}
export async function restoreSettingsBackup(input: unknown, store: LibraryDB = db): Promise<DisplaySettings> {
  const { settings } = validateSettingsBackup(input);
  await store.transaction('rw', store.settings, async () => {
    // Old four-key files leave the current language untouched.
    const keys = settings.language === undefined ? LEGACY_SETTINGS_KEYS : SETTINGS_KEYS;
    await store.settings.bulkPut(keys.map(key => ({ key, value: settings[key] })));
  });
  return settings;
}
