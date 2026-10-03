import { getTranslator, translateCode } from "@/i18n";
import type { Job } from "@/types/download";

/** Error body sent by the backend (api.writeErr): English text + a code to translate. */
type ErrorBody = { error?: string; code?: string; params?: Record<string, string | number>; output?: string };

export class ApiError extends Error {
  /** data is the full JSON error body, for endpoints that send more than a message */
  constructor(public status: number, message: string, public data?: ErrorBody) {
    super(message);
  }
}

/** fetch wrapper: JSON in/out, server error messages surfaced, 401 → login page. */
export async function api<T = void>(path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? (init.json !== undefined ? "POST" : "GET"),
      headers: init.json !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
    });
  } catch {
    throw new ApiError(0, getTranslator()("Common.networkError"));
  }
  if (res.status === 401 && path !== "/login" && !location.pathname.startsWith("/login")) {
    location.href = "/login/";
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const body = (data ?? {}) as ErrorBody;
    const fallback = body.error ?? getTranslator()("Common.serverError", { status: res.status });
    throw new ApiError(res.status, translateCode("ApiErrors", body.code, fallback, body.params), body);
  }
  return data as T;
}

export const thumbnailUrl = (j: Job) => `/api/downloads/${j.id}/thumbnail`;

/** Re-queues a failed/canceled job and drops the old entry, so history doesn't fill with duplicates. */
export async function retryJob(j: Job) {
  await api("/downloads", { json: { url: j.url, options: j.options } });
  await api(`/downloads/${j.id}`, { method: "DELETE" }).catch(() => {}); // worst case the old entry stays
}

/** Zip of the given jobs' files, streamed by the server */
export const archiveUrl = (ids: string[]) => `/api/downloads/archive?ids=${ids.join(",")}`;

export const fileUrl = (j: Job, download = false) =>
  `/api/downloads/${j.id}/file${download ? "?download=1" : ""}`;
