"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Point = { asOf: string; totalMarketValue: number };
type BenchPoint = { date: string; close: number };
type TodayPayload = { ok: boolean; portfolioPct: number | null; SPY: number | null; QQQ: number | null };

export default function PerformancePage() {
  const [series, setSeries] = useState<Point[]>([]);
  const [bucket, setBucket] = useState<"combined" | "retirement" | "brokerage">("combined");
  const [windowKey, setWindowKey] = useState<"1D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "3Y" | "5Y">("6M");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [bench, setBench] = useState<Record<string, BenchPoint[]>>({});
  const [today, setToday] = useState<TodayPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setError(null);
      async function safeJson(resp: Response) {
        const text = await resp.text();
        try {
          return JSON.parse(text) as unknown;
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

      // Today % (live)
      try {
        const tResp = await fetch("/api/performance/today", { cache: "no-store" });
        const tJson = (await safeJson(tResp)) as TodayPayload;
        if (tJson.ok) setToday(tJson);
        else setToday(null);
      } catch {
        setToday(null);
      }
    })().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [bucket]);

  useEffect(() => {
    const t = setTimeout(() => setNowMs(Date.now()), 0);
    return () => clearTimeout(t);
  }, [bucket, windowKey]);

  const windowStartMs = useMemo(() => {
    const day = 24 * 60 * 60 * 1000;
    const map: Record<typeof windowKey, number> = {
      "1D": 1 * day,
      "1W": 7 * day,
      "1M": 30 * day,
      "3M": 90 * day,
      "6M": 180 * day,
      "1Y": 365 * day,
      "3Y": 3 * 365 * day,
      "5Y": 5 * 365 * day,
    };
    return nowMs - map[windowKey];
  }, [windowKey, nowMs]);

  const chartData = useMemo(() => {
    if (windowKey === "1D") {
      const p = today?.portfolioPct ?? null;
      const spy = today?.SPY ?? null;
      const qqq = today?.QQQ ?? null;
      return [
        {
          asOf: "start",
          asOfLabel: "Start",
          portfolio: 0,
          portfolioPos: 0,
          portfolioNeg: 0,
          SPY: 0,
          SPYPos: 0,
          SPYNeg: 0,
          QQQ: 0,
          QQQPos: 0,
          QQQNeg: 0,
        },
        {
          asOf: "now",
          asOfLabel: "Now",
          portfolio: p ?? 0,
          portfolioPos: Math.max(0, p ?? 0),
          portfolioNeg: Math.min(0, p ?? 0),
          SPY: spy ?? 0,
          SPYPos: Math.max(0, spy ?? 0),
          SPYNeg: Math.min(0, spy ?? 0),
          QQQ: qqq ?? 0,
          QQQPos: Math.max(0, qqq ?? 0),
          QQQNeg: Math.min(0, qqq ?? 0),
        },
      ];
    }
    if (series.length === 0) return [];
    const filtered = series.filter((p) => new Date(p.asOf).getTime() >= windowStartMs);
    if (filtered.length === 0) return [];
    const start = filtered[0]!.totalMarketValue || 1;
    const startIso = new Date(filtered[0]!.asOf).toISOString().slice(0, 10);

    // Helper to find closest benchmark close on or before the date.
    const baselineClose = (sym: string) => {
      const s = bench[sym] ?? [];
      if (s.length === 0) return null;
      let lo = 0;
      let hi = s.length - 1;
      let idx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (s[mid]!.date <= startIso) {
          idx = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (idx < 0) return null;
      const c = s[idx]!.close;
      return Number.isFinite(c) && c > 0 ? c : null;
    };

    const baseline = {
      SPY: baselineClose("SPY"),
      QQQ: baselineClose("QQQ"),
    };

    const getBenchPct = (sym: "SPY" | "QQQ", isoDate: string) => {
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
      const base = baseline[sym];
      if (base == null) return null;
      const close = s[idx]!.close;
      if (!Number.isFinite(close) || close <= 0) return null;
      return ((close / base) - 1) * 100;
    };

    return filtered.map((p) => {
      const isoDate = new Date(p.asOf).toISOString().slice(0, 10);
      const portfolio = ((p.totalMarketValue / start) - 1) * 100;
      const spy = getBenchPct("SPY", isoDate);
      const qqq = getBenchPct("QQQ", isoDate);
      return {
        asOf: p.asOf,
        asOfLabel: new Date(p.asOf).toLocaleDateString(),
        portfolio,
        portfolioPos: Math.max(0, portfolio),
        portfolioNeg: Math.min(0, portfolio),
        SPY: spy,
        SPYPos: spy == null ? null : Math.max(0, spy),
        SPYNeg: spy == null ? null : Math.min(0, spy),
        QQQ: qqq,
        QQQPos: qqq == null ? null : Math.max(0, qqq),
        QQQNeg: qqq == null ? null : Math.min(0, qqq),
      };
    });
  }, [series, bench, windowStartMs, windowKey, today]);

  const COLORS = {
    portfolio: "#0f766e",
    SPY: "#2563eb",
    QQQ: "#7c3aed",
  } as const;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Performance</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Time series is built from holdings snapshots created on each sync (and account balance points when available).
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/connections"
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            Connections
          </Link>
          <Link
            href="/allocation"
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            Allocation
          </Link>
        </div>
      </div>

      <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm font-medium">Bucket</div>
            {(["combined", "retirement", "brokerage"] as const).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBucket(b)}
                className={
                  "rounded-full px-4 py-2 text-sm font-medium " +
                  (bucket === b
                    ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                    : "border border-zinc-300 bg-white text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5")
                }
              >
                {b === "combined" ? "Combined" : b === "retirement" ? "Retirement" : "Brokerage"}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-medium">Window</div>
            {(["1D", "1W", "1M", "3M", "6M", "1Y", "3Y", "5Y"] as const).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWindowKey(w)}
                className={
                  "rounded-full px-3 py-1.5 text-sm font-medium " +
                  (windowKey === w
                    ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                    : "border border-zinc-300 bg-white text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5")
                }
              >
                {w}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-4 text-sm text-zinc-600 dark:text-zinc-400">
          <div className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS.portfolio }} />
            <span>Portfolio</span>
          </div>
          <div className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS.SPY }} />
            <span>SPY</span>
          </div>
          <div className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS.QQQ }} />
            <span>QQQ</span>
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
                <YAxis tickFormatter={(v) => `${Number(v).toFixed(0)}%`} />
                <ReferenceLine y={0} stroke="rgba(113,113,122,0.6)" />
                <Tooltip
                  formatter={(v) => `${Number(v).toFixed(2)}%`}
                  labelFormatter={(l) => String(l)}
                />
                <Area
                  type="monotone"
                  dataKey="portfolioPos"
                  name="Portfolio (above)"
                  stroke="none"
                  fill="rgba(16,185,129,0.18)"
                  baseValue={0}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="portfolioNeg"
                  name="Portfolio (below)"
                  stroke="none"
                  fill="rgba(239,68,68,0.18)"
                  baseValue={0}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="SPYPos"
                  name="SPY (above)"
                  stroke="none"
                  fill="rgba(16,185,129,0.10)"
                  baseValue={0}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="SPYNeg"
                  name="SPY (below)"
                  stroke="none"
                  fill="rgba(239,68,68,0.10)"
                  baseValue={0}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="QQQPos"
                  name="QQQ (above)"
                  stroke="none"
                  fill="rgba(16,185,129,0.10)"
                  baseValue={0}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="QQQNeg"
                  name="QQQ (below)"
                  stroke="none"
                  fill="rgba(239,68,68,0.10)"
                  baseValue={0}
                  isAnimationActive={false}
                />
                <Line type="monotone" dataKey="portfolio" name="Portfolio" strokeWidth={2} dot={false} stroke={COLORS.portfolio} />
                <Line type="monotone" dataKey="SPY" name="SPY" strokeWidth={2} dot={false} stroke={COLORS.SPY} />
                <Line type="monotone" dataKey="QQQ" name="QQQ" strokeWidth={2} dot={false} stroke={COLORS.QQQ} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    </div>
  );
}

