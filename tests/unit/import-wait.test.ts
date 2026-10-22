import { expect, it, vi } from 'vitest';
import { chooseIntervalMs, validateOptions, DEFAULT_OPTIONS, librarySourceUrl } from '../../src/model';

it('keeps legacy options as fixed and validates random endpoints without changing unrelated fields', () => {
  expect(validateOptions(DEFAULT_OPTIONS)).toEqual(DEFAULT_OPTIONS);
  for (const mode of ['visible', 'delta', 'full']) expect(validateOptions({ ...DEFAULT_OPTIONS, mode }).mode).toBe(mode);
  expect(validateOptions({ ...DEFAULT_OPTIONS, intervalMaxMs: 8000, ignored: true })).toEqual({ ...DEFAULT_OPTIONS, intervalMaxMs: 8000 });
  for (const intervalMaxMs of [null, '8000', 2999, 30001, 4000.5, NaN, Infinity]) expect(() => validateOptions({ ...DEFAULT_OPTIONS, intervalMaxMs })).toThrow();
  expect(() => validateOptions({ ...DEFAULT_OPTIONS, intervalMs: 6000, intervalMaxMs: 5000 })).toThrow();
  expect(() => validateOptions({ ...DEFAULT_OPTIONS, intervalMs: 2999, intervalMaxMs: 8000 })).toThrow();
  expect(validateOptions({ ...DEFAULT_OPTIONS, intervalMs: 30000, intervalMaxMs: 30000 }).intervalMaxMs).toBe(30000);
});
it('draws within inclusive bounds and avoids randomness for fixed/equal bounds', () => {
  const options = { ...DEFAULT_OPTIONS, intervalMaxMs: 8000 };
  expect(chooseIntervalMs(options, () => 0)).toBe(3000);
  expect(chooseIntervalMs(options, () => 0.5)).toBe(5500);
  expect(chooseIntervalMs(options, () => 1 - Number.EPSILON)).toBe(8000);
  const random = vi.fn(() => 0.9);
  expect(chooseIntervalMs(DEFAULT_OPTIONS, random)).toBe(3000);
  expect(chooseIntervalMs({ ...DEFAULT_OPTIONS, intervalMaxMs: 3000 }, random)).toBe(3000);
  expect(random).not.toHaveBeenCalled();
});
it('links to the owner’s Likes only for a validated handle and otherwise to History', () => {
  expect(librarySourceUrl('likes', 'SAMPLE')).toBe('https://x.com/sample/likes');
  for (const handle of [undefined, 'sample/../evil', 'sample?x=1', '@sample', 'x'.repeat(16)]) expect(librarySourceUrl('likes', handle)).toBe('https://x.com/i/history');
  expect(librarySourceUrl('bookmarks', 'sample')).toBe('https://x.com/i/bookmarks');
});
