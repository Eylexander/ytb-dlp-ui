"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { AlertTriangle, Download, HardDrive, History, Loader2, LogOut, Moon, Settings, Sun } from "lucide-react";
import toast from "react-hot-toast";
import Logo from "@/components/Logo";
import { api } from "@/lib/api-client";
import { formatBytes } from "@/lib/format";
import { LOW_DISK, type Health } from "@/types/download";

const nav = [
  { href: "/", label: "download", icon: Download },
  { href: "/history/", label: "history", icon: History },
  { href: "/settings/", label: "settings", icon: Settings },
] as const;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const t = useTranslations("Navigation");
  const tBanner = useTranslations("Banners");
  const tCommon = useTranslations("Common");
  const [user, setUser] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    // api() redirects to /login on 401.
    api<{ username: string }>("/me").then(
      (me) => setUser(me.username),
      (e) => toast.error(e.message),
    );
  }, []);

  // Refetched on navigation so the footer shows the new version after an update in Settings.
  useEffect(() => {
    if (user) api<Health>("/health").then(setHealth, () => {});
  }, [user, pathname]);

  async function logout() {
    await api("/logout", { method: "POST" }).catch(() => {});
    router.replace("/login/");
  }

  if (!user) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" aria-label={tCommon("loading")} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 h-16 flex items-center gap-2">
          <Link href="/" className="mr-2 sm:mr-6">
            <Logo />
          </Link>
          <nav className="flex gap-1 flex-1">
            {nav.map(({ href, label, icon: Icon }) => {
              const active = href === "/" ? pathname === "/" : pathname.startsWith(href.slice(0, -1));
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`btn h-9 px-3 ${active ? "bg-primary/10 text-primary font-semibold" : "btn-ghost"}`}
                >
                  <Icon />
                  <span className="hidden sm:inline">{t(label)}</span>
                </Link>
              );
            })}
          </nav>
          {health && health.diskTotal > 0 && (
            <Link
              href="/settings/"
              title={t("freeSpaceTitle")}
              className={`hidden sm:inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium tabular-nums ${
                health.diskFree < LOW_DISK ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              <HardDrive className="w-3.5 h-3.5" />
              {t("free", { size: formatBytes(health.diskFree) })}
            </Link>
          )}
          <span className="hidden md:inline text-sm text-muted-foreground mx-1">{user}</span>
          <button
            className="btn-icon"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            aria-label={t("toggleTheme")}
            title={t("toggleTheme")}
          >
            {resolvedTheme === "dark" ? <Sun /> : <Moon />}
          </button>
          <button className="btn-icon" onClick={logout} aria-label={t("signOut")} title={t("signOut")}>
            <LogOut />
          </button>
        </div>
      </header>

      {health && health.diskTotal > 0 && health.diskFree < LOW_DISK && (
        <div role="alert" className="border-b border-destructive/30 bg-destructive/10 text-destructive text-sm">
          <div className="mx-auto max-w-5xl px-4 py-2.5 flex gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            {tBanner("lowDisk", { size: formatBytes(health.diskFree) })}
          </div>
        </div>
      )}

      {health && (!health.ytdlp || !health.ffmpeg) && (
        <div role="alert" className="border-b border-destructive/30 bg-destructive/10 text-destructive text-sm">
          <div className="mx-auto max-w-5xl px-4 py-2.5 flex gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            {!health.ytdlp ? tBanner("noYtdlp") : tBanner("noFfmpeg")}
          </div>
        </div>
      )}

      <main className="flex-1 mx-auto w-full max-w-5xl px-4 py-6 sm:py-10 animate-fade-in">{children}</main>

      <footer className="text-center text-xs text-muted-foreground py-6">
        {health?.ytdlp && <>yt-dlp {health.ytdlp}</>}
      </footer>
    </div>
  );
}
