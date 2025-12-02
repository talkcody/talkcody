// src/hooks/use-locale.ts
import { useCallback, useMemo } from 'react';
import {
  detectBrowserLanguage,
  getLocale,
  getSupportedLocales,
  isValidLocale,
  type LocaleDefinition,
  type SupportedLocale,
} from '@/locales';
import { useSettingsStore } from '@/stores/settings-store';

interface UseLocaleReturn {
  locale: SupportedLocale;
  t: LocaleDefinition;
  setLocale: (locale: SupportedLocale) => Promise<void>;
  supportedLocales: Array<{ code: SupportedLocale; name: string }>;
}

export function useLocale(): UseLocaleReturn {
  const language = useSettingsStore((state) => state.language);
  const setLanguage = useSettingsStore((state) => state.setLanguage);

  const locale = useMemo((): SupportedLocale => {
    if (language && isValidLocale(language)) {
      return language;
    }
    return detectBrowserLanguage();
  }, [language]);

  const t = useMemo(() => {
    return getLocale(locale);
  }, [locale]);

  const setLocale = useCallback(
    async (newLocale: SupportedLocale) => {
      await setLanguage(newLocale);
    },
    [setLanguage]
  );

  const supportedLocales = useMemo(() => getSupportedLocales(), []);

  return {
    locale,
    t,
    setLocale,
    supportedLocales,
  };
}

export function useTranslation(): LocaleDefinition {
  const { t } = useLocale();
  return t;
}
