import { expect, it } from 'vitest';
import { normalizeNumberText, parseNumberText } from '../../src/numeric-input';

it('normalizes full-width digits and decimal signs without dropping other characters', () => {
  expect(normalizeNumberText('０１２３４５６７８９')).toBe('0123456789');
  expect(normalizeNumberText('＋３．５')).toBe('+3.5');
  expect(normalizeNumberText('－１２')).toBe('-12');
  expect(normalizeNumberText('１０件')).toBe('10件');
});
it('parses normalized decimal numbers while preserving values for existing range validation', () => {
  for (const [text, value] of [['１０００', 1000], ['３．５', 3.5], [' １０ ', 10], ['－１', -1], ['３１', 31], ['.5', 0.5], ['3.', 3], ['１e２', 100]] as const) expect(parseNumberText(text)).toBe(value);
});
it('keeps blanks, malformed text, unsupported number syntax and nonfinite values invalid', () => {
  for (const text of ['', ' ', '　', '.', '-', '１０件', '１，０００', '1e', '0x64', 'Infinity', 'NaN', '3..5', '9'.repeat(400)]) expect(parseNumberText(text)).toBeNaN();
});
