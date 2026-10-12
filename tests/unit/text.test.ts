import { expect, it } from 'vitest';
import { webUrl, textLinks, appendMissingLinks, parseTagNames, formatTagNames } from '../../src/text';

it('links only HTTP(S) URLs and preserves punctuation and balanced path parentheses', () => {
  const text = '資料 https://example.invalid/a_(b)?q=1。次は (https://example.invalid/two).';
  expect(textLinks(text).map(link => link.label)).toEqual(['https://example.invalid/a_(b)?q=1', 'https://example.invalid/two']);
  for (const bad of ['javascript:alert(1)', 'data:text/html,test', 'file:///tmp/test', 'https://user:password@example.invalid/', 'https://example.invalid/\npath', 'https://example.invalid/' + 'a'.repeat(2048)]) expect(webUrl(bad)).toBeNull();
  expect(textLinks('javascript:alert(1) https://user:password@example.invalid')).toHaveLength(0);
});
it('adds missing links once without exceeding the post text bound', () => {
  expect(appendMissingLinks('本文\nhttps://example.invalid/a', ['https://example.invalid/a', 'https://example.invalid/b', 'javascript:alert(1)'])).toBe('本文\nhttps://example.invalid/a\nhttps://example.invalid/b');
  expect(appendMissingLinks('a'.repeat(49999), ['https://example.invalid/a'])).toHaveLength(49999);
});
it.each([')', ']', '}'])('processes a maximum-length unmatched %s suffix within a generous time budget', close => {
  const label = 'https://example.invalid/';
  const prefix = '資料🦉 ';
  const input = prefix + label + close.repeat(50000 - prefix.length - label.length);
  const start = performance.now();
  const links = textLinks(input);
  const elapsed = performance.now() - start;
  expect(links).toEqual([{ start: prefix.length, end: prefix.length + label.length, label, url: label }]);
  expect(elapsed).toBeLessThan(1000);
});
it('preserves bracket grammar, encoded brackets, Unicode offsets and canonical URL limits', () => {
  const labels = ['https://example.invalid/a_(b)?q=[c]{d}', 'https://example.invalid/%28x%29', 'https://example.invalid/日本語'];
  for (const label of labels) {
    const input = `🦉 (${label}).`;
    expect(textLinks(input)).toEqual([{ start: 4, end: 4 + label.length, label, url: new URL(label).href }]);
  }
  expect(textLinks('https://example.invalid/a)))]]]')[0]?.label).toBe('https://example.invalid/a)))');
  const base = 'https://example.invalid/';
  const start = performance.now();
  expect(textLinks(base + '.'.repeat(49000) + ')')).toHaveLength(0);
  expect(performance.now() - start).toBeLessThan(1000);
  expect(textLinks(base + 'a'.repeat(2048 - base.length))).toHaveLength(1);
  expect(textLinks(base + 'a'.repeat(2049 - base.length))).toHaveLength(0);
  expect(textLinks(base + 'あ'.repeat(300))).toHaveLength(0);
});
it('round-trips existing tag names containing commas and quotes without splitting them', () => {
  const names = ['読書', 'Design, UI', 'say "hello"'];
  expect(parseTagNames(formatTagNames(names))).toEqual(names);
  expect(parseTagNames(' 読書, 開発, 読書, ')).toEqual(['読書', '開発']);
});
