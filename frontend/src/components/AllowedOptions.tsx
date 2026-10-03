"use client";

import { useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api-client";
import type { Health } from "@/types/download";

/** Collapsible list of the custom yt-dlp options the server accepts. Fetched on first open unless given. */
export default function AllowedOptions({ args }: { args?: string[] }) {
  const t = useTranslations("AllowedOptions");
  const tCommon = useTranslations("Common");
  const [fetched, setFetched] = useState<string[] | null>(null);
  const list = args ?? fetched;

  function onToggle(e: React.SyntheticEvent<HTMLDetailsElement>) {
    if (e.currentTarget.open && !args && !fetched) {
      api<Health>("/health").then((h) => setFetched(h.allowedArgs), () => setFetched([]));
    }
  }

  return (
    <details className="group" onToggle={onToggle}>
      <summary className="inline-flex items-center gap-1 cursor-pointer text-xs font-medium text-primary select-none list-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="w-3.5 h-3.5 transition-transform group-open:rotate-90" />
        {t("toggle")}
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">
        {t.rich("explanation", {
          link: (chunks) => (
            <a href="https://github.com/yt-dlp/yt-dlp#usage-and-options" target="_blank" rel="noreferrer" className="text-primary hover:underline underline-offset-4">
              {chunks}
            </a>
          ),
        })}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {list === null ? (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" aria-label={tCommon("loading")} />
        ) : (
          list.map((a) => <code key={a} className="rounded bg-muted px-1.5 py-0.5 text-xs">{a}</code>)
        )}
      </div>
    </details>
  );
}
