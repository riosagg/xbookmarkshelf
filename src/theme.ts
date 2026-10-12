export type Theme = 'light' | 'dark';
export function initialTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  root.style.backgroundColor = theme === 'dark' ? '#101318' : '#f3f6f8';
  try { localStorage.setItem('xbookmarkshelf.theme', theme); } catch { /* Optional first-paint cache. */ }
}
