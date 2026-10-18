"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Loader2, Pause, Play, Repeat, Scissors, X } from "lucide-react";
import { useTranslations } from "next-intl";
import toast from "react-hot-toast";
import { api, fileUrl } from "@/lib/api-client";
import { formatTimestamp, parseTime } from "@/lib/format";
import { isAudioJob, type Job, type Options } from "@/types/download";

const AUDIO = [["mp3", "MP3"], ["m4a", "M4A"], ["opus", "Opus"], ["flac", "FLAC"], ["wav", "WAV"]] as const;
type Output = "video" | (typeof AUDIO)[number][0];
const MIN = 0.1; // shortest clip, in seconds
const STEPS = [-1, -0.1, 0.1, 1] as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const round = (v: number) => Math.round(v * 100) / 100; // what the time fields can show

/** "Cut" action of a finished job: pick a range on a timeline, ffmpeg re-encodes it on the server as a new job. */
export default function CutButton({ job, onChange, className }: { job: Job; onChange: () => void; className: string }) {
  const t = useTranslations("Cutter");
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  function close() {
    setOpen(false); // unmounts the media element, which stops playback
    dialog.current?.close();
  }

  return (
    <>
      <button
        className={className}
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
        }}
        title={t("title")}
      >
        <Scissors /> <span className="sr-only sm:not-sr-only">{t("action")}</span>
      </button>
      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === dialog.current && close()}
        className="w-[min(56rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] rounded-lg bg-card text-card-foreground p-0 shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm"
      >
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
          <Scissors className="w-4 h-4 text-primary" />
          <h2 className="flex-1 truncate font-semibold text-sm">
            {t("title")} · <span className="font-normal text-muted-foreground">{job.title || job.file}</span>
          </h2>
          <button type="button" className="btn-icon" onClick={close} aria-label={t("close")} title={t("close")}>
            <X />
          </button>
        </div>
        {open && <Cutter job={job} onDone={() => (close(), onChange())} onCancel={close} />}
      </dialog>
    </>
  );
}

function Cutter({ job, onDone, onCancel }: { job: Job; onDone: () => void; onCancel: () => void }) {
  const t = useTranslations("Cutter");
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const drag = useRef<"start" | "end" | "seek" | null>(null);
  const stopAt = useRef<number | null>(null); // "Play selection" pauses here

  const isAudio = isAudioJob(job);
  const ext = job.file?.split(".").pop()?.toLowerCase();
  const container = ext === "mkv" ? "mkv" : "mp4";
  const [output, setOutput] = useState<Output>(isAudio ? (AUDIO.find(([f]) => f === ext)?.[0] ?? "mp3") : "video");
  const [dur, setDur] = useState(job.duration ?? 0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(job.duration ?? 0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playError, setPlayError] = useState(false);
  const [busy, setBusy] = useState(false);

  const moveStart = (v: number) => {
    const s = clamp(round(v), 0, Math.max(0, end - MIN));
    setStart(s);
    return s;
  };
  const moveEnd = (v: number) => {
    const e = clamp(round(v), Math.min(dur, start + MIN), dur);
    setEnd(e);
    return e;
  };
  function seek(v: number) {
    const s = clamp(v, 0, dur);
    if (media.current) media.current.currentTime = s;
    setTime(s);
    return s;
  }
  function toggle() {
    const m = media.current;
    if (!m) return;
    stopAt.current = null;
    if (m.paused) m.play().catch(() => {});
    else m.pause();
  }
  function preview() {
    const m = media.current;
    if (!m) return;
    seek(start);
    stopAt.current = end;
    m.play().catch(() => {});
  }

  // Follow the playhead every frame while playing (timeupdate only fires ~4 times a second),
  // which also lets "Play selection" stop right on the end mark.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const m = media.current;
      if (!m) return;
      if (stopAt.current !== null && m.currentTime >= stopAt.current) {
        m.pause();
        m.currentTime = stopAt.current;
        stopAt.current = null;
      }
      setTime(m.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  function onKeyDown(e: React.KeyboardEvent) {
    const el = e.target as HTMLElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || e.ctrlKey || e.metaKey || e.altKey) return;
    const step = e.shiftKey ? 1 : 0.1;
    const key = e.key.toLowerCase();
    if (key === " " && !(el instanceof HTMLButtonElement)) toggle();
    else if (key === "arrowleft") seek(time - step);
    else if (key === "arrowright") seek(time + step);
    else if (key === "i") moveStart(time);
    else if (key === "o") moveEnd(time);
    else return;
    e.preventDefault();
  }

  // Timeline: drag a handle to move it (the video shows that frame), anywhere else to scrub.
  function pointerTime(x: number) {
    const r = bar.current!.getBoundingClientRect();
    return clamp((x - r.left) / r.width, 0, 1) * dur;
  }
  function onPointer(e: React.PointerEvent) {
    if (e.type === "pointerdown") {
      const handle = (e.target as HTMLElement).closest<HTMLElement>("[data-handle]")?.dataset.handle;
      drag.current = handle === "start" || handle === "end" ? handle : "seek";
      stopAt.current = null;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (!drag.current) return;
    const v = pointerTime(e.clientX);
    seek(drag.current === "start" ? moveStart(v) : drag.current === "end" ? moveEnd(v) : v);
  }
  function onHandleKey(e: React.KeyboardEvent, which: "start" | "end") {
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -1, ArrowUp: 1 }[e.key];
    if (!delta) return;
    e.preventDefault();
    e.stopPropagation(); // not a playhead step
    const v = (which === "start" ? start : end) + delta * (e.shiftKey ? 1 : 0.1);
    seek(which === "start" ? moveStart(v) : moveEnd(v));
  }

  const toEnd = end >= dur - 0.01;
  const cut = start > 0 || !toEnd;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const range = { start: start || undefined, end: toEnd ? undefined : end, convertFrom: job.id };
      const options: Partial<Options> = output === "video" ? { mode: "video", container, ...range } : { mode: "audio", audioFormat: output, ...range };
      await api("/downloads", { json: { url: job.url, options } });
      toast.success(t("started"));
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const pct = (v: number) => `${dur ? (v / dur) * 100 : 0}%`;
  const mediaProps = {
    ref: media,
    src: fileUrl(job),
    preload: "auto",
    onLoadedMetadata: () => {
      const d = media.current!.duration;
      if (Number.isFinite(d) && d > 0) {
        setDur(d);
        setEnd((e) => (e <= 0 || e > d || e === job.duration ? d : e));
      }
    },
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onError: () => setPlayError(true),
  };

  return (
    <form onSubmit={submit} onKeyDown={onKeyDown}>
      {isAudio ? (
        <audio {...mediaProps} />
      ) : (
        <video {...mediaProps} playsInline onClick={toggle} className={`w-full max-h-[50vh] bg-black cursor-pointer ${playError ? "hidden" : ""}`} />
      )}

      <div className="p-4 space-y-4">
        {playError && <p className="text-sm text-muted-foreground">{t("cantPlay")}</p>}

        <div className="flex flex-wrap items-center gap-1">
          {STEPS.slice(0, 2).map((s) => (
            <StepButton key={s} step={s} onClick={() => seek(time + s)} />
          ))}
          <button type="button" className="btn btn-primary h-9 w-11 px-0" onClick={toggle} autoFocus aria-label={playing ? t("pause") : t("play")} title={playing ? t("pause") : t("play")}>
            {playing ? <Pause /> : <Play />}
          </button>
          {STEPS.slice(2).map((s) => (
            <StepButton key={s} step={s} onClick={() => seek(time + s)} />
          ))}
          <span className="ml-2 font-mono text-sm tabular-nums">
            {formatTimestamp(time)} <span className="text-muted-foreground">/ {formatTimestamp(dur)}</span>
          </span>
          <button type="button" className="btn btn-secondary h-9 px-3 ml-auto" onClick={preview}>
            <Repeat /> {t("preview")}
          </button>
        </div>

        <div
          ref={bar}
          role="group"
          aria-label={t("timeline")}
          className="relative h-12 rounded-md bg-muted cursor-pointer touch-none select-none"
          onPointerDown={onPointer}
          onPointerMove={onPointer}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        >
          <div className="absolute inset-y-0 bg-primary/20" style={{ left: pct(start), width: pct(end - start) }} />
          {(["start", "end"] as const).map((which) => {
            const v = which === "start" ? start : end;
            return (
              <div
                key={which}
                data-handle={which}
                role="slider"
                tabIndex={0}
                aria-label={t(which)}
                aria-valuemin={0}
                aria-valuemax={dur}
                aria-valuenow={v}
                aria-valuetext={formatTimestamp(v)}
                onKeyDown={(e) => onHandleKey(e, which)}
                className="absolute inset-y-0 w-4 -ml-2 cursor-ew-resize grid place-items-center outline-none group"
                style={{ left: pct(v) }}
              >
                <span className="h-full w-1.5 rounded-full bg-primary group-focus-visible:ring-2 group-focus-visible:ring-ring/60" />
              </div>
            );
          })}
          <div className="pointer-events-none absolute -inset-y-1 w-0.5 -ml-px bg-foreground" style={{ left: pct(time) }} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {(["start", "end"] as const).map((which) => (
            <div key={which}>
              <span className="label">{t(which)}</span>
              <div className="flex gap-2">
                <TimeInput
                  label={t(which)}
                  value={which === "start" ? start : end}
                  onCommit={(v) => seek(which === "start" ? moveStart(v) : moveEnd(v))}
                />
                <button type="button" className="btn btn-secondary h-9 px-3" onClick={() => (which === "start" ? moveStart(time) : moveEnd(time))}>
                  {t(which === "start" ? "setStart" : "setEnd")} <kbd className="text-xs text-muted-foreground">{which === "start" ? "I" : "O"}</kbd>
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor={`cut-output-${job.id}`} className="label">{t("output")}</label>
            <select id={`cut-output-${job.id}`} className="input h-9 text-sm" value={output} onChange={(e) => setOutput(e.target.value as Output)}>
              {!isAudio && <option value="video">{t("video", { container: container.toUpperCase() })}</option>}
              {AUDIO.map(([value, name]) => (
                <option key={value} value={value}>{name}</option>
              ))}
            </select>
          </div>
          <p className="pb-2 text-sm font-medium tabular-nums">{t("length", { time: formatTimestamp(end - start) })}</p>
        </div>

        <p className="text-xs text-muted-foreground">{t("precise")}</p>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3 border-t border-border">
        <p className="hidden sm:block mr-auto text-xs text-muted-foreground">{t("keys")}</p>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          {t("close")}
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy || !cut || !dur}>
          {busy ? <Loader2 className="animate-spin" /> : <Scissors />}
          {t("submit")}
        </button>
      </div>
    </form>
  );
}

function StepButton({ step, onClick }: { step: number; onClick: () => void }) {
  const t = useTranslations("Cutter");
  const Icon = step === -1 ? ChevronsLeft : step < 0 ? ChevronLeft : step === 1 ? ChevronsRight : ChevronRight;
  const label = step < 0 ? t("back", { n: -step }) : t("forward", { n: step });
  return (
    <button type="button" className="btn btn-ghost h-9 w-9 px-0" onClick={onClick} aria-label={label} title={label}>
      <Icon />
    </button>
  );
}

/** Time field ("1:23.45"): applied on Enter or when leaving it; an unreadable value reverts. */
function TimeInput({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => number }) {
  const [text, setText] = useState(formatTimestamp(value));
  useEffect(() => setText(formatTimestamp(value)), [value]);
  function commit() {
    const v = parseTime(text);
    setText(formatTimestamp(v === undefined || Number.isNaN(v) ? value : onCommit(v)));
  }
  return (
    <input
      aria-label={label}
      className="input h-9 w-32 font-mono text-sm tabular-nums"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
      autoComplete="off"
      spellCheck={false}
    />
  );
}
