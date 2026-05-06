"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Point = { asOf: string; totalMarketValue: number };
type BenchPoint = { date: string; close: number };

export default function PerformancePage() {
  const [series, setSeries] = useState<Point[]>([]);
  const [bucket, setBucket] = useState<"combined" | "retirement" | "brokerage">("combined");
  const [bench, setBench] = useState<Record<string, BenchPoint[]>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setError(null);
      async function safeJson(resp: Response) {
        const text = await resp.text();
        try {
          return JSON.parse(text) as any;
        } catch {
          const url = resp.url || "(unknown url)";
          throw new Error(
            `Non-JSON response (${resp.status}) from ${url}: ${text ? text.slice(0, 200) : "(empty body)"}`,
          );
        }
      }

      const pResp = await fetch("/api/performance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucket }),
      });

      const pJson = (await safeJson(pResp)) as { ok: boolean; series?: Point[]; error?: string };
      if (!pJson.ok) throw new Error(pJson.error ?? "Failed to load performance");
      setSeries(pJson.series ?? []);

      // Benchmarks are optional (demo mode may not have Schwab connected yet).
      try {
        const bResp = await fetch("/api/performance/benchmarks?symbols=SPY,QQQ");
        const bJson = (await safeJson(bResp)) as {
          ok: boolean;
          series?: Record<string, BenchPoint[]>;
          error?: string;
        };
        if (bJson.ok) setBench(bJson.series ?? {});
        else setBench({});
      } catch {
        setBench({});
      }
    })().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [bucket]);

  const chartData = useMemo(() => {
    // Normalize portfolio + benchmarks to 100 at the first portfolio point.
    if (series.length === 0) return [];
    const start = series[0]!.totalMarketValue || 1;

    // Helper to find closest benchmark close on or before the date.
    const getBenchNorm = (sym: string, isoDate: string) => {
      const s = bench[sym] ?? [];
      if (s.length === 0) return null;
      // ISO dates sort lexicographically
      let lo = 0;
      let hi = s.length - 1;
      let idx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (s[mid]!.date <= isoDate) {
          idx = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (idx < 0) return null;
      const first = s[0]!.close || 1;
      return (s[idx]!.close / first) * 100;
    };

    return series.map((p) => {
      const isoDate = new Date(p.asOf).toISOString().slice(0, 10);
      return {
        asOf: p.asOf,
        asOfLabel: new Date(p.asOf).toLocaleDateString(),
        portfolio: (p.totalMarketValue / start) * 100,
        SPY: getBenchNorm("SPY", isoDate),
        QQQ: getBenchNorm("QQQ", isoDate),
      };
    });
  }, [series, bench]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Performance</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Time series is built from holdings snapshots created on each sync.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/connections"
            className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            Connections
          </Link>
          <Link
            href="/allocation"
            className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            Allocation
          </Link>
        </div>
      </div>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-zinc-950">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-medium">Bucket</div>
          <div className="flex items-center gap-2">
            {(["combined", "retirement", "brokerage"] as const).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBucket(b)}
                className={
                  "rounded-full px-4 py-2 text-sm font-medium " +
                  (bucket === b
                    ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                    : "border border-zinc-200 bg-white text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5")
                }
              >
                {b === "combined" ? "Combined" : b === "retirement" ? "Retirement" : "Brokerage"}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <div className="rounded-xl bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {chartData.length < 2 ? (
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            Not enough data yet. Run sync a couple times to build history.
          </div>
        ) : (
          <div className="h-80 w-full">
            <ResponsiveContainer>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="asOfLabel" tick={false} />
                <YAxis
                  tickFormatter={(v) => `${Number(v).toFixed(0)}`}
                />
                <Tooltip
                  formatter={(v) => `${Number(v).toFixed(2)}`}
                  labelFormatter={(l) => String(l)}
                />
                <Line type="monotone" dataKey="portfolio" name="Portfolio" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="SPY" name="SPY" strokeWidth={2} dot={false} stroke="#2563eb" />
                <Line type="monotone" dataKey="QQQ" name="QQQ" strokeWidth={2} dot={false} stroke="#7c3aed" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    </div>
  );
}

