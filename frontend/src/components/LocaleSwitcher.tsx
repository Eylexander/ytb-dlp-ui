"use client";

import { useLocale, useTranslations } from "next-intl";
import { useSetLocale } from "@/providers/IntlProvider";
import { locales } from "@/i18n";

const labels = { "en-US": "EN", "fr-FR": "FR" } as const;

// Same pill as the eylexander.fr switcher (minus the framer-motion slide). Only on the login
// page: once signed in, the language is changed in Settings.
export default function LocaleSwitcher() {
  const locale = useLocale();
  const setLocale = useSetLocale();
  const t = useTranslations("Navigation");

  return (
    <div role="group" aria-label={t("language")} className="flex items-center bg-background/50 border border-border/60 rounded-full p-0.5 gap-0.5 shadow-sm">
      {locales.map((l) => (
        <button
          key={l}
          onClick={() => setLocale(l)}
          aria-pressed={locale === l}
          lang={l}
          className={`px-2.5 py-1 text-xs font-bold tracking-wider rounded-full transition-colors duration-200 ${
            locale === l ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {labels[l]}
        </button>
      ))}
    </div>
  );
}
