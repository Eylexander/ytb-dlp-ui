"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import { detectLocale, messages, saveLocale, setCurrentLocale, type Locale } from "@/i18n";

const SetLocaleContext = createContext<(locale: Locale) => void>(() => {});
export const useSetLocale = () => useContext(SetLocaleContext);

const timeZone = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";

export function IntlProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale | null>(null);

  useEffect(() => {
    const detected = detectLocale();
    setCurrentLocale(detected);
    setLocale(detected);
  }, []);

  useEffect(() => {
    if (locale) document.documentElement.lang = locale;
  }, [locale]);

  // The language is only known in the browser; rendering before would flash English.
  if (!locale) return null;

  const change = (next: Locale) => {
    saveLocale(next);
    setCurrentLocale(next);
    setLocale(next);
  };

  return (
    <SetLocaleContext.Provider value={change}>
      <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone={timeZone}>
        {children}
      </NextIntlClientProvider>
    </SetLocaleContext.Provider>
  );
}
