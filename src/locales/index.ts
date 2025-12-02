// src/locales/index.ts
export { default as en } from './en';
export type { LocaleDefinition, LocaleMap, SupportedLocale } from './types';
export {
  DEFAULT_LOCALE,
  detectBrowserLanguage,
  fallbackLocale,
  getLocale,
  getSupportedLocales,
  isValidLocale,
} from './utils';
export { default as zh } from './zh';
