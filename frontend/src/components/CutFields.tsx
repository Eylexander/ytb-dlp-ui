"use client";

import { useId } from "react";
import { Scissors } from "lucide-react";
import { useTranslations } from "next-intl";
import { parseTime } from "@/lib/format";

export type Cut = { start: string; end: string };
export const NO_CUT: Cut = { start: "", end: "" };

/** Seconds for Options.start/end, or null if a time is malformed or the end isn't after the start. */
export function parseCut(c: Cut): { start?: number; end?: number } | null {
  const start = parseTime(c.start);
  const end = parseTime(c.end);
  if (Number.isNaN(start) || Number.isNaN(end) || (end !== undefined && end <= (start ?? 0))) return null;
  return { start: start || undefined, end };
}

/** Start/End inputs: the server keeps only that part of the media. */
export default function CutFields({ value, onChange }: { value: Cut; onChange: (c: Cut) => void }) {
  const t = useTranslations("Cut");
  const id = useId();
  return (
    <fieldset>
      <legend className="label inline-flex items-center gap-1.5">
        <Scissors className="w-3.5 h-3.5" /> {t("legend")}
      </legend>
      <div className="grid grid-cols-2 gap-2">
        {(["start", "end"] as const).map((k) => (
          <div key={k}>
            <label htmlFor={id + k} className="block mb-1 text-xs text-muted-foreground">{t(k)}</label>
            <input
              id={id + k}
              className="input h-9 text-sm font-mono tabular-nums"
              value={value[k]}
              onChange={(e) => onChange({ ...value, [k]: e.target.value })}
              placeholder={k === "start" ? "0:00" : "1:30"}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">{t("hint")}</p>
    </fieldset>
  );
}
