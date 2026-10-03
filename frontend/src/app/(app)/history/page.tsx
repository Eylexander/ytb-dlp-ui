"use client";

import { useState } from "react";
import { Download, Film, Layers, Loader2, Music, RotateCcw, Search, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import toast from "react-hot-toast";
import JobCard from "@/components/JobCard";
import { useJobs } from "@/hooks/useJobs";
import { api, archiveUrl, fileUrl, retryJob } from "@/lib/api-client";
import { isActive, isAudioJob, type Job } from "@/types/download";

// Second item: the label key in messages "History"
const FILTERS: [string, "all" | "active" | "done" | "failed", (j: Job) => boolean][] = [
  ["all", "all", () => true],
  ["active", "active", isActive],
  ["done", "done", (j) => j.status === "done"],
  ["failed", "failed", (j) => j.status === "failed" || j.status === "canceled"],
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
  const shown = searched.filter(FILTERS.find(([k]) => k === filter)![2]);
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
    const failed = new Set<string>();
    let firstError = "";
    for (const j of selectedShown) {
      try {
        await api(`/downloads/${j.id}`, { method: "DELETE" });
      } catch (err) {
        failed.add(j.id);
        firstError ||= (err as Error).message;
      }
    }
    const done = n - failed.size;
    if (done) toast.success(t("deleted", { count: done }));
    if (failed.size) toast.error(t("deleteFailed", { count: failed.size, error: firstError }));
    setSelected(failed); // keep what failed selected so it can be retried
    setBusy(null);
    refresh();
  }

  async function retrySelected() {
    setBusy("retry");
    const failed = new Set<string>();
    let firstError = "";
    for (const j of retryableSelected) {
      try {
        await retryJob(j);
      } catch (err) {
        failed.add(j.id);
        firstError ||= (err as Error).message;
      }
    }
    const done = retryableSelected.length - failed.size;
    if (done) toast.success(t("restarted", { count: done }));
    if (failed.size) toast.error(t("restartFailed", { count: failed.size, error: firstError }));
    // Retried entries are replaced by new jobs; keep the rest of the selection.
    setSelected(new Set([...selected].filter((id) => failed.has(id) || !retryableSelected.some((j) => j.id === id))));
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
            {FILTERS.map(([key, label, pred]) => (
              <button
                key={key}
                role="tab"
                aria-selected={filter === key}
                onClick={() => setFilter(key)}
                className={`btn h-9 flex-1 sm:flex-none gap-1 sm:gap-2 px-1.5 sm:px-3 ${filter === key ? "bg-card text-foreground shadow-sm" : "btn-ghost"}`}
              >
                {t(label)}
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
              <SaveLink jobs={savableShown} className="btn btn-ghost h-8 px-2 text-sm">
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
              <SaveLink jobs={savableSelected} className="btn btn-secondary h-9 px-2.5 sm:px-3">
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

/** One file downloads as-is; several come as a single zip, so the browser doesn't block a burst of downloads. */
function SaveLink({ jobs, className, children }: { jobs: Job[]; className: string; children: React.ReactNode }) {
  const t = useTranslations("History");
  const href = jobs.length === 1 ? fileUrl(jobs[0], true) : archiveUrl(jobs.map((j) => j.id));
  const label = jobs.length > 1 ? t("saveZip", { count: jobs.length }) : t("saveFile");
  return (
    <a
      href={href}
      download
      className={className}
      title={label}
      aria-label={label}
    >
      <Download />
      {children}
    </a>
  );
}
