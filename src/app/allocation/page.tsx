"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

type ExposureRow = {
  underlyingSymbol: string;
  spotMarketValue: number;
  syntheticMarketValue: number;
  syntheticShares: number;
};

type PieMetric = "spot" | "synthetic" | "net";

function sliceMv(r: ExposureRow, metric: PieMetric): number {
  switch (metric) {
    case "spot":
      return r.spotMarketValue;
    case "synthetic":
      return r.syntheticMarketValue;
    case "net":
      return r.spotMarketValue + r.syntheticMarketValue;
    default:
      return 0;
  }
}

const PIE_METRIC_LABEL: Record<PieMetric, string> = {
  spot: "Spot",
  synthetic: "Synthetic",
  net: "Net",
};

/** Second line of pie card title when weight mode is not full net. */
function pieMetricChartSubtitle(metric: PieMetric): string {
  switch (metric) {
    case "spot":
      return "Spot";
    case "synthetic":
      return "Synthetic";
    case "net":
      return "Spot + synthetic";
    default:
      return "";
  }
}

/** Compact segment controls: equal columns, right-aligned in row. */
const BTN_CLASSES =
  "flex h-8 w-full min-w-0 items-center justify-center whitespace-nowrap rounded-md px-2 text-xs font-semibold tracking-tight";

export default function AllocationPage() {
  const [rows, setRows] = useState<ExposureRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pieView, setPieView] = useState<"net" | "retirement" | "brokerage">("net");
  const [pieMetric, setPieMetric] = useState<PieMetric>("net");
  const [assetClass, setAssetClass] = useState<Array<{ key: string; marketValue: number; weight: number }>>([]);
  const [accounts, setAccounts] = useState<
    Array<{
      accountId: string;
      accountName: string;
      totalMarketValue: number;
      byAssetClass: Array<{ key: string; marketValue: number; weight: number }>;
    }>
  >([]);
  const [bucketed, setBucketed] = useState<
    Array<{
      bucketKey: "brokerage" | "retirement";
      totalMarketValue: number;
      byAssetClass: Array<{ key: string; marketValue: number; weight: number }>;
    }>
  >([]);
  const [exposureBuckets, setExposureBuckets] = useState<
    Array<{
      bucketKey: "brokerage" | "retirement";
      exposure: ExposureRow[];
    }>
  >([]);

  useEffect(() => {
    (async () => {
      setError(null);
      const [expResp, allocResp] = await Promise.all([
        fetch("/api/exposure"),
        fetch(`/api/allocation?synthetic=1`),
      ]);
      const acctResp = await fetch(`/api/allocation/accounts?synthetic=1`);
      const bucketResp = await fetch(`/api/allocation/buckets?synthetic=1`);
      const exposureBucketResp = await fetch(`/api/exposure/buckets`);

      async function safeJson(resp: Response) {
        const text = await resp.text();
        try {
          return JSON.parse(text) as any;
        } catch {
          const url = resp.url || "(unknown url)";
          throw new Error(
            `Non-JSON response (${resp.status}) from ${url}: ${text ? text.slice(0, 300) : "(empty body)"}`,
          );
        }
      }

      const expJson = (await safeJson(expResp)) as { ok: boolean; exposure?: ExposureRow[]; error?: string };
      if (!expJson.ok) throw new Error(expJson.error ?? "Failed to load exposure");
      setRows(expJson.exposure ?? []);

      const allocJson = (await safeJson(allocResp)) as {
        ok: boolean;
        byAssetClass?: Array<{ key: string; marketValue: number; weight: number }>;
        error?: string;
      };
      if (!allocJson.ok) throw new Error(allocJson.error ?? "Failed to load allocation");
      setAssetClass(allocJson.byAssetClass ?? []);

      const acctJson = (await safeJson(acctResp)) as {
        ok: boolean;
        accounts?: Array<{
          accountId: string;
          accountName: string;
          totalMarketValue: number;
          byAssetClass: Array<{ key: string; marketValue: number; weight: number }>;
        }>;
        error?: string;
      };
      if (!acctJson.ok) throw new Error(acctJson.error ?? "Failed to load account allocation");
      setAccounts(acctJson.accounts ?? []);

      const bucketJson = (await safeJson(bucketResp)) as {
        ok: boolean;
        buckets?: Array<{
          bucketKey: "brokerage" | "retirement";
          totalMarketValue: number;
          byAssetClass: Array<{ key: string; marketValue: number; weight: number }>;
        }>;
        error?: string;
      };
      if (!bucketJson.ok) throw new Error(bucketJson.error ?? "Failed to load bucket allocation");
      setBucketed(bucketJson.buckets ?? []);

      const expBucketJson = (await safeJson(exposureBucketResp)) as {
        ok: boolean;
        buckets?: Array<{ bucketKey: "brokerage" | "retirement"; exposure: ExposureRow[] }>;
        error?: string;
      };
      if (!expBucketJson.ok) throw new Error(expBucketJson.error ?? "Failed to load exposure buckets");
      setExposureBuckets(expBucketJson.buckets ?? []);
    })().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  /** Sum of spot + synthetic per underlying (full net); used for exposure table total and % column. */
  const totalNetExposure = useMemo(() => {
    let total = 0;
    for (const r of rows) total += r.spotMarketValue + r.syntheticMarketValue;
    return total;
  }, [rows]);

  /** Denominator for the pie chart for the active metric (spot, synthetic, or net). */
  const pieTotalCombined = useMemo(
    () => rows.reduce((s, r) => s + sliceMv(r, pieMetric), 0),
    [rows, pieMetric],
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Allocation</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Exposure by underlying; pie chart switches Spot, Synthetic, or Net weights. Asset-class tables include delta-weighted option exposure in equities.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/connections"
            className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            Connections
          </Link>
        </div>
      </div>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-zinc-950">
        <div className="flex flex-wrap items-center justify-end gap-4">
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            Total (net):{" "}
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              ${totalNetExposure.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        ) : null}

        <div className="mt-5 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-600 dark:border-white/10 dark:text-zinc-400">
                <th className="py-2 pr-4 font-medium">Underlying</th>
                <th className="py-2 pr-4 font-medium">Spot MV</th>
                <th className="py-2 pr-4 font-medium">Synthetic MV</th>
                <th className="py-2 pr-4 font-medium">Net MV</th>
                <th className="py-2 pr-4 font-medium">Synthetic shares</th>
                <th className="py-2 pr-4 font-medium">% of total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const netMv = r.spotMarketValue + r.syntheticMarketValue;
                const pct = totalNetExposure ? netMv / totalNetExposure : 0;
                return (
                  <tr key={r.underlyingSymbol} className="border-b border-zinc-100 dark:border-white/5">
                    <td className="py-2 pr-4 font-medium">{r.underlyingSymbol}</td>
                    <td className="py-2 pr-4 tabular-nums">
                      ${r.spotMarketValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td className="py-2 pr-4 tabular-nums">
                      ${r.syntheticMarketValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td className="py-2 pr-4 tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
                      ${netMv.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td className="py-2 pr-4 tabular-nums">{r.syntheticShares.toFixed(2)}</td>
                    <td className="py-2 pr-4 tabular-nums">{(pct * 100).toFixed(2)}%</td>
                  </tr>
                );
              })}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-zinc-600 dark:text-zinc-400">
                    No data yet. Connect Schwab and run a sync.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-zinc-950">
        <h2 className="text-base font-semibold">Weighting (pie charts)</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Color-coded by symbol. Choose account scope, then whether slices use spot, synthetic, or net dollars.
        </p>

        <div className="mt-4 overflow-hidden rounded-xl ring-1 ring-zinc-200 dark:ring-white/10">
          <div className="flex items-center justify-between gap-4 border-b border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-white/10 dark:bg-zinc-900/40">
            <h3 className="m-0 min-w-0 shrink text-base font-semibold">Accounts</h3>
            <div className="grid w-max max-w-full grid-cols-3 gap-1.5 sm:min-w-[15.75rem]">
              {([
                { key: "net", label: "Net" },
                { key: "brokerage", label: "Brokerage" },
                { key: "retirement", label: "Retirement" },
              ] as const).map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => setPieView(v.key)}
                  className={
                    BTN_CLASSES +
                    " min-w-[5rem] shadow-sm " +
                    (pieView === v.key
                      ? "bg-zinc-900 text-white shadow dark:bg-white dark:text-zinc-900"
                      : "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900")
                  }
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 bg-white px-4 py-3 dark:bg-zinc-950/60">
            <h3 className="m-0 min-w-0 shrink text-base font-semibold">Pie weights</h3>
            <div className="grid w-max max-w-full grid-cols-3 gap-1.5 sm:min-w-[15.75rem]">
              {(["net", "spot", "synthetic"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPieMetric(m)}
                  className={
                    BTN_CLASSES +
                    " min-w-[5rem] shadow-sm " +
                    (pieMetric === m
                      ? "bg-zinc-900 text-white shadow dark:bg-white dark:text-zinc-900"
                      : "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900")
                  }
                >
                  {PIE_METRIC_LABEL[m]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-3">
          {pieView === "net" ? (
            <PiePanel
              title={`Net · ${pieMetricChartSubtitle(pieMetric)}`}
              buckets={[
                {
                  label: "all",
                  totalMarketValue: pieTotalCombined,
                  byAsset: rows.map((r) => {
                    const mv = sliceMv(r, pieMetric);
                    return {
                      key: r.underlyingSymbol,
                      marketValue: mv,
                      weight: pieTotalCombined ? mv / pieTotalCombined : 0,
                    };
                  }),
                },
              ]}
            />
          ) : (
            <PiePanel
              title={`${pieView === "retirement" ? "Retirement" : "Brokerage"} · ${pieMetricChartSubtitle(pieMetric)}`}
              buckets={exposureBuckets
                .filter((b) => b.bucketKey === pieView)
                .map((b) => {
                  const total = b.exposure.reduce((s, r) => s + sliceMv(r, pieMetric), 0);
                  return {
                    label: b.bucketKey,
                    totalMarketValue: total,
                    byAsset: b.exposure.map((r) => {
                      const mv = sliceMv(r, pieMetric);
                      return {
                        key: r.underlyingSymbol,
                        marketValue: mv,
                        weight: total ? mv / total : 0,
                      };
                    }),
                  };
                })}
            />
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-zinc-950">
        <h2 className="text-base font-semibold">By asset class</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-600 dark:border-white/10 dark:text-zinc-400">
                <th className="py-2 pr-4 font-medium">Class</th>
                <th className="py-2 pr-4 font-medium">Market value</th>
                <th className="py-2 pr-4 font-medium">Weight</th>
              </tr>
            </thead>
            <tbody>
              {assetClass.map((b) => (
                <tr key={b.key} className="border-b border-zinc-100 dark:border-white/5">
                  <td className="py-2 pr-4 font-medium">{b.key}</td>
                  <td className="py-2 pr-4 tabular-nums">
                    ${b.marketValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">{(b.weight * 100).toFixed(2)}%</td>
                </tr>
              ))}
              {assetClass.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-zinc-600 dark:text-zinc-400">
                    No allocation data yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-zinc-950">
        <h2 className="text-base font-semibold">By account</h2>
        <div className="mt-4 grid gap-4">
          {accounts.map((a) => (
            <details
              key={a.accountId}
              className="rounded-xl border border-zinc-200 p-4 open:bg-zinc-50 dark:border-white/10 dark:open:bg-black/30"
            >
              <summary className="cursor-pointer list-none">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm font-semibold">{a.accountName}</div>
                  <div className="text-sm text-zinc-600 dark:text-zinc-400">
                    ${a.totalMarketValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </div>
                </div>
              </summary>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-zinc-600 dark:border-white/10 dark:text-zinc-400">
                      <th className="py-2 pr-4 font-medium">Class</th>
                      <th className="py-2 pr-4 font-medium">Market value</th>
                      <th className="py-2 pr-4 font-medium">Weight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.byAssetClass.map((b) => (
                      <tr key={b.key} className="border-b border-zinc-100 dark:border-white/5">
                        <td className="py-2 pr-4 font-medium">{b.key}</td>
                        <td className="py-2 pr-4 tabular-nums">
                          ${b.marketValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </td>
                        <td className="py-2 pr-4 tabular-nums">{(b.weight * 100).toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
          {accounts.length === 0 ? (
            <div className="text-sm text-zinc-600 dark:text-zinc-400">No accounts yet.</div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function renderSliceLabel(props: any) {
  // Recharts passes x/y at outerRadius + offsetRadius (default 20px) so label lines meet the text.
  const { cx, percent, name, x, y } = props as {
    cx: number;
    percent: number;
    name: string;
    x: number;
    y: number;
  };

  const textAnchor = x >= cx ? "start" : "end";
  const pct = `${(percent * 100).toFixed(1)}%`;

  return (
    <text
      x={x}
      y={y}
      textAnchor={textAnchor}
      dominantBaseline="central"
      className="fill-zinc-700 text-xl font-semibold dark:fill-zinc-200"
    >
      {name} {pct}
    </text>
  );
}

const PALETTE = [
  "#2563eb",
  "#7c3aed",
  "#16a34a",
  "#f59e0b",
  "#ef4444",
  "#0ea5e9",
  "#22c55e",
  "#a855f7",
  "#eab308",
  "#f97316",
  "#14b8a6",
  "#64748b",
];

function colorForKey(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

function formatUsd(v: number) {
  return `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function PiePanel({
  title,
  buckets,
}: {
  title: string;
  buckets: Array<{
    label: string;
    totalMarketValue: number;
    byAsset: Array<{ key: string; marketValue: number; weight: number }>;
  }>;
}) {
  const b = buckets[0];
  // Alphabetical order keeps each symbol in the same place around the pie when weights change;
  // only arc sizes change (sorting by value would reshuffle wedges).
  const data = (b?.byAsset ?? [])
    .filter((x) => x.marketValue > 0)
    .sort((a, b) => a.key.localeCompare(b.key));
  const total = b?.totalMarketValue ?? 0;

  return (
    <div className="rounded-xl border border-zinc-200 p-4 dark:border-white/10">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-sm text-zinc-600 dark:text-zinc-400">{formatUsd(total)}</div>
      </div>

      <div className="mt-4 h-[36rem] w-full">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-600 dark:text-zinc-400">
            No data yet.
          </div>
        ) : (
          <ResponsiveContainer>
            <PieChart>
              <Tooltip
                formatter={(value: any, _name: any, props: any) => {
                  const mv = Number(value);
                  const pct = total ? mv / total : 0;
                  return `${formatUsd(mv)} (${(pct * 100).toFixed(2)}%)`;
                }}
              />
              <Pie
                data={data}
                dataKey="marketValue"
                nameKey="key"
                stroke="none"
                isAnimationActive={false}
                innerRadius={84}
                outerRadius={255}
                paddingAngle={0.5}
                labelLine={{
                  stroke: "#a1a1aa",
                  strokeWidth: 1.5,
                }}
                label={renderSliceLabel}
              >
                {data.map((entry) => (
                  <Cell key={entry.key} fill={colorForKey(entry.key)} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* labels are rendered on the chart */}
    </div>
  );
}

