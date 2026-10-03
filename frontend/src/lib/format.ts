import { getCurrentLocale } from "@/i18n";

const UNITS = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"] as const;

/** "48.8 GB" in English, "48,8 Go" in French (Intl knows the local unit names). */
export function formatBytes(n?: number) {
  if (!n) return "";
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), UNITS.length - 1);
  return new Intl.NumberFormat(getCurrentLocale(), {
    style: "unit",
    unit: UNITS[i],
    unitDisplay: "short",
    maximumFractionDigits: i ? 1 : 0,
  }).format(n / 1024 ** i);
}

export function formatDuration(s?: number) {
  if (!s) return "";
  s = Math.round(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
