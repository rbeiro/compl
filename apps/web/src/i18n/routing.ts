import { defineRouting } from "next-intl/routing";

// Same languages as the legacy portal. Spanish is the source language.
export const languageNames = {
  es: "Español",
  it: "Italiano",
  en: "English",
  ca: "Català",
  pt: "Português",
  fr: "Français",
  ar: "العربية",
} as const;

export type Locale = keyof typeof languageNames;

export const routing = defineRouting({
  locales: Object.keys(languageNames) as Locale[],
  defaultLocale: "es",
  // "/" stays Spanish; other languages get a prefix ("/en", "/ar"...).
  localePrefix: "as-needed",
});

export const rtlLocales = new Set<Locale>(["ar"]);
