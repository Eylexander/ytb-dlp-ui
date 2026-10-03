"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Eye, EyeOff, Loader2, LogIn } from "lucide-react";
import { useTranslations } from "next-intl";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import Logo from "@/components/Logo";
import { api } from "@/lib/api-client";

export default function LoginPage() {
  const router = useRouter();
  const t = useTranslations("Login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already logged in? Skip the form.
  useEffect(() => {
    api("/me").then(() => router.replace("/"), () => {});
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api("/login", { json: { username: username.trim(), password } });
      router.replace("/");
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen flex items-center justify-center px-4 py-10 overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2 w-[40rem] h-[40rem] rounded-full bg-primary/10 blur-3xl"
      />
      <div className="absolute top-4 right-4">
        <LocaleSwitcher />
      </div>
      <div className="relative w-full max-w-sm animate-slide-up">
        <div className="flex justify-center mb-8">
          <Logo large />
        </div>
        <form onSubmit={submit} className="card p-6 sm:p-8 shadow-lg shadow-black/5 space-y-5">
          <h1 className="text-xl font-bold text-center">{t("title")}</h1>

          {error && (
            <div role="alert" className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          <div>
            <label htmlFor="username" className="label">{t("username")}</label>
            <input
              id="username"
              className="input"
              autoComplete="username"
              autoFocus
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
            />
          </div>

          <div>
            <label htmlFor="password" className="label">{t("password")}</label>
            <div className="relative">
              <input
                id="password"
                className="input pr-11"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="btn-icon absolute right-1 top-1"
                aria-label={showPassword ? t("hidePassword") : t("showPassword")}
              >
                {showPassword ? <EyeOff /> : <Eye />}
              </button>
            </div>
          </div>

          <button type="submit" className="btn btn-primary w-full h-11" disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <LogIn />}
            {t("submit")}
          </button>
        </form>
      </div>
    </main>
  );
}
