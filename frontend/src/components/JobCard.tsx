"use client";

import { useRef, useState } from "react";
import {
  AlertCircle, Ban, CheckCircle2, Clock, Download, Film, Loader2, Music, Play, RotateCcw, Trash2, X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import toast from "react-hot-toast";
import ConvertButton from "@/components/ConvertButton";
import { translateCode } from "@/i18n";
import { api, fileUrl, retryJob } from "@/lib/api-client";
import { formatBytes, formatDuration } from "@/lib/format";
import { isActive, isAudioJob, type Job, type Status } from "@/types/download";

// Labels: messages "Status.<status>"
const statusStyle: Record<Status, { className: string; icon: typeof Clock }> = {
  queued: { className: "bg-muted text-muted-foreground", icon: Clock },
  running: { className: "bg-primary/10 text-primary", icon: Loader2 },
  processing: { className: "bg-primary/10 text-primary", icon: Loader2 },
  done: { className: "bg-success/10 text-success", icon: CheckCircle2 },
  failed: { className: "bg-destructive/10 text-destructive", icon: AlertCircle },
  canceled: { className: "bg-muted text-muted-foreground", icon: Ban },
};

// The type badge already says audio/video, so this only describes the format.
function optionsSummary(j: Job, t: ReturnType<typeof useTranslations<"Job">>) {
  const o = j.options;
  const format =
    o.mode === "audio"
      ? o.audioFormat === "best" ? t("bestQuality") : o.audioFormat.toUpperCase()
      : `${o.quality === "best" ? t("best") : `${o.quality}p`} · ${o.container.toUpperCase()}`;
  if (o.convertFrom) return [format, o.audioBitrate && t("kbps", { n: o.audioBitrate }), t("converted")].filter(Boolean).join(" · ");
  return o.customArgs ? `${format} · ${t("customOptions")}` : format;
}

type Props = {
  job: Job;
  onChange: () => void;
  /** Multi-select (History page): shows a checkbox when onSelect is given. */
  selected?: boolean;
  onSelect?: (shiftKey: boolean) => void;
};

export default function JobCard({ job, onChange, selected = false, onSelect }: Props) {
  const t = useTranslations("Job");
  const tStatus = useTranslations("Status");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const [playing, setPlaying] = useState(false);
  const [playError, setPlayError] = useState(false);
  const s = statusStyle[job.status];
  const isAudio = isAudioJob(job);
  const [thumbFailed, setThumbFailed] = useState(false);
  const TypeIcon = isAudio ? Music : Film;

  async function act(fn: () => Promise<unknown>, success?: string) {
    setBusy(true);
    try {
      await fn();
      if (success) toast.success(success);
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const retry = () => act(() => retryJob(job), t("restarted"));
  const cancel = () => act(() => api(`/downloads/${job.id}/cancel`, { method: "POST" }));
  const remove = () => {
    const what = job.status === "done" ? t("confirmDeleteFile") : t("confirmDeleteEntry");
    if (confirm(what)) act(() => api(`/downloads/${job.id}`, { method: "DELETE" }), t("deleted"));
  };

  function openPlayer() {
    setPlayError(false);
    setPlaying(true);
    dialog.current?.showModal();
  }

  function closePlayer() {
    setPlaying(false); // unmounts the <video>, which stops playback
    dialog.current?.close();
  }

  return (
    <article
      className={`card border-l-4 p-3 sm:p-4 flex gap-3 sm:gap-4 animate-fade-in transition-colors ${isAudio ? "border-l-audio" : "border-l-video"} ${
        selected ? "bg-primary/5 ring-2 ring-primary/40" : ""
      }`}
    >
      {onSelect && (
        <input
          type="checkbox"
          checked={selected}
          // React fires checkbox onChange from the click event, so shiftKey is available
          onChange={(e) => onSelect((e.nativeEvent as MouseEvent).shiftKey)}
          aria-label={t("select", { title: job.title || job.url })}
          className="mt-1 w-4 h-4 shrink-0 cursor-pointer accent-[hsl(var(--primary))]"
        />
      )}
      <button
        className="relative shrink-0 self-start w-24 sm:w-40 aspect-video rounded-md overflow-hidden bg-muted grid place-items-center group disabled:cursor-default"
        onClick={openPlayer}
        disabled={job.status !== "done"}
        aria-label={job.status === "done" ? t("playTitle", { title: job.title ?? job.url }) : undefined}
        tabIndex={job.status === "done" ? 0 : -1}
      >
        {job.thumbnail && !thumbFailed ? (
          // Served (and cached) by our backend, not the original site
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/downloads/${job.id}/thumbnail`}
            alt=""
            referrerPolicy="no-referrer"
            loading="lazy"
            onError={() => setThumbFailed(true)}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <TypeIcon className="w-6 h-6 text-muted-foreground" />
        )}
        <span
          className={`absolute top-1 left-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold text-white shadow ${isAudio ? "bg-audio" : "bg-video"}`}
        >
          <TypeIcon className="w-3 h-3" strokeWidth={2.5} />
          {isAudio ? t("audio") : t("video")}
        </span>
        {job.status === "done" && (
          <span className="absolute inset-0 grid place-items-center bg-black/0 group-hover:bg-black/40 transition-colors">
            <Play className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" fill="currentColor" />
          </span>
        )}
        {job.duration ? (
          <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 text-[11px] font-medium text-white">
            {formatDuration(job.duration)}
          </span>
        ) : null}
      </button>

      <div className="min-w-0 flex-1 flex flex-col gap-1.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold leading-snug line-clamp-2 break-words">{job.title || job.url}</h3>
            <p className="text-xs text-muted-foreground truncate">
              {[job.uploader, optionsSummary(job, t), formatBytes(job.size), new Date(job.createdAt).toLocaleString(locale)]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <span title={tStatus(job.status)} className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 sm:px-2 py-0.5 text-xs font-medium ${s.className}`}>
            <s.icon className={`w-3.5 h-3.5 ${job.status === "running" || job.status === "processing" ? "animate-spin" : ""}`} />
            {/* icon-only on phones so the title keeps its width */}
            <span className="sr-only sm:not-sr-only">{tStatus(job.status)}</span>
          </span>
        </div>

        {isActive(job) && (
          <div>
            <div
              className="h-2 rounded-full bg-muted overflow-hidden"
              role="progressbar"
              aria-valuenow={Math.round(job.progress)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              {job.status === "running" ? (
                <div className="h-full bg-primary transition-[width] duration-500" style={{ width: `${job.progress}%` }} />
              ) : (
                <div className="h-full w-full animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-muted via-primary/40 to-muted" />
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground tabular-nums">
              {job.status === "queued" && t("waiting")}
              {job.status === "processing" && t("processing")}
              {job.status === "running" &&
                [
                  `${job.progress.toFixed(1)}%`,
                  job.speed && `${formatBytes(job.speed)}/s`,
                  job.eta && t("left", { time: formatDuration(job.eta) }),
                ]
                  .filter(Boolean)
                  .join(" · ")}
            </p>
          </div>
        )}

        {job.status === "failed" && (
          <div className="text-sm text-destructive">
            <p>{translateCode("JobErrors", job.error, job.error ?? "")}</p>
            {job.errorDetail && (
              <details className="mt-1 text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">{t("details")}</summary>
                <pre className="mt-1 whitespace-pre-wrap break-all rounded-md bg-muted p-2 text-muted-foreground font-mono">
                  {job.errorDetail}
                </pre>
              </details>
            )}
          </div>
        )}

        <div className="mt-auto flex flex-wrap gap-1 -ml-2">
          {job.status === "done" && (
            <>
              <button className="btn btn-ghost h-8 px-2" onClick={openPlayer} title={t("play")}>
                <Play /> <ActionLabel>{t("play")}</ActionLabel>
              </button>
              <a className="btn btn-ghost h-8 px-2" href={fileUrl(job, true)} download title={t("saveTitle")}>
                <Download /> <ActionLabel>{t("save")}</ActionLabel>
              </a>
              <ConvertButton job={job} onChange={onChange} className="btn btn-ghost h-8 px-2" />
            </>
          )}
          {isActive(job) && (
            <button className="btn btn-ghost h-8 px-2" onClick={cancel} disabled={busy} title={t("cancel")}>
              <X /> <ActionLabel>{t("cancel")}</ActionLabel>
            </button>
          )}
          {(job.status === "failed" || job.status === "canceled") && (
            <button className="btn btn-ghost h-8 px-2" onClick={retry} disabled={busy} title={t("retry")}>
              <RotateCcw /> <ActionLabel>{t("retry")}</ActionLabel>
            </button>
          )}
          <button className="btn btn-ghost h-8 px-2 hover:text-destructive" onClick={remove} disabled={busy} title={t("delete")}>
            <Trash2 /> <ActionLabel>{t("delete")}</ActionLabel>
          </button>
        </div>
      </div>

      <dialog
        ref={dialog}
        onClose={() => setPlaying(false)}
        onClick={(e) => e.target === dialog.current && closePlayer()}
        className="w-[min(64rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] rounded-lg bg-card text-card-foreground p-0 shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm"
      >
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
          <h2 className="flex-1 truncate font-semibold text-sm">{job.title || job.file}</h2>
          <a className="btn-icon" href={fileUrl(job, true)} download aria-label={t("saveTitle")} title={t("saveTitle")}>
            <Download />
          </a>
          <button className="btn-icon" onClick={closePlayer} aria-label={t("closePlayer")} title={t("closePlayer")}>
            <X />
          </button>
        </div>
        {playing &&
          (playError ? (
            <div className="p-8 text-center text-sm">
              <AlertCircle className="w-8 h-8 mx-auto text-destructive mb-2" />
              <p>{t("cantPlay", { ext: job.file?.split(".").pop() ?? "none" })}</p>
              <p className="text-muted-foreground mt-1">
                {t("cantPlayHint")}
              </p>
            </div>
          ) : isAudio ? (
            <div className="p-6">
              <audio controls autoPlay src={fileUrl(job)} onError={() => setPlayError(true)} className="w-full" />
            </div>
          ) : (
            <video
              controls
              autoPlay
              src={fileUrl(job)}
              onError={() => setPlayError(true)}
              className="w-full max-h-[calc(100vh-6rem)] bg-black"
            />
          ))}
      </dialog>
    </article>
  );
}

/** Action label: visible from sm up; on phones the button is icon-only but keeps its accessible name. */
function ActionLabel({ children }: { children: React.ReactNode }) {
  return <span className="sr-only sm:not-sr-only">{children}</span>;
}
