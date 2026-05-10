"use client";

import { useEffect, useState } from "react";

function formatAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}

/** Banner showing how stale cached X data is; updates every 30s. */
export function XDataAgeBanner({ generatedAt }: { generatedAt: string }) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const t = Date.parse(generatedAt);
  const age = Number.isFinite(t) ? nowMs - t : NaN;
  const abs = Number.isFinite(t) ? new Date(t).toLocaleString() : "—";

  return (
    <div
      role="status"
      className="rounded-lg border border-amber-200/90 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-500/35 dark:bg-amber-500/15 dark:text-amber-100"
    >
      <span className="font-semibold">X data age:</span> fetched <strong>{formatAge(age)}</strong>
      <span className="text-amber-800/80 dark:text-amber-200/80"> · {abs}</span>
    </div>
  );
}
