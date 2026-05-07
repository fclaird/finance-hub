"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePrivacy } from "@/app/components/PrivacyProvider";
import { formatUsd2 } from "@/lib/format";

type Row = {
  positionId: string;
  asOf: string;
  accountId: string;
  accountName: string;
  accountType: string;
  symbol: string;
  securityName: string;
  securityType: string;
  underlyingSymbol: string | null;
  optionExpiration: string | null;
  optionRight: "C" | "P" | null;
  optionStrike: number | null;
  quantity: number;
  price: number | null;
  marketValue: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  dte: number | null;
  intrinsic: number | null;
  extrinsic: number | null;
};

function usd2Masked(v: number, masked: boolean) {
  return formatUsd2(v, { mask: masked });
}

function usd2Unmasked(v: number) {
  return formatUsd2(v, { mask: false });
}

function n0(v: number | null | undefined) {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function formatOptionSymbol(r: Row) {
  const u = r.underlyingSymbol ?? r.symbol;
  const exp = r.optionExpiration ? formatExpiry(r.optionExpiration) : "?";
  const right = r.optionRight ?? "?";
  const strike = r.optionStrike == null ? "?" : r.optionStrike % 1 === 0 ? String(r.optionStrike) : r.optionStrike.toFixed(2);
  return `${u} ${exp} ${right} ${strike}`;
}

function formatExpiry(iso: string) {
  // iso: YYYY-MM-DD -> "DD MMM YY"
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const yy = m[1]!.slice(2);
  const mm = Number(m[2]!);
  const dd = m[3]!;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mon = months[mm - 1] ?? "???";
  return `${dd} ${mon} ${yy}`;
}

type SortColumn =
  | "symbol"
  | "quantity"
  | "price"
  | "marketValue"
  | "delta"
  | "gamma"
  | "theta"
  | "dte"
  | "intrinsic"
  | "extrinsic";

function symbolSortKey(r: Row) {
  return r.securityType === "option" ? formatOptionSymbol(r) : r.symbol;
}

function compareNullableNumber(a: number | null, b: number | null, asc: boolean): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const cmp = a - b;
  return asc ? cmp : -cmp;
}

function compareRows(a: Row, b: Row, col: SortColumn, asc: boolean): number {
  switch (col) {
    case "symbol":
      return symbolSortKey(a).localeCompare(symbolSortKey(b), undefined, { numeric: true, sensitivity: "base" }) * (asc ? 1 : -1);
    case "quantity": {
      const cmp = a.quantity - b.quantity;
      return asc ? cmp : -cmp;
    }
    case "price":
      return compareNullableNumber(a.price, b.price, asc);
    case "marketValue":
      return compareNullableNumber(a.marketValue, b.marketValue, asc);
    case "delta":
      return compareNullableNumber(a.delta, b.delta, asc);
    case "gamma":
      return compareNullableNumber(a.gamma, b.gamma, asc);
    case "theta":
      return compareNullableNumber(a.theta, b.theta, asc);
    case "dte":
      return compareNullableNumber(a.dte, b.dte, asc);
    case "intrinsic":
      return compareNullableNumber(a.intrinsic, b.intrinsic, asc);
    case "extrinsic":
      return compareNullableNumber(a.extrinsic, b.extrinsic, asc);
    default:
      return 0;
  }
}

function sortPositionRows(rows: Row[], col: SortColumn, asc: boolean): Row[] {
  return [...rows].sort((a, b) => {
    const primary = compareRows(a, b, col, asc);
    if (primary !== 0) return primary;
    return a.positionId.localeCompare(b.positionId);
  });
}

type ViewMode = "perAccount" | "allAccounts";

type UnderlyingGroup = {
  underlying: string;
  rows: Row[];
  spotMarketValue: number;
  syntheticMarketValue: number;
  netMarketValue: number;
};

function underlyingKey(r: Row): string {
  const sym = (r.symbol ?? "").trim();
  if (r.securityType === "option") return (r.underlyingSymbol ?? sym).trim() || sym;
  return sym;
}

function groupSortValue(g: UnderlyingGroup, col: SortColumn): string | number {
  switch (col) {
    case "symbol":
      return g.underlying;
    case "marketValue":
      return g.netMarketValue;
    case "quantity":
      return g.rows.reduce((s, r) => s + n0(r.quantity), 0);
    case "price": {
      const qty = g.rows.filter((r) => r.securityType !== "option").reduce((s, r) => s + n0(r.quantity), 0);
      return qty ? g.spotMarketValue / qty : 0;
    }
    case "delta":
      return g.rows.filter((r) => r.securityType === "option").reduce((s, r) => s + n0(r.delta) * n0(r.quantity), 0);
    case "gamma":
      return g.rows.filter((r) => r.securityType === "option").reduce((s, r) => s + n0(r.gamma) * n0(r.quantity), 0);
    case "theta":
      return g.rows.filter((r) => r.securityType === "option").reduce((s, r) => s + n0(r.theta) * n0(r.quantity), 0);
    case "dte": {
      // Prefer soonest expiry in group (min DTE).
      const ds = g.rows.map((r) => r.dte).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      if (ds.length === 0) return Number.POSITIVE_INFINITY;
      return Math.min(...ds);
    }
    case "intrinsic":
      return g.rows.reduce((s, r) => s + n0(r.intrinsic), 0);
    case "extrinsic":
      return g.rows.reduce((s, r) => s + n0(r.extrinsic), 0);
    default:
      return 0;
  }
}

function computeUnderlyingGroups(rs: Row[], sortColumn: SortColumn, sortAsc: boolean): UnderlyingGroup[] {
  const by = new Map<string, Row[]>();
  for (const r of rs) {
    const k = underlyingKey(r) || "UNKNOWN";
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(r);
  }

  // Spot price approximation (needed to compute option synthetic MV).
  const spotPx = new Map<string, number>();
  for (const [u, rows] of by.entries()) {
    let qty = 0;
    let mv = 0;
    let bestPx: number | null = null;
    for (const r of rows) {
      if (r.securityType === "option") continue;
      const q = n0(r.quantity);
      const p = r.price;
      const m = r.marketValue;
      if (p != null && Number.isFinite(p) && p > 0) bestPx = p;
      qty += q;
      mv += n0(m);
    }
    const implied = qty !== 0 ? mv / qty : null;
    const px = bestPx ?? implied;
    if (px != null && Number.isFinite(px) && px > 0) spotPx.set(u, px);
  }

  const out: UnderlyingGroup[] = [];
  for (const [u, rows] of by.entries()) {
    const spotMv = rows
      .filter((r) => r.securityType !== "option")
      .reduce((s, r) => s + n0(r.marketValue), 0);

    const px = spotPx.get(u) ?? 0;
    const syntheticMv = rows
      .filter((r) => r.securityType === "option")
      .reduce((s, r) => s + n0(r.quantity) * 100 * n0(r.delta) * px, 0);

    const net = spotMv + syntheticMv;
    out.push({
      underlying: u,
      rows: sortPositionRows(rows, sortColumn, sortAsc),
      spotMarketValue: spotMv,
      syntheticMarketValue: syntheticMv,
      netMarketValue: net,
    });
  }

  out.sort((a, b) => {
    if (sortColumn === "symbol") {
      const cmp = a.underlying.localeCompare(b.underlying, undefined, { numeric: true, sensitivity: "base" });
      return sortAsc ? cmp : -cmp;
    }
    const av = groupSortValue(a, sortColumn);
    const bv = groupSortValue(b, sortColumn);
    const an = typeof av === "number" ? av : Number.NaN;
    const bn = typeof bv === "number" ? bv : Number.NaN;
    if (Number.isFinite(an) && Number.isFinite(bn)) {
      const cmp = an - bn;
      if (cmp !== 0) return sortAsc ? cmp : -cmp;
      // Stable fallback: net MV desc then symbol.
      return Math.abs(b.netMarketValue) - Math.abs(a.netMarketValue) || a.underlying.localeCompare(b.underlying);
    }
    const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" });
    if (cmp !== 0) return sortAsc ? cmp : -cmp;
    return Math.abs(b.netMarketValue) - Math.abs(a.netMarketValue) || a.underlying.localeCompare(b.underlying);
  });
  return out;
}

function SortTh({
  col,
  label,
  sortColumn,
  sortAsc,
  onToggle,
}: {
  col: SortColumn;
  label: string;
  sortColumn: SortColumn;
  sortAsc: boolean;
  onToggle: (col: SortColumn) => void;
}) {
  const active = sortColumn === col;
  return (
    <th
      scope="col"
      className="py-2 pr-4 font-medium"
      aria-sort={active ? (sortAsc ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onToggle(col)}
        title={active ? `Sorted ${sortAsc ? "ascending" : "descending"}` : `Sort by ${label}`}
        className={
          "-mx-1 inline-flex max-w-full items-center gap-1 rounded px-1 py-0.5 text-left font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100"
        }
      >
        <span>{label}</span>
        <span className="tabular-nums text-xs opacity-70" aria-hidden>
          {active ? (sortAsc ? "▲" : "▼") : ""}
        </span>
      </button>
    </th>
  );
}

export default function PositionsPage() {
  const privacy = usePrivacy();
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<SortColumn>("symbol");
  const [sortAsc, setSortAsc] = useState(true);
  const [nick, setNick] = useState<Map<string, string | null>>(new Map());
  const [savingNick, setSavingNick] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("perAccount");

  async function load() {
    const resp = await fetch("/api/positions");
    const json = (await resp.json()) as { ok: boolean; positions?: Row[]; error?: string };
    if (!json.ok) throw new Error(json.error ?? "Failed to load positions");
    setRows(json.positions ?? []);
  }

  async function loadNicknames() {
    const resp = await fetch("/api/accounts", { cache: "no-store" });
    const json = (await resp.json()) as {
      ok: boolean;
      accounts?: Array<{ id: string; nickname: string | null }>;
      error?: string;
    };
    if (!json.ok) throw new Error(json.error ?? "Failed to load accounts");
    const m = new Map<string, string | null>();
    for (const a of json.accounts ?? []) m.set(a.id, a.nickname ?? null);
    setNick(m);
  }

  useEffect(() => {
    (async () => {
      await load();
      await loadNicknames();
    })().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      void (async () => {
        await fetch("/api/schwab/quotes", { method: "POST" });
        // Refresh greeks occasionally (bounded) so option columns populate without manual clicks.
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
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const grouped = useMemo(() => {
    const byAccount = new Map<string, { accountName: string; rows: Row[] }>();
    for (const r of rows) {
      if (!byAccount.has(r.accountId)) byAccount.set(r.accountId, { accountName: r.accountName ?? r.accountId, rows: [] });
      byAccount.get(r.accountId)!.rows.push(r);
    }
    return Array.from(byAccount.entries())
      .map(([accountId, v]) => ({ accountId, accountName: v.accountName, rows: v.rows }))
      .sort((a, b) => a.accountName.localeCompare(b.accountName));
  }, [rows]);

  const allGroups = useMemo(() => computeUnderlyingGroups(rows, sortColumn, sortAsc), [rows, sortColumn, sortAsc]);

  function toggleSort(col: SortColumn) {
    if (sortColumn === col) setSortAsc((v) => !v);
    else {
      setSortColumn(col);
      setSortAsc(true);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Positions</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Individual holdings and option positions from the latest snapshot.
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

      {error ? (
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">View</div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setViewMode("perAccount")}
            className={
              "rounded-full px-4 py-2 text-sm font-medium " +
              (viewMode === "perAccount"
                ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                : "border border-zinc-300 bg-white text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5")
            }
          >
            Per account
          </button>
          <button
            type="button"
            onClick={() => setViewMode("allAccounts")}
            className={
              "rounded-full px-4 py-2 text-sm font-medium " +
              (viewMode === "allAccounts"
                ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                : "border border-zinc-300 bg-white text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5")
            }
          >
            All accounts
          </button>
        </div>
      </div>

      <div className="grid gap-4">
        {viewMode === "allAccounts" ? (
          <details
            open
            className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm dark:border-white/20 dark:bg-zinc-950"
          >
            <summary className="cursor-pointer list-none">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold">All accounts</h2>
                  <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                    {rows.length} position{rows.length === 1 ? "" : "s"} • {allGroups.length} underlying
                  </div>
                </div>
              </div>
            </summary>

            <div className="mt-4 grid gap-2">
              {allGroups.map((g) => (
                <details
                  key={g.underlying}
                  open
                  className="rounded-xl border border-zinc-300 bg-white/60 p-3 dark:border-white/20 dark:bg-black/20"
                >
                  <summary className="cursor-pointer list-none">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-sm font-semibold">{g.underlying}</div>
                      <div className="flex flex-wrap items-center gap-3 text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
                        <span>
                          Spot:{" "}
                          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                            {usd2Masked(g.spotMarketValue, privacy.masked)}
                          </span>
                        </span>
                        <span>
                          Synthetic:{" "}
                          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                            {usd2Masked(g.syntheticMarketValue, privacy.masked)}
                          </span>
                        </span>
                        <span>
                          Net:{" "}
                          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                            {usd2Masked(g.netMarketValue, privacy.masked)}
                          </span>
                        </span>
                      </div>
                    </div>
                  </summary>

                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-zinc-300 text-left text-zinc-600 dark:border-white/20 dark:text-zinc-400">
                          <th className="py-2 pr-4 font-medium">Account</th>
                          <SortTh col="symbol" label="Symbol" sortColumn={sortColumn} sortAsc={sortAsc} onToggle={toggleSort} />
                          <SortTh col="quantity" label="Qty" sortColumn={sortColumn} sortAsc={sortAsc} onToggle={toggleSort} />
                          <SortTh col="price" label="Price" sortColumn={sortColumn} sortAsc={sortAsc} onToggle={toggleSort} />
                          <SortTh col="marketValue" label="Market value" sortColumn={sortColumn} sortAsc={sortAsc} onToggle={toggleSort} />
                          <SortTh col="delta" label="Delta" sortColumn={sortColumn} sortAsc={sortAsc} onToggle={toggleSort} />
                          <SortTh col="gamma" label="Gamma" sortColumn={sortColumn} sortAsc={sortAsc} onToggle={toggleSort} />
                          <SortTh col="theta" label="Theta" sortColumn={sortColumn} sortAsc={sortAsc} onToggle={toggleSort} />
                          <SortTh col="dte" label="DTE" sortColumn={sortColumn} sortAsc={sortAsc} onToggle={toggleSort} />
                          <SortTh col="intrinsic" label="Intrinsic" sortColumn={sortColumn} sortAsc={sortAsc} onToggle={toggleSort} />
                          <SortTh col="extrinsic" label="Extrinsic" sortColumn={sortColumn} sortAsc={sortAsc} onToggle={toggleSort} />
                        </tr>
                      </thead>
                      <tbody>
                        {g.rows.map((r) => (
                          <tr key={r.positionId} className="border-b border-zinc-200 dark:border-white/20">
                            <td className="py-2 pr-4 text-xs text-zinc-600 dark:text-zinc-400">{nick.get(r.accountId) ?? r.accountName}</td>
                            <td className="py-2 pr-4 font-medium">
                              {r.securityType === "option" ? (
                                <span className={r.quantity < 0 ? "text-red-400" : "text-emerald-400"}>{formatOptionSymbol(r)}</span>
                              ) : (
                                <span>{r.symbol}</span>
                              )}
                            </td>
                            <td className="py-2 pr-4 text-right tabular-nums">{r.quantity}</td>
                            <td className="py-2 pr-4 text-right tabular-nums">
                            {r.price == null ? "-" : usd2Unmasked(r.price)}
                            </td>
                            <td className="py-2 pr-4 text-right tabular-nums">
                              {r.marketValue == null ? "-" : usd2Masked(r.marketValue, privacy.masked)}
                            </td>
                            <td className="py-2 pr-4 text-right tabular-nums">{r.delta == null ? "-" : r.delta.toFixed(3)}</td>
                            <td className="py-2 pr-4 text-right tabular-nums">{r.gamma == null ? "-" : r.gamma.toFixed(4)}</td>
                            <td className="py-2 pr-4 text-right tabular-nums">{r.theta == null ? "-" : r.theta.toFixed(3)}</td>
                            <td className="py-2 pr-4 text-right tabular-nums">{r.dte == null ? "-" : r.dte}</td>
                            <td className="py-2 pr-4 text-right tabular-nums">{r.intrinsic == null ? "-" : usd2Unmasked(r.intrinsic)}</td>
                            <td className="py-2 pr-4 text-right tabular-nums">{r.extrinsic == null ? "-" : usd2Unmasked(r.extrinsic)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ))}
            </div>
          </details>
        ) : (
          grouped.map((acct) => {
            const rs = acct.rows;
            const groups = computeUnderlyingGroups(rs, sortColumn, sortAsc);
            return (
              <details
                key={acct.accountId}
                open
                className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm dark:border-white/20 dark:bg-zinc-950"
              >
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-base font-semibold">{nick.get(acct.accountId) ? nick.get(acct.accountId) : acct.accountName}</h2>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                        <span className="font-mono">{acct.accountId}</span>
                        <span aria-hidden="true">•</span>
                        <label className="flex items-center gap-2">
                          <span className="font-medium">Nickname</span>
                          <input
                            defaultValue={nick.get(acct.accountId) ?? ""}
                            placeholder="(optional)"
                            className="h-8 w-56 rounded-md border border-zinc-300 bg-white px-2 text-xs text-zinc-900 shadow-sm placeholder:text-zinc-400 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                            onKeyDown={(e) => {
                              if (e.key !== "Enter") return;
                              const v = (e.currentTarget.value ?? "").trim();
                              void (async () => {
                                setSavingNick(acct.accountId);
                                try {
                                  await fetch("/api/accounts/nickname", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ accountId: acct.accountId, nickname: v }),
                                  });
                                  await loadNicknames();
                                } finally {
                                  setSavingNick(null);
                                }
                              })();
                            }}
                          />
                        </label>
                        {savingNick === acct.accountId ? <span className="text-zinc-500">Saving…</span> : null}
                      </div>
                    </div>
                    <div className="text-sm text-zinc-600 dark:text-zinc-400">
                      {rs.length} position{rs.length === 1 ? "" : "s"} • {groups.length} underlying
                    </div>
                  </div>
                </summary>

                <div className="mt-4 grid gap-2">
                  {groups.map((g) => (
                    <details
                      key={g.underlying}
                      open
                      className="rounded-xl border border-zinc-300 bg-white/60 p-3 dark:border-white/20 dark:bg-black/20"
                    >
                      <summary className="cursor-pointer list-none">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="text-sm font-semibold">{g.underlying}</div>
                          <div className="flex flex-wrap items-center gap-3 text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
                            <span>
                              Spot:{" "}
                              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                                {usd2Masked(g.spotMarketValue, privacy.masked)}
                              </span>
                            </span>
                            <span>
                              Synthetic:{" "}
                              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                                {usd2Masked(g.syntheticMarketValue, privacy.masked)}
                              </span>
                            </span>
                            <span>
                              Net:{" "}
                              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                                {usd2Masked(g.netMarketValue, privacy.masked)}
                              </span>
                            </span>
                          </div>
                        </div>
                      </summary>

                      <div className="mt-3 overflow-x-auto">
                        <table className="w-full border-collapse text-sm">
                          <thead>
                            <tr className="border-b border-zinc-300 text-left text-zinc-600 dark:border-white/20 dark:text-zinc-400">
                              <SortTh col="symbol" label="Symbol" sortColumn={sortColumn} sortAsc={sortAsc} onToggle={toggleSort} />
                              <SortTh col="quantity" label="Qty" sortColumn={sortColumn} sortAsc={sortAsc} onToggle={toggleSort} />
                              <SortTh col="price" label="Price" sortColumn={sortColumn} sortAsc={sortAsc} onToggle={toggleSort} />
                              <SortTh col="marketValue" label="Market value" sortColumn={sortColumn} sortAsc={sortAsc} onToggle={toggleSort} />
                              <SortTh col="delta" label="Delta" sortColumn={sortColumn} sortAsc={sortAsc} onToggle={toggleSort} />
                              <SortTh col="gamma" label="Gamma" sortColumn={sortColumn} sortAsc={sortAsc} onToggle={toggleSort} />
                              <SortTh col="theta" label="Theta" sortColumn={sortColumn} sortAsc={sortAsc} onToggle={toggleSort} />
                              <SortTh col="dte" label="DTE" sortColumn={sortColumn} sortAsc={sortAsc} onToggle={toggleSort} />
                              <SortTh col="intrinsic" label="Intrinsic" sortColumn={sortColumn} sortAsc={sortAsc} onToggle={toggleSort} />
                              <SortTh col="extrinsic" label="Extrinsic" sortColumn={sortColumn} sortAsc={sortAsc} onToggle={toggleSort} />
                            </tr>
                          </thead>
                          <tbody>
                            {g.rows.map((r) => (
                              <tr key={r.positionId} className="border-b border-zinc-200 dark:border-white/20">
                                <td className="py-2 pr-4 font-medium">
                                  {r.securityType === "option" ? (
                                    <span className={r.quantity < 0 ? "text-red-400" : "text-emerald-400"}>{formatOptionSymbol(r)}</span>
                                  ) : (
                                    <span>{r.symbol}</span>
                                  )}
                                </td>
                                <td className="py-2 pr-4 text-right tabular-nums">{r.quantity}</td>
                                <td className="py-2 pr-4 text-right tabular-nums">
                                  {r.price == null ? "-" : usd2Unmasked(r.price)}
                                </td>
                                <td className="py-2 pr-4 text-right tabular-nums">
                                  {r.marketValue == null ? "-" : usd2Masked(r.marketValue, privacy.masked)}
                                </td>
                                <td className="py-2 pr-4 text-right tabular-nums">{r.delta == null ? "-" : r.delta.toFixed(3)}</td>
                                <td className="py-2 pr-4 text-right tabular-nums">{r.gamma == null ? "-" : r.gamma.toFixed(4)}</td>
                                <td className="py-2 pr-4 text-right tabular-nums">{r.theta == null ? "-" : r.theta.toFixed(3)}</td>
                                <td className="py-2 pr-4 text-right tabular-nums">{r.dte == null ? "-" : r.dte}</td>
                                <td className="py-2 pr-4 text-right tabular-nums">{r.intrinsic == null ? "-" : usd2Unmasked(r.intrinsic)}</td>
                                <td className="py-2 pr-4 text-right tabular-nums">{r.extrinsic == null ? "-" : usd2Unmasked(r.extrinsic)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  ))}
                </div>
              </details>
            );
          })
        )}

        {grouped.length === 0 ? (
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            No positions yet. Run Schwab sync on Connections.
          </div>
        ) : null}
      </div>
    </div>
  );
}

