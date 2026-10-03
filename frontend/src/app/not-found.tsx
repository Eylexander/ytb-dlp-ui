"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

export default function NotFound() {
  const t = useTranslations("NotFound");
  return (
    <main className="min-h-screen grid place-items-center px-4 text-center">
      <div>
        <p className="text-6xl font-bold text-gradient">404</p>
        <p className="mt-3 text-muted-foreground">{t("message")}</p>
        <Link href="/" className="btn btn-primary mt-6">
          {t("back")}
        </Link>
      </div>
    </main>
  );
}
