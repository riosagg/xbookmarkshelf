import { expect, it, vi } from 'vitest';
import { browserUILanguage, dateLocale, english, isLanguage, isLanguagePreference, resolveLanguage, translate, translateUIMessage } from '../../src/messages';
import { REASON_LABELS } from '../../src/model';

it('uses the same interpolation fields in both languages and keeps user values literal', () => {
  for (const [key, value] of Object.entries(english)) {
    expect(value.trim()).not.toBe('');
    expect((value.match(/\{\w+\}/g) ?? []).sort()).toEqual((key.match(/\{\w+\}/g) ?? []).sort());
  }
  const name = '<script>alert(1)</script>日本語 {count}';
  expect(translate('en', '{name}のマーク', { name })).toBe(`Mark ${name}`);
  expect(translate('ja', '{name}のマーク', { name })).toBe(`${name}のマーク`);
  expect(translate('en', '{start}–{end} / {total}件', { start: 1, end: 50, total: 105 })).toBe('1–50 / 105 posts');
});
it('localizes persisted stop reasons and existing notices without changing their stored values', () => {
  for (const value of Object.values(REASON_LABELS)) {
    expect(translateUIMessage('ja', value)).toBe(value);
    expect(translateUIMessage('en', value)).toBe(english[value]);
  }
  expect(translateUIMessage('en', { key: '{count}件をJSONに書き出しました', params: { count: 105 } })).toBe('Exported 105 posts as JSON');
  expect(translateUIMessage('en', 'unrecognized database error')).toBe(english['処理に失敗しました']);
  expect(translateUIMessage('ja', 'unknown')).toBe('unknown');
  expect(translateUIMessage('en', '')).toBe('');
});
it('accepts only the supported language codes and chooses the matching date locale', () => {
  expect(isLanguage('ja')).toBe(true); expect(isLanguage('en')).toBe(true);
  for (const value of ['en-US', 'ja-JP', 'fr', null, undefined, {}, 1]) expect(isLanguage(value)).toBe(false);
  expect(dateLocale('ja')).toBe('ja-JP'); expect(dateLocale('en')).toBe('en-US');
});
it('resolves system languages and preserves explicit choices', () => {
  for (const locale of ['ja', 'ja-JP', 'JA_jp']) expect(resolveLanguage('system', locale)).toBe('ja');
  for (const locale of ['en', 'en-GB', 'fr-FR', 'zh-CN', '', 'japanese', 'jajp']) expect(resolveLanguage('system', locale)).toBe('en');
  expect(resolveLanguage('ja', 'en-US')).toBe('ja');
  expect(resolveLanguage('en', 'ja-JP')).toBe('en');
  expect(isLanguagePreference('system')).toBe(true);
  expect(isLanguage('system')).toBe(false);
  for (const value of ['auto', 'ja-JP', null, undefined]) expect(isLanguagePreference(value)).toBe(false);
});
it('uses the browser UI language before the preferred content language, with an API fallback', () => {
  try {
    vi.stubGlobal('navigator', { language: 'ja-JP' });
    vi.stubGlobal('chrome', { i18n: { getUILanguage: () => 'fr-FR' } });
    expect(browserUILanguage()).toBe('fr-FR');
    vi.stubGlobal('chrome', { i18n: { getUILanguage: () => { throw new Error('synthetic-unavailable'); } } });
    expect(browserUILanguage()).toBe('ja-JP');
    vi.stubGlobal('chrome', undefined);
    expect(browserUILanguage()).toBe('ja-JP');
  } finally { vi.unstubAllGlobals(); }
});
