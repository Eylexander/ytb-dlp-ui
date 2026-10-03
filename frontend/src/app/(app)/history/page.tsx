"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, FileArchive, Files, Film, Layers, Loader2, Music, RotateCcw, Search, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import toast from "react-hot-toast";
import JobCard from "@/components/JobCard";
import { useJobs } from "@/hooks/useJobs";
import { api, each, fileUrl, retryJob } from "@/lib/api-client";
import { isActive, isAudioJob, type Job } from "@/types/download";

// The key is also the label key in messages "History"
const FILTERS: ["all" | "active" | "done" | "failed", (j: Job) => boolean][] = [
  ["all", () => true],
  ["active", isActive],
  ["done", (j) => j.status === "done"],
  ["failed", (j) => j.status === "failed" || j.status === "canceled"],
];

const TYPES = [
  ["all", "allTypes", Layers, () => true],
  ["video", "video", Film, (j: Job) => !isAudioJob(j)],
  ["audio", "audio", Music, isAudioJob],
] as const;

export default function HistoryPage() {
  const t = useTranslations("History");
  const tCommon = useTranslations("Common");
  const { jobs, error, refresh } = useJobs();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [type, setType] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastClicked, setLastClicked] = useState<string | null>(null);
  const [busy, setBusy] = useState<"delete" | "retry" | null>(null);

  const q = query.trim().toLowerCase();
  const matchesQuery = (j: Job) =>
    !q || [j.title, j.uploader, j.url, j.file].some((s) => s?.toLowerCase().includes(q));
  const matchesType = TYPES.find(([k]) => k === type)![3];
  const searched = jobs?.filter((j) => matchesQuery(j) && matchesType(j)) ?? [];
  const shown = searched.filter(FILTERS.find(([k]) => k === filter)![1]);
  // Actions only apply to selected items that are currently visible, never to ones a filter hides.
  const selectedShown = shown.filter((j) => selected.has(j.id));
  const allSelected = shown.length > 0 && selectedShown.length === shown.length;
  const savable = (list: Job[]) => list.filter((j) => j.status === "done" && j.file);
  const savableShown = savable(shown);
  const savableSelected = savable(selectedShown);
  const retryableSelected = selectedShown.filter((j) => j.status === "failed" || j.status === "canceled");

  function toggle(id: string, shiftKey: boolean) {
    const next = new Set(selected);
    const on = !selected.has(id);
    const from = shown.findIndex((j) => j.id === lastClicked);
    const to = shown.findIndex((j) => j.id === id);
    // Shift+click applies this click's state to the whole range since the last click
    const range = shiftKey && from >= 0 ? shown.slice(Math.min(from, to), Math.max(from, to) + 1) : [shown[to]];
    range.forEach((j) => (on ? next.add(j.id) : next.delete(j.id)));
    setSelected(next);
    setLastClicked(id);
  }

  async function deleteSelected() {
    const n = selectedShown.length;
    const running = selectedShown.filter(isActive).length;
    const msg = t("confirmDelete", { count: n }) + (running ? `\n\n${t("confirmDeleteRunning", { count: running })}` : "");
    if (!confirm(msg)) return;
    setBusy("delete");
    const { failed, firstError } = await each(selectedShown, (j) => api(`/downloads/${j.id}`, { method: "DELETE" }));
    const done = n - failed.length;
    if (done) toast.success(t("deleted", { count: done }));
    if (failed.length) toast.error(t("deleteFailed", { count: failed.length, error: firstError }));
    setSelected(new Set(failed.map((j) => j.id))); // keep what failed selected so it can be retried
    setBusy(null);
    refresh();
  }

  async function retrySelected() {
    setBusy("retry");
    const { failed, firstError } = await each(retryableSelected, retryJob);
    const done = retryableSelected.length - failed.length;
    if (done) toast.success(t("restarted", { count: done }));
    if (failed.length) toast.error(t("restartFailed", { count: failed.length, error: firstError }));
    // Retried entries are replaced by new jobs; keep the rest of the selection.
    setSelected(new Set([...selected].filter((id) => !retryableSelected.some((j) => j.id === id && !failed.includes(j)))));
    setBusy(null);
    refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground">
          {jobs ? t("count", { count: jobs.length }) : `${tCommon("loading")}…`}
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <label htmlFor="search" className="sr-only">{t("searchLabel")}</label>
          <input
            id="search"
            type="search"
            className="input pl-10"
            placeholder={t("searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <div role="tablist" aria-label={t("filterType")} className="inline-flex self-start rounded-lg border border-border bg-muted/50 p-1">
            {TYPES.map(([key, label, Icon]) => (
              <button
                key={key}
                role="tab"
                aria-selected={type === key}
                onClick={() => setType(key)}
                aria-label={t(label)}
                title={t(label)}
                className={`btn h-9 px-3 ${
                  type === key
                    ? `bg-card shadow-sm ${key === "video" ? "text-video" : key === "audio" ? "text-audio" : "text-foreground"}`
                    : "btn-ghost"
                }`}
              >
                <Icon />
                <span className="hidden lg:inline">{t(label)}</span>
              </button>
            ))}
          </div>
          <div role="tablist" aria-label={t("filterStatus")} className="flex w-full sm:w-auto self-start rounded-lg border border-border bg-muted/50 p-1">
            {FILTERS.map(([key, pred]) => (
              <button
                key={key}
                role="tab"
                aria-selected={filter === key}
                onClick={() => setFilter(key)}
                className={`btn h-9 flex-1 sm:flex-none gap-1 sm:gap-2 px-1.5 sm:px-3 ${filter === key ? "bg-card text-foreground shadow-sm" : "btn-ghost"}`}
              >
                {t(key)}
                <span className="text-xs text-muted-foreground tabular-nums">{searched.filter(pred).length}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {jobs === null && !error ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <div key={i} className="card h-28 animate-pulse bg-muted/40" />)}
        </div>
      ) : shown.length === 0 ? (
        <p className="card p-8 text-center text-sm text-muted-foreground">
          {jobs?.length ? t("noMatch") : t("empty")}
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 px-4">
            <label className="flex items-center gap-3 text-sm text-muted-foreground cursor-pointer w-fit">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = selectedShown.length > 0 && !allSelected;
                }}
                onChange={() => setSelected(allSelected ? new Set() : new Set(shown.map((j) => j.id)))}
                className="w-4 h-4 cursor-pointer accent-[hsl(var(--primary))]"
              />
              {t("selectAll", { count: shown.length })}
            </label>
            {savableShown.length > 0 && (
              <SaveLink jobs={savableShown} className="btn btn-ghost h-8 px-2 text-sm" menuAt="below">
                {t("downloadAll", { count: savableShown.length })}
              </SaveLink>
            )}
          </div>
          {shown.map((j) => (
            <JobCard key={j.id} job={j} onChange={refresh} selected={selected.has(j.id)} onSelect={(shift) => toggle(j.id, shift)} />
          ))}
        </div>
      )}

      {selectedShown.length > 0 && (
        <div className="sticky bottom-4 z-20 animate-slide-up">
          {/* Below sm the labels collapse to icon + count so all actions fit a phone width */}
          <div className="card mx-auto w-fit max-w-full flex items-center gap-1 sm:gap-2 p-1.5 sm:p-2 pl-3 sm:pl-4 shadow-lg shadow-black/10">
            <span className="text-sm font-medium tabular-nums mr-1 sm:mr-2 whitespace-nowrap">
              <span className="sm:hidden">{selectedShown.length}</span>
              <span className="hidden sm:inline">{t("selected", { count: selectedShown.length })}</span>
            </span>
            <button className="btn btn-ghost h-9 px-2.5 sm:px-3" onClick={() => setSelected(new Set())} disabled={!!busy} aria-label={t("clearSelection")} title={t("clearSelection")}>
              <X /> <span className="hidden sm:inline">{t("clear")}</span>
            </button>
            {retryableSelected.length > 0 && (
              <button
                className="btn btn-secondary h-9 px-2.5 sm:px-3"
                onClick={retrySelected}
                disabled={!!busy}
                aria-label={t("retryCount", { count: retryableSelected.length })}
                title={t("retryCount", { count: retryableSelected.length })}
              >
                {busy === "retry" ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                <span className="hidden sm:inline">{t("retry")}</span> {retryableSelected.length}
              </button>
            )}
            {savableSelected.length > 0 && (
              <SaveLink jobs={savableSelected} className="btn btn-secondary h-9 px-2.5 sm:px-3" menuAt="above">
                <span className="hidden sm:inline">{t("download")}</span> {savableSelected.length}
              </SaveLink>
            )}
            <button
              className="btn h-9 px-2.5 sm:px-3 bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm shadow-destructive/20"
              onClick={deleteSelected}
              disabled={!!busy}
              aria-label={t("deleteSelected")}
              title={t("deleteSelected")}
            >
              {busy === "delete" ? <Loader2 className="animate-spin" /> : <Trash2 />}
              <span className="hidden sm:inline">{t("delete")}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** One file downloads as-is. Several open a menu: one zip, or each file on its own. */
function SaveLink({ jobs, className, menuAt, children }: { jobs: Job[]; className: string; menuAt: "above" | "below"; children: React.ReactNode }) {
  const t = useTranslations("History");
  const menu = useRef<HTMLDetailsElement>(null);

  // Close the menu on a click outside it (a <details> only closes from its own summary).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (menu.current && !menu.current.contains(e.target as Node)) menu.current.open = false;
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  if (jobs.length === 1) {
    return (
      <a href={fileUrl(jobs[0], true)} download className={className} title={t("saveFile")} aria-label={t("saveFile")}>
        <Download />
        {children}
      </a>
    );
  }

  const close = () => menu.current && (menu.current.open = false);

  // Browsers drop a burst of programmatic downloads, so they are spaced out; Chrome asks once
  // whether the site may download several files.
  async function saveSeparately() {
    close();
    toast(t("saveSeparatelyHint", { count: jobs.length }), { icon: "⬇️" });
    for (const [i, j] of jobs.entries()) {
      if (i) await new Promise((r) => setTimeout(r, 500));
      const a = document.createElement("a");
      a.href = fileUrl(j, true);
      a.download = "";
      a.click();
    }
  }

  const item = "btn btn-ghost h-9 w-full justify-start px-3";
  return (
    <details ref={menu} className="relative" onKeyDown={(e) => e.key === "Escape" && close()}>
      <summary className={`${className} list-none [&::-webkit-details-marker]:hidden cursor-pointer`} title={t("saveChoose")} aria-label={t("saveChoose")}>
        <Download />
        {children}
        <ChevronDown className="opacity-60" />
      </summary>
      <div className={`absolute right-0 z-30 card min-w-max p-1 shadow-lg shadow-black/10 ${menuAt === "above" ? "bottom-full mb-2" : "top-full mt-1"}`}>
        <a href={`/api/downloads/archive?ids=${jobs.map((j) => j.id).join(",")}`} download className={item} onClick={close}>
          <FileArchive /> {t("saveZip", { count: jobs.length })}
        </a>
        <button type="button" className={item} onClick={saveSeparately}>
          <Files /> {t("saveSeparately", { count: jobs.length })}
        </button>
      </div>
    </details>
  );
}
