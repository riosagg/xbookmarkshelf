import { createContext, type ComponentChildren } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import { liveQuery } from 'dexie';
import { db } from './db';
import { browserUILanguage, isLanguagePreference, resolveLanguage, translate, translateUIMessage, type Language, type LanguagePreference, type MessageKey, type Parameters, type UIMessage } from './messages';

function initialPreference(): LanguagePreference {
  const value = document.documentElement.dataset.languagePreference;
  return isLanguagePreference(value) ? value : 'system';
}
export function applyLanguage(preference: LanguagePreference, language: Language) {
  document.documentElement.lang = language;
  document.documentElement.dataset.languagePreference = preference;
  try { localStorage.setItem('xbookmarkshelf.language', preference); } catch { /* Optional display cache. */ }
}
const LanguageContext = createContext<{ language: Language; preference: LanguagePreference }>({ language: 'en', preference: 'system' });
export function LanguageProvider({ children }: { children: ComponentChildren }) {
  const [preference, setPreference] = useState<LanguagePreference>(initialPreference);
  const [browserLocale, setBrowserLocale] = useState(browserUILanguage);
  const language = resolveLanguage(preference, browserLocale);
  useEffect(() => {
    const subscription = liveQuery(() => db.settings.get('language')).subscribe({
      next: setting => setPreference(isLanguagePreference(setting?.value) ? setting.value : 'system'),
      error: () => { /* Keep the cached language; language loading must not stop the app. */ },
    });
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    const update = () => setBrowserLocale(browserUILanguage());
    window.addEventListener('languagechange', update);
    return () => window.removeEventListener('languagechange', update);
  }, []);
  useEffect(() => { applyLanguage(preference, language); }, [preference, language]);
  return <LanguageContext.Provider value={{ language, preference }}>{children}</LanguageContext.Provider>;
}
export function useI18n() {
  const { language, preference } = useContext(LanguageContext);
  return {
    language, preference,
    t: (key: MessageKey, params?: Parameters) => translate(language, key, params),
    message: (value: UIMessage) => translateUIMessage(language, value),
  };
}
