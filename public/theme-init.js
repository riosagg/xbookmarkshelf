// Runs before the application and styles. Only theme and language are cached.
(() => {
  let theme = 'light';
  let preference = 'system';
  try {
    if (localStorage.getItem('xbookmarkshelf.theme') === 'dark') theme = 'dark';
    const cached = localStorage.getItem('xbookmarkshelf.language');
    if (cached === 'ja' || cached === 'en') preference = cached;
  } catch { /* IndexedDB remains the source of truth if the cache is unavailable. */ }
  let browserLocale = navigator.language;
  try { browserLocale = (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage?.()) || browserLocale; }
  catch { /* Browser API is optional outside extension pages. */ }
  const language = preference === 'system' ? (/^ja(?:[-_]|$)/i.test(browserLocale) ? 'ja' : 'en') : preference;
  const root = document.documentElement;
  root.lang = language;
  root.dataset.languagePreference = preference;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  root.style.backgroundColor = theme === 'dark' ? '#101318' : '#f3f6f8';
})();
