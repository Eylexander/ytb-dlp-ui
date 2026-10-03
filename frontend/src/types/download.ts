export type Options = {
  mode: "video" | "audio";
  quality: "best" | "2160" | "1440" | "1080" | "720" | "480" | "360";
  container: "mp4" | "mkv" | "webm";
  audioFormat: "best" | "mp3" | "m4a" | "opus" | "flac" | "wav";
  subtitles: boolean;
  subLangs: string;
  embedThumbnail: boolean;
  embedMetadata: boolean;
  sponsorBlock: boolean;
  /** Extra yt-dlp options, checked server-side against an allowlist */
  customArgs?: string;
  /** Set on conversions: the job whose file ffmpeg converted to audio */
  convertFrom?: string;
  /** kbps, lossy conversions only */
  audioBitrate?: (typeof BITRATES)[number];
};

export const BITRATES = ["96", "128", "192", "256", "320"] as const;

export type Status = "queued" | "running" | "processing" | "done" | "failed" | "canceled";

export type Job = {
  id: string;
  url: string;
  options: Options;
  status: Status;
  title?: string;
  thumbnail?: string;
  uploader?: string;
  duration?: number;
  progress: number;
  speed?: number;
  eta?: number;
  size?: number;
  file?: string;
  error?: string;
  errorDetail?: string;
  createdAt: string;
  finishedAt?: string;
};

export const isActive = (j: Job) => ["queued", "running", "processing"].includes(j.status);

/** Below this much free space the UI warns that the server is almost full. */
export const LOW_DISK = 2 * 1024 ** 3;

export type Health = {
  ytdlp: string;
  ffmpeg: boolean;
  deno: boolean;
  allowedArgs: string[];
  /** Bytes available / total on the server's data disk (0 if unknown) */
  diskFree: number;
  diskTotal: number;
};

export const isAudioJob = (j: Job) =>
  j.options.mode === "audio" || /\.(mp3|m4a|opus|ogg|flac|wav|aac)$/i.test(j.file ?? "");
