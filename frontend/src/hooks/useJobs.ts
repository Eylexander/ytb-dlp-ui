"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { isActive, type Job } from "@/types/download";

/** Download list, polled every second while something is in progress. */
// ponytail: polling instead of SSE/WebSocket; fine for a handful of concurrent downloads.
export function useJobs() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setJobs(await api<Job[]>("/downloads"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const anyActive = jobs?.some(isActive) ?? false;
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, anyActive ? 1000 : 15000);
    return () => clearInterval(t);
  }, [refresh, anyActive]);

  return { jobs, error, refresh };
}
