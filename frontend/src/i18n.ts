import { createTranslator } from "next-intl";
import enUS from "../messages/en-US.json";
import frFR from "../messages/fr-FR.json";

// Same locales and detection as eylexander.fr: the `locale` cookie, else French when the
// browser asks for it, else English. Resolved in the browser because this site is a static
// export (no request-time server to read cookies/headers).
export const locales = ["en-US", "fr-FR"] as const;
export type Locale = (typeof locales)[number];

export const messages: Record<Locale, typeof enUS> = { "en-US": enUS, "fr-FR": frFR };

export function detectLocale(): Locale {
  const cookie = document.cookie.match(/(?:^|;\s*)locale=([^;]+)/)?.[1];
  if (locales.includes(cookie as Locale)) return cookie as Locale;
  return navigator.languages.some((l) => l.toLowerCase().startsWith("fr")) ? "fr-FR" : "en-US";
}

export function saveLocale(locale: Locale) {
  document.cookie = `locale=${locale}; path=/; max-age=31536000; SameSite=Lax`;
}

// For code outside React (lib/api-client.ts). Kept in sync by IntlProvider.
let current: Locale = "en-US";
export const setCurrentLocale = (locale: Locale) => {
  current = locale;
};
export const getCurrentLocale = () => current;
export const getTranslator = () => createTranslator({ locale: current, messages: messages[current] });

/**
 * Translates a code sent by the server (ApiErrors) or stored on a job (JobErrors).
 * Unknown codes, and old jobs that stored an English sentence, fall back to `fallback`.
 */
export function translateCode(
  ns: "ApiErrors" | "JobErrors",
  code: string | undefined,
  fallback: string,
  params?: Record<string, string | number>,
) {
  // Dynamic keys can't be checked against the typed messages, hence the loose signature.
  const t = getTranslator() as unknown as { has(key: string): boolean; (key: string, values?: object): string };
  return code && t.has(`${ns}.${code}`) ? t(`${ns}.${code}`, params) : fallback;
}

// Type-checks every t("...") key against the English messages.
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof enUS;
  }
}
