"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ClipboardPaste, Download, Film, Loader2, Music, SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import toast from "react-hot-toast";
import AllowedOptions from "@/components/AllowedOptions";
import JobCard from "@/components/JobCard";
import { api, each } from "@/lib/api-client";
import { useJobs } from "@/hooks/useJobs";
import type { Options } from "@/types/download";

const DEFAULTS: Options = {
  mode: "video",
  quality: "best",
  container: "mp4",
  audioFormat: "best",
  subtitles: false,
  subLangs: "en.*",
  embedThumbnail: true,
  embedMetadata: true,
  sponsorBlock: false,
  customArgs: "",
};
const STORAGE_KEY = "ytdlp-ui:options:v2";

const QUALITIES = ["best", "2160", "1440", "1080", "720", "480", "360"] as const;

export default function DownloadPage() {
  const t = useTranslations("Download");
  const { jobs, error, refresh } = useJobs();
  const [url, setUrl] = useState("");
  const [opts, setOpts] = useState<Options>(DEFAULTS);
  const [submitting, setSubmitting] = useState(false);

  // Remember the last used options in this browser.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setOpts({ ...DEFAULTS, ...JSON.parse(saved) });
    } catch {}
  }, []);

  function set<K extends keyof Options>(key: K, value: Options[K]) {
    const next = { ...opts, [key]: value };
    setOpts(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }

  const links = url.split(/\s+/).filter(Boolean);

  async function paste() {
    try {
      const clip = (await navigator.clipboard.readText()).trim();
      setUrl((prev) => (prev.trim() ? `${prev.trim()}\n${clip}` : clip));
    } catch {
      toast.error(t("clipboardBlocked"));
    }
  }

  /** One job per link: links can be separated by new lines or spaces. */
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const unique = [...new Set(links)];
    setSubmitting(true);
    // Invalid links are rejected by the server one by one and stay in the box.
    const { failed, firstError } = await each(unique, (url) => api("/downloads", { json: { url, options: opts } }));
    const added = unique.length - failed.length;
    if (added) toast.success(t("added", { count: added }));
    if (failed.length) toast.error(t("someFailed", { count: failed.length, error: firstError }));
    setUrl(failed.join("\n")); // keep only what failed, so it can be fixed and resent
    setSubmitting(false);
    refresh();
  }

  const recent = jobs?.slice(0, 5) ?? [];

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
          {t("titleStart")} <span className="text-gradient">{t("titleHighlight")}</span>
        </h1>
        <p className="mt-2 text-muted-foreground">
          {t.rich("subtitle", {
            link: (chunks) => (
              <a
                href="https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline underline-offset-4"
              >
                {chunks}
              </a>
            ),
          })}
        </p>

        <form onSubmit={submit} className="card mt-6 p-4 sm:p-6 space-y-5" noValidate>
          <div>
            <label htmlFor="url" className="sr-only">{t("linksLabel")}</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <textarea
                  id="url"
                  rows={Math.min(Math.max(url.split("\n").length, 1), 8)}
                  className="input h-auto min-h-12 py-3 pr-12 resize-none leading-6"
                  placeholder={t("linksPlaceholder")}
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter downloads, Shift+Enter adds a line
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                <button type="button" onClick={paste} className="btn-icon absolute right-1.5 top-1.5" aria-label={t("pasteLabel")} title={t("paste")}>
                  <ClipboardPaste />
                </button>
              </div>
              <button type="submit" className="btn btn-primary h-12 px-6 sm:self-start" disabled={submitting || !links.length}>
                {submitting ? <Loader2 className="animate-spin" /> : <Download />}
                {t("submit", { count: new Set(links).size })}
              </button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-[auto_1fr_1fr] sm:items-end">
            <fieldset>
              <legend className="label">{t("type")}</legend>
              <div className="inline-flex rounded-lg border border-border bg-muted/50 p-1">
                {([["video", "video", Film], ["audio", "audioOnly", Music]] as const).map(([value, label, Icon]) => (
                  <label
                    key={value}
                    className={`btn h-8 px-3 cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/40 ${opts.mode === value ? "bg-card text-foreground shadow-sm" : "btn-ghost"}`}
                  >
                    <input type="radio" name="mode" value={value} checked={opts.mode === value} onChange={() => set("mode", value)} className="sr-only" />
                    <Icon /> {t(label)}
                  </label>
                ))}
              </div>
            </fieldset>

            {opts.mode === "video" ? (
              <>
                <div>
                  <label htmlFor="quality" className="label">{t("quality")}</label>
                  <select id="quality" className="input" value={opts.quality} onChange={(e) => set("quality", e.target.value as Options["quality"])}>
                    {QUALITIES.map((v) => (
                      <option key={v} value={v}>
                        {v === "best" ? t("qualityBest") : v === "2160" ? t("quality2160") : `${v}p`}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="container" className="label">{t("format")}</label>
                  <select id="container" className="input" value={opts.container} onChange={(e) => set("container", e.target.value as Options["container"])}>
                    <option value="mp4">{t("mp4")}</option>
                    <option value="mkv">MKV</option>
                    <option value="webm">WebM</option>
                  </select>
                </div>
              </>
            ) : (
              <div className="sm:col-span-2">
                <label htmlFor="audioFormat" className="label">{t("audioFormat")}</label>
                <select id="audioFormat" className="input" value={opts.audioFormat} onChange={(e) => set("audioFormat", e.target.value as Options["audioFormat"])}>
                  <option value="best">{t("audioBest")}</option>
                  <option value="mp3">{t("mp3")}</option>
                  <option value="m4a">M4A (AAC)</option>
                  <option value="opus">Opus</option>
                  <option value="flac">FLAC</option>
                  <option value="wav">WAV</option>
                </select>
              </div>
            )}
          </div>

          <details className="group" open={!!opts.customArgs || undefined}>
            <summary className="inline-flex items-center gap-2 cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground select-none">
              <SlidersHorizontal className="w-4 h-4" /> {t("moreOptions")}
            </summary>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Check label={t("embedThumbnail")} hint={t("embedThumbnailHint")} checked={opts.embedThumbnail} onChange={(v) => set("embedThumbnail", v)} />
              <Check label={t("embedMetadata")} hint={t("embedMetadataHint")} checked={opts.embedMetadata} onChange={(v) => set("embedMetadata", v)} />
              <Check label={t("sponsorBlock")} hint={t("sponsorBlockHint")} checked={opts.sponsorBlock} onChange={(v) => set("sponsorBlock", v)} />
              {opts.mode === "video" && (
                <div>
                  <Check label={t("subtitles")} hint={t("subtitlesHint")} checked={opts.subtitles} onChange={(v) => set("subtitles", v)} />
                  {opts.subtitles && (
                    <div className="mt-2 pl-7">
                      <label htmlFor="subLangs" className="label text-xs">{t("subLangs")}</label>
                      <input id="subLangs" className="input h-9 text-sm" value={opts.subLangs} onChange={(e) => set("subLangs", e.target.value)} placeholder="en.*,fr" />
                      <p className="mt-1 text-xs text-muted-foreground">{t.rich("subLangsHint", { code: (chunks) => <code>{chunks}</code> })}</p>
                    </div>
                  )}
                </div>
              )}
              <div className="sm:col-span-2">
                <label htmlFor="customArgs" className="label">{t("customArgs")}</label>
                <input
                  id="customArgs"
                  className="input font-mono text-sm"
                  value={opts.customArgs ?? ""}
                  onChange={(e) => set("customArgs", e.target.value)}
                  placeholder='--limit-rate 2M --download-sections "*0:30-1:30"'
                  autoComplete="off"
                  spellCheck={false}
                />
                <p className="mt-1 mb-2 text-xs text-muted-foreground">
                  {t("customArgsHint")}
                </p>
                <AllowedOptions />
              </div>
            </div>
          </details>
        </form>
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">{t("recent")}</h2>
          {jobs && jobs.length > recent.length && (
            <Link href="/history/" className="text-sm text-primary hover:underline underline-offset-4 inline-flex items-center gap-1">
              {t("viewAll")} <ArrowRight className="w-4 h-4" />
            </Link>
          )}
        </div>
        {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
        {jobs === null && !error ? (
          <div className="space-y-3">
            {[0, 1].map((i) => <div key={i} className="card h-28 animate-pulse bg-muted/40" />)}
          </div>
        ) : recent.length === 0 ? (
          <p className="card p-8 text-center text-muted-foreground text-sm">{t("empty")}</p>
        ) : (
          <div className="space-y-3">
            {recent.map((j) => <JobCard key={j.id} job={j} onChange={refresh} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function Check({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex gap-3 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 w-4 h-4 accent-[hsl(var(--primary))]" />
      <span className="text-sm">
        <span className="font-medium">{label}</span>
        <span className="block text-muted-foreground text-xs">{hint}</span>
      </span>
    </label>
  );
}
