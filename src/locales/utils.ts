// src/locales/utils.ts

import en from './en';
import type { LocaleDefinition, SupportedLocale } from './types';
import zh from './zh';

const locales: Record<SupportedLocale, LocaleDefinition> = {
  en,
  zh,
};

export const DEFAULT_LOCALE: SupportedLocale = 'en';

export function detectBrowserLanguage(): SupportedLocale {
  if (typeof navigator === 'undefined') {
    return DEFAULT_LOCALE;
  }

  const browserLang = navigator.language || (navigator as { userLanguage?: string }).userLanguage;

  if (!browserLang) {
    return DEFAULT_LOCALE;
  }

  if (browserLang.startsWith('zh')) {
    return 'zh';
  }

  return 'en';
}

export function getLocale(locale: SupportedLocale): LocaleDefinition {
  return locales[locale] || locales[DEFAULT_LOCALE];
}

export function getSupportedLocales(): Array<{ code: SupportedLocale; name: string }> {
  return Object.entries(locales).map(([code, locale]) => ({
    code: code as SupportedLocale,
    name: locale.name,
  }));
}

export function isValidLocale(locale: string): locale is SupportedLocale {
  return locale === 'en' || locale === 'zh';
}

export { en as fallbackLocale };
