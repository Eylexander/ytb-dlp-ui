"use client";

import { useRef, useState } from "react";
import { AudioLines, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import toast from "react-hot-toast";
import { api } from "@/lib/api-client";
import { formatBytes } from "@/lib/format";
import { BITRATES, type Job, type Options } from "@/types/download";

// Hint labels: messages "Convert.<format>"
const FORMATS = [["mp3", "MP3"], ["m4a", "M4A"], ["opus", "Opus"], ["flac", "FLAC"], ["wav", "WAV"]] as const;
type Format = (typeof FORMATS)[number][0];
type Choice = { audioFormat: Format; audioBitrate: (typeof BITRATES)[number] };
const STORAGE_KEY = "ytdlp-ui:convert:v3"; // bumped when the default changes, so it applies once

/** "Convert" action of a finished job: ffmpeg re-encodes its file to audio on the server, as a new job. */
export default function ConvertButton({ job, onChange, className }: { job: Job; onChange: () => void; className: string }) {
  const t = useTranslations("Convert");
  const dialog = useRef<HTMLDialogElement>(null);
  const [choice, setChoice] = useState<Choice>({ audioFormat: "wav", audioBitrate: "320" });
  const [busy, setBusy] = useState(false);
  const lossless = choice.audioFormat === "flac" || choice.audioFormat === "wav";
  // Opus tops out at 256 kbps; the saved choice is kept for when another format is picked.
  const bitrates: readonly Choice["audioBitrate"][] = choice.audioFormat === "opus" ? BITRATES.filter((b) => b !== "320") : BITRATES;
  const bitrate = bitrates.includes(choice.audioBitrate) ? choice.audioBitrate : "256";

  function open() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setChoice({ ...choice, ...JSON.parse(saved) });
    } catch {}
    dialog.current?.showModal();
  }

  function pick(next: Partial<Choice>) {
    const c = { ...choice, ...next };
    setChoice(c);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
    } catch {}
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const options: Partial<Options> = { mode: "audio", ...choice, audioBitrate: bitrate, convertFrom: job.id };
      await api("/downloads", { json: { url: job.url, options } });
      toast.success(t("started"));
      dialog.current?.close();
      onChange();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Lossy output size is bitrate × duration; lossless depends on the content, so no guess.
  const estimate = !lossless && job.duration ? formatBytes((Number(bitrate) * 1000 * job.duration) / 8) : null;

  return (
    <>
      <button className={className} onClick={open} title={t("title")}>
        <AudioLines /> <span className="sr-only sm:not-sr-only">{t("action")}</span>
      </button>
      <dialog
        ref={dialog}
        onClick={(e) => e.target === dialog.current && !busy && dialog.current.close()}
        className="w-[min(30rem,calc(100vw-2rem))] rounded-lg bg-card text-card-foreground p-0 shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm"
      >
        <form onSubmit={submit}>
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <AudioLines className="w-4 h-4 text-audio" />
            <h2 className="flex-1 font-semibold">{t("title")}</h2>
            <button type="button" className="btn-icon" onClick={() => dialog.current?.close()} aria-label={t("close")} title={t("close")}>
              <X />
            </button>
          </div>

          <div className="p-4 space-y-5">
            <p className="text-sm text-muted-foreground line-clamp-2 break-words">{job.title || job.file}</p>

            <fieldset>
              <legend className="label">{t("format")}</legend>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {FORMATS.map(([value, name]) => (
                  <label
                    key={value}
                    className="cursor-pointer rounded-lg border border-border px-3 py-2 transition-colors hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/40"
                  >
                    <input
                      type="radio"
                      name="audioFormat"
                      value={value}
                      checked={choice.audioFormat === value}
                      onChange={() => pick({ audioFormat: value })}
                      className="sr-only"
                    />
                    <span className="block text-sm font-medium">{name}</span>
                    <span className="block text-xs text-muted-foreground">{t(value)}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {lossless ? (
              <p className="text-sm text-muted-foreground">{t("lossless")}</p>
            ) : (
              <fieldset>
                <legend className="label">{t("bitrate")}</legend>
                <div className="flex rounded-lg border border-border bg-muted/50 p-1">
                  {bitrates.map((b) => (
                    <label
                      key={b}
                      className={`btn h-8 flex-1 px-0 tabular-nums cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/40 ${
                        bitrate === b ? "bg-card text-foreground shadow-sm" : "btn-ghost"
                      }`}
                    >
                      <input type="radio" name="audioBitrate" value={b} checked={bitrate === b} onChange={() => pick({ audioBitrate: b })} className="sr-only" />
                      {b}
                    </label>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">{t("bitrateHint")}</p>
              </fieldset>
            )}

            <p className="text-xs text-muted-foreground">
              {estimate && <>{t("estimate", { size: estimate })} · </>}
              {t("keepsOriginal")}
            </p>
          </div>

          <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
            <button type="button" className="btn btn-ghost" onClick={() => dialog.current?.close()} disabled={busy}>
              {t("cancel")}
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy} autoFocus>
              {busy ? <Loader2 className="animate-spin" /> : <AudioLines />}
              {t("submit")}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
