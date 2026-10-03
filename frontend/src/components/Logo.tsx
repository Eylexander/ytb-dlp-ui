import { Download } from "lucide-react";

export default function Logo({ large = false }: { large?: boolean }) {
  return (
    <span className="flex items-center gap-2.5 font-bold tracking-tight">
      <span
        className={`grid place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm shadow-primary/30 ${large ? "w-11 h-11" : "w-8 h-8"}`}
      >
        <Download className={large ? "w-6 h-6" : "w-4 h-4"} strokeWidth={2.5} />
      </span>
      {/* text drops on very narrow phones so the header stays on one line */}
      <span className={`whitespace-nowrap ${large ? "text-2xl" : "text-lg max-[379px]:hidden"}`}>
        <span className="text-gradient">yt-dlp</span> UI
      </span>
    </span>
  );
}
