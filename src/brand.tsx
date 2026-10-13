import mark from '../assets/brand/mark.json';

// Original geometry drawn for xbookmarkshelf on 2026-10-13 from the user's
// request: a plain X on the left and three stacked books on the right.
// No external icon asset or font is used. Covered by the project MIT license.
export function BrandMark() {
  return <svg class="icon brand-symbol" width="25" height="25" viewBox={mark.viewBox} fill="none" stroke="currentColor" stroke-width={mark.strokeWidth} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={mark.path}/></svg>;
}
