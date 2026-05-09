"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AccountPositionsForAllocation } from "@/app/components/AccountPositionsForAllocation";
import { FinancePiePanel } from "@/app/components/FinancePiePanel";
import { useEquityMarketPolling } from "@/hooks/useEquityMarketPolling";
import { usePrivacy } from "@/app/components/PrivacyProvider";
import { formatUsd2 } from "@/lib/format";

type ExposureRow = {
  underlyingSymbol: string;
  spotMarketValue: number;
  heldShares: number;
  syntheticMarketValue: number;
  syntheticShares: number;
};

type SortColumn = "underlying" | "spot" | "synthetic" | "net" | "syntheticShares" | "heldShares" | "netShares" | "pct";
type ClassSortColumn = "key" | "mv" | "weight";

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

function netShares(r: ExposureRow) {
  return (r.heldShares ?? 0) + (r.syntheticShares ?? 0);
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

function negClass(v: number) {
  return v < 0 ? "text-red-600 dark:text-red-400" : "";
}

function SortTh<T extends string>({
  col,
  label,
  sortColumn,
  sortAsc,
  onToggle,
  className,
}: {
  col: T;
  label: string;
  sortColumn: T;
  sortAsc: boolean;
  onToggle: (col: T) => void;
  className?: string;
}) {
  const active = sortColumn === col;
  const arrow = active ? (sortAsc ? " ▲" : " ▼") : "";
  const ariaSort = active ? (sortAsc ? "ascending" : "descending") : "none";
  return (
    <th className={className} aria-sort={ariaSort}>
      <button
        type="button"
        onClick={() => onToggle(col)}
        className="inline-flex items-center gap-1 hover:underline underline-offset-4"
      >
        <span>{label}</span>
        <span className="text-[10px] opacity-70">{arrow}</span>
      </button>
    </th>
  );
}

function AccountAssetClassTable({
  rows,
  masked,
}: {
  rows: Array<{ key: string; marketValue: number; weight: number }>;
  masked: boolean;
}) {
  const [col, setCol] = useState<ClassSortColumn>("mv");
  const [asc, setAsc] = useState(false);

  function toggle(c: ClassSortColumn) {
    if (col === c) setAsc(!asc);
    else {
      setCol(c);
      setAsc(c === "key" ? true : false);
    }
  }

  const totalMv = useMemo(() => rows.reduce((s, r) => s + (r.marketValue ?? 0), 0), [rows]);

  const sorted = useMemo(() => {
    const a = [...rows];
    a.sort((x, y) => {
      let cmp = 0;
      switch (col) {
        case "key":
          cmp = x.key.localeCompare(y.key, undefined, { numeric: true, sensitivity: "base" });
          break;
        case "mv":
          cmp = x.marketValue - y.marketValue;
          break;
        case "weight":
          cmp = x.weight - y.weight;
          break;
      }
      if (cmp === 0) cmp = x.key.localeCompare(y.key);
      return asc ? cmp : -cmp;
    });
    return a;
  }, [rows, col, asc]);

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-zinc-300 text-left text-zinc-600 dark:border-white/20 dark:text-zinc-400">
          <SortTh
            col="key"
            label="Class"
            sortColumn={col}
            sortAsc={asc}
            onToggle={toggle}
            className="py-2 pr-4 font-medium"
          />
          <SortTh
            col="mv"
            label="Market value"
            sortColumn={col}
            sortAsc={asc}
            onToggle={toggle}
            className="py-2 pr-4 text-right font-medium"
          />
          <SortTh
            col="weight"
            label="Weight"
            sortColumn={col}
            sortAsc={asc}
            onToggle={toggle}
            className="py-2 pr-4 text-right font-medium"
          />
        </tr>
      </thead>
      <tbody>
        {rows.length ? (
          <tr className="border-b border-zinc-200 bg-zinc-50/60 font-semibold text-zinc-900 dark:border-white/20 dark:bg-white/5 dark:text-zinc-100">
            <td className="py-2 pr-4">TOTAL</td>
            <td className="py-2 pr-4 text-right tabular-nums">{usd2Masked(totalMv, masked)}</td>
            <td className="py-2 pr-4 text-right tabular-nums">100.00%</td>
          </tr>
        ) : null}
        {sorted.map((b) => (
          <tr key={b.key} className="border-b border-zinc-200 dark:border-white/20">
            <td className="py-2 pr-4 font-medium">{b.key}</td>
            <td className={"py-2 pr-4 text-right tabular-nums " + negClass(b.marketValue)}>{usd2Masked(b.marketValue, masked)}</td>
            <td className="py-2 pr-4 text-right tabular-nums">{PCT2.format(b.weight * 100)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

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
  const privacy = usePrivacy();
  const [rows, setRows] = useState<ExposureRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pieView, setPieView] = useState<"net" | "retirement" | "brokerage">("net");
  const [pieMetric, setPieMetric] = useState<PieMetric>("net");
  const [detail, setDetail] = useState<
    Map<
      string,
      {
        impliedPrice: number | null;
        syntheticShares: number | null;
        syntheticMarketValue: number | null;
        contributors: Array<{ optionSymbol: string; quantity: number; delta: number | null; syntheticShares: number }>;
      }
    >
  >(new Map());
  const [sortColumn, setSortColumn] = useState<SortColumn>("net");
  const [sortAsc, setSortAsc] = useState(false);
  const [classSortColumn, setClassSortColumn] = useState<ClassSortColumn>("mv");
  const [classSortAsc, setClassSortAsc] = useState(false);
  const [assetClass, setAssetClass] = useState<Array<{ key: string; marketValue: number; weight: number }>>([]);
  const [accounts, setAccounts] = useState<
    Array<{
      accountId: string;
      accountName: string;
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

  async function load() {
    setError(null);
    const [expResp, allocResp] = await Promise.all([fetch("/api/exposure"), fetch(`/api/allocation?synthetic=1`)]);
    const acctResp = await fetch(`/api/allocation/accounts?synthetic=1`);
    const exposureBucketResp = await fetch(`/api/exposure/buckets`);

      async function safeJson(resp: Response) {
        const text = await resp.text();
        try {
          return JSON.parse(text) as unknown;
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

    const expBucketJson = (await safeJson(exposureBucketResp)) as {
      ok: boolean;
      buckets?: Array<{ bucketKey: "brokerage" | "retirement"; exposure: ExposureRow[] }>;
      error?: string;
    };
    if (!expBucketJson.ok) throw new Error(expBucketJson.error ?? "Failed to load exposure buckets");
    setExposureBuckets(expBucketJson.buckets ?? []);
  }

  useEffect(() => {
    const t = setTimeout(() => {
      void (async () => {
        await fetch("/api/schwab/quotes", { method: "POST" }).catch(() => null);
        await fetch("/api/schwab/refresh-greeks", { method: "POST" }).catch(() => null);
        await load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
      })();
    }, 0);
    return () => clearTimeout(t);
  }, []);

  useEquityMarketPolling(
    () => {
      void (async () => {
        await fetch("/api/schwab/quotes", { method: "POST" });
        const key = "fh_last_greeks_refresh_ms";
        const now = Date.now();
        const last = Number(sessionStorage.getItem(key) ?? "0");
        const FIVE_MIN = 5 * 60_000;
        if (!Number.isFinite(last) || now - last > FIVE_MIN) {
          sessionStorage.setItem(key, String(now));
          await fetch("/api/schwab/refresh-greeks", { method: "POST" }).catch(() => null);
        }
        await load();
      })();
    },
    60_000,
    [],
  );

  function toggleSort(col: SortColumn) {
    if (sortColumn === col) setSortAsc(!sortAsc);
    else {
      setSortColumn(col);
      // Default: strings asc, numbers desc.
      setSortAsc(col === "underlying" ? true : false);
    }
  }

  function toggleClassSort(col: ClassSortColumn) {
    if (classSortColumn === col) setClassSortAsc(!classSortAsc);
    else {
      setClassSortColumn(col);
      setClassSortAsc(col === "key" ? true : false);
    }
  }

  const sortedAssetClass = useMemo(() => {
    const a = [...assetClass];
    a.sort((x, y) => {
      let cmp = 0;
      switch (classSortColumn) {
        case "key":
          cmp = x.key.localeCompare(y.key, undefined, { numeric: true, sensitivity: "base" });
          break;
        case "mv":
          cmp = x.marketValue - y.marketValue;
          break;
        case "weight":
          cmp = x.weight - y.weight;
          break;
      }
      if (cmp === 0) cmp = x.key.localeCompare(y.key);
      return classSortAsc ? cmp : -cmp;
    });
    return a;
  }, [assetClass, classSortColumn, classSortAsc]);

  const scopedRows = useMemo(() => {
    if (pieView === "net") return rows;
    const b = exposureBuckets.find((x) => x.bucketKey === pieView);
    return b?.exposure ?? [];
  }, [rows, exposureBuckets, pieView]);

  /** Whole-portfolio synthetic MV (for hint when Net vs Spot would match). */
  const portfolioSynthMv = useMemo(() => rows.reduce((s, r) => s + r.syntheticMarketValue, 0), [rows]);
  const showSyntheticZeroHint = rows.length > 0 && Math.abs(portfolioSynthMv) < 1e-6;

  /** Denominator for % + pie for active metric + scope. */
  const scopedMetricTotal = useMemo(() => scopedRows.reduce((s, r) => s + sliceMv(r, pieMetric), 0), [scopedRows, pieMetric]);

  const sortedRows = useMemo(() => {
    const rs = [...scopedRows];
    const getNet = (r: ExposureRow) => r.spotMarketValue + r.syntheticMarketValue;
    const getPct = (r: ExposureRow) => (scopedMetricTotal ? sliceMv(r, pieMetric) / scopedMetricTotal : 0);
    rs.sort((a, b) => {
      let cmp = 0;
      switch (sortColumn) {
        case "underlying":
          cmp = a.underlyingSymbol.localeCompare(b.underlyingSymbol, undefined, { numeric: true, sensitivity: "base" });
          break;
        case "spot":
          cmp = a.spotMarketValue - b.spotMarketValue;
          break;
        case "synthetic":
          cmp = a.syntheticMarketValue - b.syntheticMarketValue;
          break;
        case "net":
          cmp = getNet(a) - getNet(b);
          break;
        case "syntheticShares":
          cmp = a.syntheticShares - b.syntheticShares;
          break;
        case "heldShares":
          cmp = (a.heldShares ?? 0) - (b.heldShares ?? 0);
          break;
        case "netShares":
          cmp = netShares(a) - netShares(b);
          break;
        case "pct":
          cmp = getPct(a) - getPct(b);
          break;
      }
      if (cmp === 0) cmp = a.underlyingSymbol.localeCompare(b.underlyingSymbol);
      return sortAsc ? cmp : -cmp;
    });
    return rs;
  }, [scopedRows, sortColumn, sortAsc, scopedMetricTotal, pieMetric]);

  async function ensureDetail(underlying: string) {
    const sym = (underlying ?? "").trim().toUpperCase();
    if (!sym) return;
    if (detail.has(sym)) return;
    try {
      const resp = await fetch(`/api/exposure/details?underlying=${encodeURIComponent(sym)}`, { cache: "no-store" });
      const json = (await resp.json()) as {
        ok: boolean;
        impliedPrice?: number | null;
        syntheticShares?: number | null;
        syntheticMarketValue?: number | null;
        contributors?: Array<{ optionSymbol: string; quantity: number; delta: number | null; syntheticShares: number }>;
      };
      if (!json.ok) return;
      setDetail((prev) => {
        const next = new Map(prev);
        next.set(sym, {
          impliedPrice: json.impliedPrice ?? null,
          syntheticShares: json.syntheticShares ?? null,
          syntheticMarketValue: json.syntheticMarketValue ?? null,
          contributors: json.contributors ?? [],
        });
        return next;
      });
    } catch {
      // ignore
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Allocation</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Exposure by underlying; pie chart switches Spot, Synthetic, or Net weights. Asset-class tables include delta-weighted option exposure in equities.{" "}
            <Link href="/diversification" className="font-medium text-zinc-900 underline-offset-4 hover:underline dark:text-zinc-100">
              Diversification
            </Link>{" "}
            has the same pie controls for sector / market cap / geography.
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
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Scope</div>
            <div className="grid w-max max-w-full grid-cols-3 gap-1.5">
              {([
                { key: "net", label: "All" },
                { key: "brokerage", label: "Brokerage" },
                { key: "retirement", label: "Retirement" },
              ] as const).map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => setPieView(v.key)}
                  className={
                    BTN_CLASSES +
                    " min-w-[6rem] shadow-sm " +
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
            <div className="grid w-max max-w-full grid-cols-3 gap-1.5">
              {(["net", "spot", "synthetic"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPieMetric(m)}
                  className={
                    BTN_CLASSES +
                    " min-w-[6rem] shadow-sm " +
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
            {pieView === "net" ? "All" : pieView === "brokerage" ? "Brokerage" : "Retirement"} · {PIE_METRIC_LABEL[pieMetric]}
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {showSyntheticZeroHint ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-100">
            Synthetic exposure is <span className="font-semibold">$0</span> because option deltas are not loaded yet (Net and Spot weights match). Open{" "}
            <Link href="/connections" className="font-medium underline underline-offset-2">
              Connections
            </Link>{" "}
            and use <span className="font-medium">Refresh option greeks</span>, or stay on this page — greeks refresh runs after quotes on load and at most every 5 minutes while the market is open.
          </div>
        ) : null}

        <div className="mt-5 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-300 text-left text-zinc-600 dark:border-white/20 dark:text-zinc-400">
                <SortTh
                  col="underlying"
                  label="Underlying"
                  sortColumn={sortColumn}
                  sortAsc={sortAsc}
                  onToggle={toggleSort}
                  className="py-2 pr-4 font-medium"
                />
                <SortTh
                  col="spot"
                  label="Spot MV"
                  sortColumn={sortColumn}
                  sortAsc={sortAsc}
                  onToggle={toggleSort}
                  className="py-2 pr-4 text-right font-medium"
                />
                <SortTh
                  col="synthetic"
                  label="Synthetic MV"
                  sortColumn={sortColumn}
                  sortAsc={sortAsc}
                  onToggle={toggleSort}
                  className="py-2 pr-4 text-right font-medium"
                />
                <SortTh
                  col="net"
                  label="Net MV"
                  sortColumn={sortColumn}
                  sortAsc={sortAsc}
                  onToggle={toggleSort}
                  className="py-2 pr-4 text-right font-medium"
                />
                <SortTh
                  col="syntheticShares"
                  label="Synthetic shares"
                  sortColumn={sortColumn}
                  sortAsc={sortAsc}
                  onToggle={toggleSort}
                  className="py-2 pr-4 text-right font-medium"
                />
                <SortTh
                  col="heldShares"
                  label="Held shares"
                  sortColumn={sortColumn}
                  sortAsc={sortAsc}
                  onToggle={toggleSort}
                  className="py-2 pr-4 text-right font-medium"
                />
                <SortTh
                  col="netShares"
                  label="Net shares"
                  sortColumn={sortColumn}
                  sortAsc={sortAsc}
                  onToggle={toggleSort}
                  className="py-2 pr-4 text-right font-medium"
                />
                <SortTh
                  col="pct"
                  label="% of total"
                  sortColumn={sortColumn}
                  sortAsc={sortAsc}
                  onToggle={toggleSort}
                  className="py-2 pr-4 text-right font-medium"
                />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => {
                const netMv = r.spotMarketValue + r.syntheticMarketValue;
                const pct = scopedMetricTotal ? sliceMv(r, pieMetric) / scopedMetricTotal : 0;
                return (
                  <tr key={r.underlyingSymbol} className="border-b border-zinc-200 dark:border-white/20">
                    <td className="py-2 pr-4 font-medium">{r.underlyingSymbol}</td>
                      <td className={"py-2 pr-4 text-right tabular-nums " + negClass(r.spotMarketValue)}>
                        {usd2Masked(r.spotMarketValue, privacy.masked)}
                      </td>
                      <td
                        className={"py-2 pr-4 text-right tabular-nums " + negClass(r.syntheticMarketValue)}
                        onMouseEnter={() => void ensureDetail(r.underlyingSymbol)}
                        title={(() => {
                          const d = detail.get(r.underlyingSymbol.trim().toUpperCase());
                          if (!d) return "Hover to load synthetic MV breakdown";
                          const px = d.impliedPrice;
                          const pxStr = px == null ? "n/a" : `$${px.toFixed(2)}`;
                          const sharesStr = d.syntheticShares == null ? "n/a" : d.syntheticShares.toFixed(2);
                          const lines = [
                            `Synthetic MV breakdown for ${r.underlyingSymbol}`,
                            `syntheticShares = Σ(positionQty × 100 × delta) = ${sharesStr}`,
                            `impliedPrice = ${pxStr}`,
                            `syntheticMV = syntheticShares × impliedPrice`,
                            ``,
                            `Top contributors:`,
                            ...d.contributors.slice(0, 8).map((c) => {
                              const dlt = c.delta == null ? "—" : c.delta.toFixed(3);
                              return `${c.optionSymbol} | qty=${c.quantity} | delta=${dlt} | contribShares=${c.syntheticShares.toFixed(2)}`;
                            }),
                          ];
                          return lines.join("\n");
                        })()}
                      >
                        {usd2Masked(r.syntheticMarketValue, privacy.masked)}
                      </td>
                    <td className="py-2 pr-4 text-right tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
                        <span className={negClass(netMv)}>{usd2Masked(netMv, privacy.masked)}</span>
                    </td>
                      <td className={"py-2 pr-4 text-right tabular-nums " + negClass(r.syntheticShares)}>
                        {(Number.isFinite(r.syntheticShares) ? r.syntheticShares : 0).toFixed(2)}
                      </td>
                      <td className={"py-2 pr-4 text-right tabular-nums " + negClass(r.heldShares ?? 0)}>{(r.heldShares ?? 0).toFixed(2)}</td>
                      <td className={"py-2 pr-4 text-right tabular-nums " + negClass(netShares(r))}>{netShares(r).toFixed(2)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{PCT2.format(pct * 100)}%</td>
                  </tr>
                );
              })}
              {rows.length ? (
                <tr className="border-t border-zinc-300 bg-zinc-50/60 font-semibold text-zinc-900 dark:border-white/20 dark:bg-white/5 dark:text-zinc-100">
                  <td className="py-2 pr-4">TOTAL</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{usd2Masked(scopedRows.reduce((s, r) => s + r.spotMarketValue, 0), privacy.masked)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{usd2Masked(scopedRows.reduce((s, r) => s + r.syntheticMarketValue, 0), privacy.masked)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{usd2Masked(scopedRows.reduce((s, r) => s + r.spotMarketValue + r.syntheticMarketValue, 0), privacy.masked)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {scopedRows
                      .reduce((s, r) => s + (Number.isFinite(r.syntheticShares) ? r.syntheticShares : 0), 0)
                      .toFixed(2)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{scopedRows.reduce((s, r) => s + (r.heldShares ?? 0), 0).toFixed(2)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{scopedRows.reduce((s, r) => s + (r.heldShares ?? 0) + (r.syntheticShares ?? 0), 0).toFixed(2)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">100.00%</td>
                </tr>
              ) : null}
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

      <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <h2 className="text-base font-semibold">Weighting (pie chart)</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Color-coded by symbol. Uses the same scope + weights selections as the table above.
        </p>

        <div className="mt-3">
          <FinancePiePanel
            title={`${pieView === "net" ? "All accounts" : pieView === "retirement" ? "Retirement" : "Brokerage"} · ${pieMetricChartSubtitle(pieMetric)}`}
            emptyMessage={
              pieMetric === "synthetic" && Math.abs(scopedMetricTotal) < 1e-9
                ? "No synthetic market value to chart (all slices ≤ $0). Refresh option greeks on Connections if you hold options — deltas must be loaded for synthetic MV."
                : undefined
            }
            buckets={[
              {
                label: pieView,
                totalMarketValue: scopedMetricTotal,
                byAsset: scopedRows.map((r) => {
                  const mv = sliceMv(r, pieMetric);
                  return {
                    key: r.underlyingSymbol,
                    marketValue: mv,
                    weight: scopedMetricTotal ? mv / scopedMetricTotal : 0,
                  };
                }),
              },
            ]}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <h2 className="text-base font-semibold">By asset class</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-300 text-left text-zinc-600 dark:border-white/20 dark:text-zinc-400">
                <SortTh
                  col="key"
                  label="Class"
                  sortColumn={classSortColumn}
                  sortAsc={classSortAsc}
                  onToggle={toggleClassSort}
                  className="py-2 pr-4 font-medium"
                />
                <SortTh
                  col="mv"
                  label="Market value"
                  sortColumn={classSortColumn}
                  sortAsc={classSortAsc}
                  onToggle={toggleClassSort}
                  className="py-2 pr-4 text-right font-medium"
                />
                <SortTh
                  col="weight"
                  label="Weight"
                  sortColumn={classSortColumn}
                  sortAsc={classSortAsc}
                  onToggle={toggleClassSort}
                  className="py-2 pr-4 text-right font-medium"
                />
              </tr>
            </thead>
            <tbody>
              {sortedAssetClass.map((b) => (
                <tr key={b.key} className="border-b border-zinc-200 dark:border-white/20">
                  <td className="py-2 pr-4 font-medium">{b.key}</td>
                  <td className={"py-2 pr-4 text-right tabular-nums " + negClass(b.marketValue)}>
                    {usd2Masked(b.marketValue, privacy.masked)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{PCT2.format(b.weight * 100)}%</td>
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

      <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <h2 className="text-base font-semibold">By account</h2>
        <div className="mt-4 grid gap-4">
          {accounts.map((a) => (
            <details
              key={a.accountId}
              className="rounded-xl border border-zinc-300 p-4 open:bg-zinc-50 dark:border-white/20 dark:open:bg-black/30"
            >
              <summary className="cursor-pointer list-none">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm font-semibold">{a.accountName}</div>
                  <div className={"text-sm text-zinc-600 dark:text-zinc-400 " + negClass(a.totalMarketValue)}>
                    {usd2Masked(a.totalMarketValue, privacy.masked)}
                  </div>
                </div>
              </summary>
              <div className="mt-3 overflow-x-auto">
                <AccountAssetClassTable rows={a.byAssetClass} masked={privacy.masked} />
              </div>
              <AccountPositionsForAllocation accountId={a.accountId} />
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

