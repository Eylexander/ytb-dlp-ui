"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, HardDrive, Languages, Loader2, RefreshCw, Save, UserRound, XCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import toast from "react-hot-toast";
import AllowedOptions from "@/components/AllowedOptions";
import { locales, type Locale } from "@/i18n";
import { useSetLocale } from "@/providers/IntlProvider";
import { api, ApiError } from "@/lib/api-client";
import { formatBytes } from "@/lib/format";
import { LOW_DISK, type Health } from "@/types/download";

const CHANNELS = [
  // value, label key, hint key (messages "Settings")
  ["stable", "stable", "stableHint"],
  ["nightly", "nightly", "nightlyHint"],
] as const;

export default function SettingsPage() {
  const t = useTranslations("Settings");
  const [health, setHealth] = useState<Health | null>(null);
  const [channel, setChannel] = useState<"stable" | "nightly">("stable");
  const [updating, setUpdating] = useState(false);
  const [output, setOutput] = useState<{ text: string; ok: boolean } | null>(null);

  const load = () => api<Health>("/health").then(setHealth, (e) => toast.error(e.message));
  useEffect(() => {
    load();
  }, []);

  async function update() {
    setUpdating(true);
    setOutput(null);
    try {
      const res = await api<{ output: string; version: string }>("/ytdlp/update", { json: { channel } });
      setOutput({ text: res.output, ok: true });
      toast.success(t("updated", { version: res.version }));
      load();
    } catch (e) {
      const err = e as ApiError;
      toast.error(err.message);
      if (err.data?.output) setOutput({ text: err.data.output, ok: false });
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
      </div>

      <LanguageSetting />

      <AccountSetting />

      <section className="card p-4 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">yt-dlp</h2>
            <p className="text-sm text-muted-foreground">
              {t("ytdlpHint")}
            </p>
          </div>
          <span className="rounded-full bg-muted px-3 py-1 text-sm font-mono">
            {health ? health.ytdlp || t("notInstalled") : "…"}
          </span>
        </div>

        <fieldset>
          <legend className="label">{t("channel")}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {CHANNELS.map(([value, label, hint]) => (
              <label
                key={value}
                className={`flex gap-3 rounded-lg border p-3 cursor-pointer transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/40 ${
                  channel === value ? "border-primary bg-primary/5" : "border-border hover:bg-accent"
                }`}
              >
                <input
                  type="radio"
                  name="channel"
                  value={value}
                  checked={channel === value}
                  onChange={() => setChannel(value)}
                  className="mt-1 accent-[hsl(var(--primary))]"
                />
                <span className="text-sm">
                  <span className="font-medium">{t(label)}</span>
                  <span className="block text-xs text-muted-foreground">{t(hint)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <button className="btn btn-primary" onClick={update} disabled={updating || !health?.ytdlp}>
          {updating ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {updating ? t("updating") : t("update")}
        </button>

        {output && (
          <pre
            className={`whitespace-pre-wrap break-all rounded-md p-3 text-xs font-mono ${
              output.ok ? "bg-muted text-muted-foreground" : "bg-destructive/10 text-destructive"
            }`}
          >
            {output.text || t("noOutput")}
          </pre>
        )}
      </section>

      {health && health.diskTotal > 0 && <Storage free={health.diskFree} total={health.diskTotal} />}

      <section className="card p-4 sm:p-6">
        <h2 className="text-lg font-semibold mb-3">{t("tools")}</h2>
        <ul className="space-y-2 text-sm">
          <Tool ok={!!health?.ytdlp} name="yt-dlp" hint={t("toolYtdlp")} loading={!health} />
          <Tool ok={!!health?.ffmpeg} name="ffmpeg" hint={t("toolFfmpeg")} loading={!health} />
          <Tool ok={!!health?.deno} name="deno" hint={t("toolDeno")} loading={!health} />
        </ul>
      </section>

      <section className="card p-4 sm:p-6">
        <h2 className="text-lg font-semibold mb-1">{t("customArgs")}</h2>
        <p className="mb-3 text-sm text-muted-foreground">{t("customArgsHint")}</p>
        <AllowedOptions args={health?.allowedArgs} />
      </section>
    </div>
  );
}

function Tool({ ok, name, hint, loading }: { ok: boolean; name: string; hint: string; loading: boolean }) {
  const t = useTranslations("Settings");
  const Icon = loading ? Loader2 : ok ? CheckCircle2 : XCircle;
  return (
    <li className="flex gap-2">
      <Icon
        className={`w-4 h-4 mt-0.5 shrink-0 ${loading ? "animate-spin text-muted-foreground" : ok ? "text-success" : "text-destructive"}`}
      />
      <span>
        <span className="font-medium font-mono">{name}</span>
        <span className="text-muted-foreground"> · {ok || loading ? hint : t("notInstalled")}</span>
      </span>
    </li>
  );
}

function Storage({ free, total }: { free: number; total: number }) {
  const t = useTranslations("Settings");
  const used = total - free;
  const pct = Math.round((used / total) * 100);
  const low = free < LOW_DISK;
  return (
    <section className="card p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-lg font-semibold inline-flex items-center gap-2">
          <HardDrive className="w-5 h-5 text-muted-foreground" /> {t("storage")}
        </h2>
        <span className={`text-sm font-medium ${low ? "text-destructive" : "text-muted-foreground"}`}>
          {t("storageFree", { free: formatBytes(free), total: formatBytes(total) })}
        </span>
      </div>
      <div className="h-2.5 rounded-full bg-muted overflow-hidden" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t("diskUsed")}>
        <div className={`h-full ${low ? "bg-destructive" : "bg-primary"}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t("storageUsed", { percent: pct })}</p>
    </section>
  );
}

// Each language is named in itself, so it's recognisable whatever the current language.
const LANGUAGE_NAMES: Record<Locale, string> = { "en-US": "English", "fr-FR": "Français" };

function LanguageSetting() {
  const t = useTranslations("Settings");
  const locale = useLocale();
  const setLocale = useSetLocale();
  return (
    <section className="card p-4 sm:p-6">
      <fieldset>
        <legend className="text-lg font-semibold inline-flex items-center gap-2">
          <Languages className="w-5 h-5 text-muted-foreground" /> {t("language")}
        </legend>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">{t("languageHint")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {locales.map((l) => (
            <label
              key={l}
              lang={l}
              className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/40 ${
                locale === l ? "border-primary bg-primary/5" : "border-border hover:bg-accent"
              }`}
            >
              <input
                type="radio"
                name="language"
                value={l}
                checked={locale === l}
                onChange={() => setLocale(l)}
                className="accent-[hsl(var(--primary))]"
              />
              <span className="text-sm font-medium">{LANGUAGE_NAMES[l]}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </section>
  );
}

function AccountSetting() {
  const t = useTranslations("Settings");
  const [saved, setSaved] = useState("");
  const [username, setUsername] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ username: string }>("/me").then((me) => {
      setSaved(me.username);
      setUsername(me.username);
    }, () => {});
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/account", {
        method: "PUT",
        json: { currentPassword: current, username, newPassword: next },
      });
      setCurrent("");
      setNext("");
      toast.success(t("accountSaved"));
      if (username.trim() !== saved) location.reload(); // the nav shows the username
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card p-4 sm:p-6 space-y-4" onSubmit={save}>
      <div>
        <h2 className="text-lg font-semibold inline-flex items-center gap-2">
          <UserRound className="w-5 h-5 text-muted-foreground" /> {t("account")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("accountHint")}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="account-username" className="label">{t("username")}</label>
          <input id="account-username" className="input" autoComplete="username" required maxLength={64}
            value={username} onChange={(e) => setUsername(e.target.value)} disabled={saving} />
        </div>
        <div>
          <label htmlFor="account-current" className="label">{t("currentPassword")}</label>
          <input id="account-current" className="input" type="password" autoComplete="current-password" required
            value={current} onChange={(e) => setCurrent(e.target.value)} disabled={saving} />
        </div>
        <div>
          <label htmlFor="account-new" className="label">{t("newPassword")}</label>
          <input id="account-new" className="input" type="password" autoComplete="new-password" minLength={8}
            aria-describedby="account-new-hint" value={next} onChange={(e) => setNext(e.target.value)} disabled={saving} />
          <p id="account-new-hint" className="mt-1 text-xs text-muted-foreground">{t("newPasswordHint")}</p>
        </div>
      </div>
      <button type="submit" className="btn btn-primary" disabled={saving || !username.trim() || !current}>
        {saving ? <Loader2 className="animate-spin" /> : <Save />}
        {t("saveAccount")}
      </button>
    </form>
  );
}
