"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { usePrivacy } from "@/app/components/PrivacyProvider";
import { formatUsd2 } from "@/lib/format";

type Row = { symbol: string; lastMonth: number; nextMonth: number; nextYearProjected: number };
type Summary = { lastMonth: number; nextMonth: number; nextYearProjected: number; bySecurity: Row[] };
type MonthPoint = { month: string; actual: number; projected: number };

function usdMasked(v: number, masked: boolean) {
  return formatUsd2(v, { mask: masked });
}

export default function DividendsPage() {
  const privacy = usePrivacy();
  const [data, setData] = useState<Summary | null>(null);
  const [series, setSeries] = useState<MonthPoint[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [sResp, tResp] = await Promise.all([
        fetch("/api/dividends/summary"),
        fetch("/api/dividends/timeseries?back=12&fwd=12"),
      ]);
      const json = (await sResp.json()) as { ok: boolean; error?: string } & Partial<Summary>;
      if (!json.ok) throw new Error(json.error ?? "Failed to load dividends");
      setData({
        lastMonth: json.lastMonth ?? 0,
        nextMonth: json.nextMonth ?? 0,
        nextYearProjected: json.nextYearProjected ?? 0,
        bySecurity: json.bySecurity ?? [],
      });

      const tJson = (await tResp.json()) as { ok: boolean; error?: string; series?: MonthPoint[] };
      if (!tJson.ok) throw new Error(tJson.error ?? "Failed to load dividend timeseries");
      setSeries(tJson.series ?? []);
    })().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const chart = useMemo(
    () =>
      series.reduce(
        (acc, p) => {
          const prevCum = acc.length ? acc[acc.length - 1]!.cumulativeActual : 0;
          acc.push({
            ...p,
            label: p.month,
            cumulativeActual: prevCum + (p.actual ?? 0),
          });
          return acc;
        },
        [] as Array<MonthPoint & { label: string; cumulativeActual: number }>,
      ),
    [series],
  );

  return (
    <div className="flex w-full max-w-6xl flex-1 flex-col gap-6 py-8 pl-4 pr-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dividends</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Uses local cashflow storage; broker transactions wiring is coming later.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card title="Previous month" value={usdMasked(data?.lastMonth ?? 0, privacy.masked)} />
        <Card title="Next month (expected)" value={usdMasked(data?.nextMonth ?? 0, privacy.masked)} />
        <Card title="Projected next year" value={usdMasked(data?.nextYearProjected ?? 0, privacy.masked)} />
      </div>

      <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <h2 className="text-base font-semibold">Trend (monthly)</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Actual dividends vs projected, rolled up by pay month.
        </p>
        <div className="mt-4 h-80 w-full min-w-0">
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={0}
            minHeight={320}
            initialDimension={{ width: 400, height: 320 }}
          >
            <ComposedChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={false} />
              <YAxis yAxisId="left" tickFormatter={(v) => usdMasked(Number(v), privacy.masked)} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => usdMasked(Number(v), privacy.masked)} />
              <Tooltip formatter={(v) => usdMasked(Number(v), privacy.masked)} />
              <Legend />
              <Bar yAxisId="left" dataKey="actual" name="Actual" fill="#16a34a" />
              <Bar yAxisId="left" dataKey="projected" name="Projected" fill="#7c3aed" />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="cumulativeActual"
                name="Cumulative received"
                stroke="#2563eb"
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <h2 className="text-base font-semibold">By security</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-300 text-left text-zinc-600 dark:border-white/20 dark:text-zinc-400">
                <th className="py-2 pr-4 font-medium">Symbol</th>
                <th className="py-2 pr-4 text-right font-medium">Prev month</th>
                <th className="py-2 pr-4 text-right font-medium">Next month</th>
                <th className="py-2 pr-4 text-right font-medium">Next year (proj)</th>
              </tr>
            </thead>
            <tbody>
              {(data?.bySecurity ?? []).map((r) => (
                <tr key={r.symbol} className="border-b border-zinc-200 dark:border-white/20">
                  <td className="py-2 pr-4 font-medium">{r.symbol}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{usdMasked(r.lastMonth, privacy.masked)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{usdMasked(r.nextMonth, privacy.masked)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{usdMasked(r.nextYearProjected, privacy.masked)}</td>
                </tr>
              ))}
              {(data?.bySecurity?.length ?? 0) === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-zinc-600 dark:text-zinc-400">
                    No dividend data yet. Run Schwab sync on Connections.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Card({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border border-zinc-300 bg-white p-5 shadow-sm dark:border-white/20 dark:bg-zinc-950">
      <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{title}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

