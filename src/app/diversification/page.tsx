"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { FinancePiePanel } from "@/app/components/FinancePiePanel";
import { usePrivacy } from "@/app/components/PrivacyProvider";
import { formatUsd2 } from "@/lib/format";
import { taxonomyForSymbol as demoTaxonomyForSymbol } from "@/lib/demoTaxonomy";

type TaxonomyCategory = "sector" | "marketCap" | "revenueGeo";

type TaxonomyRow = {
  sector: string | null;
  industry: string | null;
  marketCapBucket: string | null;
  revenueGeoBucket: string | null;
  source: string | null;
  updatedAt: string;
};

function taxonomyBucket(map: Map<string, TaxonomyRow>, sym: string, category: TaxonomyCategory): string {
  const s = (sym ?? "").trim().toUpperCase();
  const t = map.get(s);
  const fallback = demoTaxonomyForSymbol(s);
  if (!t) return category === "sector" ? fallback.sector : category === "marketCap" ? fallback.marketCap : fallback.revenueGeo;
  if (category === "sector") return t.sector ?? fallback.sector;
  if (category === "marketCap") return t.marketCapBucket ?? fallback.marketCap;
  return t.revenueGeoBucket ?? fallback.revenueGeo;
}

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

const PCT2 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function usd2Masked(v: number, masked: boolean) {
  return formatUsd2(v, { mask: masked });
}

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

const BTN_CLASSES =
  "flex h-8 w-full min-w-0 items-center justify-center whitespace-nowrap rounded-md px-2 text-xs font-semibold tracking-tight";

type RolledSlice = {
  key: string;
  mv: number;
  weight: number;
  constituents: Array<{ symbol: string; marketValue: number }>;
};

function rollupCategory(
  rows: ExposureRow[],
  category: TaxonomyCategory,
  metric: PieMetric,
  tax: Map<string, TaxonomyRow>,
): { total: number; rows: RolledSlice[] } {
  const m = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const mv = sliceMv(r, metric);
    if (mv === 0) continue;
    const k = taxonomyBucket(tax, r.underlyingSymbol, category);
    const sym = r.underlyingSymbol.trim().toUpperCase();
    const inner = m.get(k) ?? new Map<string, number>();
    inner.set(sym, (inner.get(sym) ?? 0) + mv);
    m.set(k, inner);
  }
  const total = Array.from(m.values()).reduce(
    (acc, inner) => acc + Array.from(inner.values()).reduce((a, b) => a + b, 0),
    0,
  );
  const rowsOut = Array.from(m.entries())
    .map(([key, inner]) => {
      const mv = Array.from(inner.values()).reduce((a, b) => a + b, 0);
      const constituents = Array.from(inner.entries())
        .map(([symbol, marketValue]) => ({ symbol, marketValue }))
        .filter((c) => c.marketValue > 0)
        .sort((a, b) => b.marketValue - a.marketValue || a.symbol.localeCompare(b.symbol));
      return { key, mv, weight: total ? mv / total : 0, constituents };
    })
    .sort((a, b) => b.mv - a.mv || a.key.localeCompare(b.key));
  return { total, rows: rowsOut };
}

export default function DiversificationPage() {
  const privacy = usePrivacy();
  const [rows, setRows] = useState<ExposureRow[]>([]);
  const [exposureBuckets, setExposureBuckets] = useState<
    Array<{ bucketKey: "brokerage" | "retirement"; exposure: ExposureRow[] }>
  >([]);
  const [tax, setTax] = useState<Map<string, TaxonomyRow>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<TaxonomyCategory>("sector");
  const [pieView, setPieView] = useState<"net" | "retirement" | "brokerage">("net");
  const [pieMetric, setPieMetric] = useState<PieMetric>("net");

  useEffect(() => {
    void (async () => {
      setError(null);
      try {
        const [expResp, bucketResp] = await Promise.all([fetch("/api/exposure"), fetch("/api/exposure/buckets")]);
        async function safeJson(resp: Response) {
          const text = await resp.text();
          try {
            return JSON.parse(text) as unknown;
          } catch {
            const url = resp.url || "(unknown url)";
            throw new Error(`Non-JSON response (${resp.status}) from ${url}: ${text ? text.slice(0, 300) : "(empty body)"}`);
          }
        }
        const expJson = (await safeJson(expResp)) as { ok: boolean; exposure?: ExposureRow[]; error?: string };
        if (!expJson.ok) throw new Error(expJson.error ?? "Failed to load exposure");
        setRows(expJson.exposure ?? []);

        // Best-effort taxonomy warm-up (non-blocking for UI correctness).
        const syms = Array.from(new Set((expJson.exposure ?? []).map((r) => r.underlyingSymbol)));
        void (async () => {
          try {
            await fetch("/api/taxonomy/sync", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ symbols: syms }),
            });
            const txResp = await fetch(`/api/taxonomy?symbols=${encodeURIComponent(syms.join(","))}`, { cache: "no-store" });
            const txJson = (await txResp.json()) as { ok: boolean; taxonomy?: Record<string, TaxonomyRow> };
            const m = new Map<string, TaxonomyRow>();
            for (const [k, v] of Object.entries(txJson.taxonomy ?? {})) m.set(k.toUpperCase(), v);
            setTax(m);
          } catch {
            // ignore
          }
        })();

        const bJson = (await safeJson(bucketResp)) as {
          ok: boolean;
          buckets?: Array<{ bucketKey: "brokerage" | "retirement"; exposure: ExposureRow[] }>;
          error?: string;
        };
        if (!bJson.ok) throw new Error(bJson.error ?? "Failed to load exposure buckets");
        setExposureBuckets(bJson.buckets ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const scopedRows = useMemo(() => {
    if (pieView === "net") return rows;
    const b = exposureBuckets.find((x) => x.bucketKey === pieView);
    return b?.exposure ?? [];
  }, [rows, exposureBuckets, pieView]);

  const rolled = useMemo(() => rollupCategory(scopedRows, category, pieMetric, tax), [scopedRows, category, pieMetric, tax]);

  const pieTotal = rolled.total;

  const categoryTitle =
    category === "sector" ? "Sector" : category === "marketCap" ? "Market cap" : "Revenue geography";

  const scopeTitle = pieView === "net" ? "Net" : pieView === "brokerage" ? "Brokerage" : "Retirement";

  return (
    <div className="flex w-full max-w-6xl flex-1 flex-col gap-6 py-8 pl-4 pr-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Diversification</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Sector / market cap / revenue geography with the same account and pie-weight controls as Allocation.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/connections"
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            Connections
          </Link>
        </div>
      </div>

      <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <h2 className="text-base font-semibold">Category</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Choose what each pie slice represents.</p>
        <div className="mt-3 grid w-max max-w-full grid-cols-3 gap-1.5 sm:min-w-[15.75rem]">
          {(
            [
              { key: "sector", label: "Sector" },
              { key: "marketCap", label: "Market cap" },
              { key: "revenueGeo", label: "Revenue geo" },
            ] as const
          ).map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCategory(c.key)}
              className={
                BTN_CLASSES +
                " min-w-[5rem] shadow-sm " +
                (category === c.key
                  ? "bg-zinc-900 text-white shadow dark:bg-white dark:text-zinc-900"
                  : "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900")
              }
            >
              {c.label}
            </button>
          ))}
        </div>

        {error ? (
          <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        ) : null}

        <div className="mt-4">
          <FinancePiePanel
            title={`${scopeTitle} · ${categoryTitle} · ${pieMetricChartSubtitle(pieMetric)}`}
            buckets={[
              {
                label: "tax",
                totalMarketValue: pieTotal,
                byAsset: rolled.rows.map((r) => ({
                  key: r.key,
                  marketValue: r.mv,
                  weight: pieTotal ? r.mv / pieTotal : 0,
                  constituents: r.constituents,
                })),
              },
            ]}
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-b border-zinc-200 pb-4 dark:border-white/15">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Scope</div>
            <div className="grid w-max max-w-full grid-cols-3 gap-1.5 sm:min-w-[15.75rem]">
              {(
                [
                  { key: "net", label: "Net" },
                  { key: "brokerage", label: "Brokerage" },
                  { key: "retirement", label: "Retirement" },
                ] as const
              ).map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => setPieView(v.key)}
                  className={
                    BTN_CLASSES +
                    " min-w-[5rem] shadow-sm " +
                    (pieView === v.key
                      ? "bg-zinc-900 text-white shadow dark:bg-white dark:text-zinc-900"
                      : "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900")
                  }
                >
                  {v.label}
                </button>
              ))}
            </div>

            <div className="ml-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">Weights</div>
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
                      : "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900")
                  }
                >
                  {PIE_METRIC_LABEL[m]}
                </button>
              ))}
            </div>
          </div>

          <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            {scopeTitle} · {PIE_METRIC_LABEL[pieMetric]}
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border border-zinc-300 dark:border-white/20">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-300 text-left text-zinc-600 dark:border-white/20 dark:text-zinc-400">
                <th className="px-3 py-2 font-medium">Bucket</th>
                <th className="px-3 py-2 text-right font-medium">
                  {pieMetric === "spot" ? "Spot MV" : pieMetric === "synthetic" ? "Synthetic MV" : "Net MV"}
                </th>
                <th className="px-3 py-2 text-right font-medium">Weight</th>
              </tr>
            </thead>
            <tbody>
              {rolled.rows.map((r) => (
                <tr key={r.key} className="border-b border-zinc-200 last:border-0 dark:border-white/20">
                  <td className="px-3 py-2 font-medium">{r.key}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{usd2Masked(r.mv, privacy.masked)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{PCT2.format(r.weight * 100)}%</td>
                </tr>
              ))}
              {rolled.rows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-zinc-600 dark:text-zinc-400">
                    No data yet.
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
