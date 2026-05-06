"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<SortColumn>("symbol");
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    (async () => {
      const resp = await fetch("/api/positions");
      const json = (await resp.json()) as { ok: boolean; positions?: Row[]; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Failed to load positions");
      setRows(json.positions ?? []);
    })().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const k = r.accountName;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return Array.from(map.entries()).map(([accountName, rs]) => [
      accountName,
      sortPositionRows(rs, sortColumn, sortAsc),
    ] as const);
  }, [rows, sortColumn, sortAsc]);

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
            className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
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

      <div className="grid gap-4">
        {grouped.map(([accountName, rs]) => (
          <section
            key={accountName}
            className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-zinc-950"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold">{accountName}</h2>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                {rs.length} position{rs.length === 1 ? "" : "s"}
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-zinc-600 dark:border-white/10 dark:text-zinc-400">
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
                  {rs.map((r) => (
                    <tr key={r.positionId} className="border-b border-zinc-100 dark:border-white/5">
                      <td className="py-2 pr-4 font-medium">
                        {r.securityType === "option" ? (
                          <span className={r.quantity < 0 ? "text-red-400" : "text-emerald-400"}>
                            {formatOptionSymbol(r)}
                          </span>
                        ) : (
                          <span>{r.symbol}</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 tabular-nums">{r.quantity}</td>
                      <td className="py-2 pr-4 tabular-nums">
                        {r.price == null ? "-" : `$${r.price.toFixed(2)}`}
                      </td>
                      <td className="py-2 pr-4 tabular-nums">
                        {r.marketValue == null ? "-" : `$${r.marketValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                      </td>
                      <td className="py-2 pr-4 tabular-nums">{r.delta == null ? "-" : r.delta.toFixed(3)}</td>
                      <td className="py-2 pr-4 tabular-nums">{r.gamma == null ? "-" : r.gamma.toFixed(4)}</td>
                      <td className="py-2 pr-4 tabular-nums">{r.theta == null ? "-" : r.theta.toFixed(3)}</td>
                      <td className="py-2 pr-4 tabular-nums">{r.dte == null ? "-" : r.dte}</td>
                      <td className="py-2 pr-4 tabular-nums">
                        {r.intrinsic == null ? "-" : `$${r.intrinsic.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                      </td>
                      <td className="py-2 pr-4 tabular-nums">
                        {r.extrinsic == null ? "-" : `$${r.extrinsic.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                      </td>
                    </tr>
                  ))}
                  {rs.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-6 text-center text-zinc-600 dark:text-zinc-400">
                        No positions yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        ))}

        {grouped.length === 0 ? (
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            No positions yet. Load demo data on Connections.
          </div>
        ) : null}
      </div>
    </div>
  );
}

