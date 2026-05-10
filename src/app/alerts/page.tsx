"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { usePrivacy } from "@/app/components/PrivacyProvider";
import { formatInt, formatNum, formatUsd2 } from "@/lib/format";
import { formatOptionSymbolDisplay } from "@/lib/formatOptionDisplay";
import { posNegClass } from "@/lib/terminal/colors";
import { usePersistedColumnOrder } from "@/lib/usePersistedColumnOrder";

type RuleConfig = Record<string, unknown>;
type Rule = { id: string; type: "drift" | "concentration"; enabled: boolean; config: RuleConfig };
type EventRow = { id: string; occurred_at: string; severity: string; title: string; details_json: string | null; rule_type: string };

type OptionContractRow = {
  positionId: string;
  accountId: string;
  accountName: string;
  symbol: string;
  securityType: string;
  underlyingSymbol: string | null;
  effectiveUnderlyingSymbol?: string | null;
  optionExpiration: string | null;
  optionRight: "C" | "P" | null;
  optionStrike: number | null;
  quantity: number;
  price: number | null;
  marketValue: number | null;
  delta: number | null;
  dte: number | null;
  intrinsic: number | null;
  extrinsic: number | null;
};

const DTE_THRESHOLD = 30;
/** Extrinsic must be strictly less than this fraction of intrinsic (intrinsic &gt; 0). */
const EXTRINSIC_VS_INTRINSIC_MAX = 0.1;

const OPTION_COLUMN_IDS = [
  "account",
  "symbol",
  "qty",
  "price",
  "marketValue",
  "delta",
  "intrinsic",
  "extrinsic",
  "extrinsicPctIntrinsic",
  "dte",
  "expiration",
] as const;
type OptionColumnId = (typeof OPTION_COLUMN_IDS)[number];

const EVENT_COLUMN_IDS = ["when", "severity", "title", "rule"] as const;
type EventColumnId = (typeof EVENT_COLUMN_IDS)[number];

const COL_HDR_GRAB = "cursor-grab select-none active:cursor-grabbing";

function DraggableColumnHeader<T extends string>({
  colId,
  columnOrder,
  moveColumn,
  className,
  children,
}: {
  colId: T;
  columnOrder: T[];
  moveColumn: (from: number, to: number) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <th
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", colId);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => {
        e.preventDefault();
        const fromId = e.dataTransfer.getData("text/plain") as T;
        if (!fromId || columnOrder.indexOf(fromId) < 0) return;
        const from = columnOrder.indexOf(fromId);
        const to = columnOrder.indexOf(colId);
        if (from >= 0 && to >= 0) moveColumn(from, to);
      }}
      className={className}
      title="Drag column header to reorder"
    >
      {children}
    </th>
  );
}

/** Positions API stores option intrinsic/extrinsic as position totals; convert to per contract (1 ctr. = 100 sh.). */
function formatOptionPerContract(
  totalDollars: number | null,
  quantity: number,
  masked: boolean,
): string {
  const contracts = Math.abs(quantity);
  if (!contracts || totalDollars == null || !Number.isFinite(totalDollars)) return "—";
  const perContract = totalDollars / contracts;
  return formatUsd2(perContract, { mask: masked });
}

/** Extrinsic as a percentage of intrinsic (position totals from API; ratio equals per-contract). */
function formatExtrinsicPctOfIntrinsic(intrinsic: number | null, extrinsic: number | null): string {
  if (intrinsic == null || extrinsic == null) return "—";
  if (!Number.isFinite(intrinsic) || !Number.isFinite(extrinsic) || intrinsic <= 0) return "—";
  const pct = (extrinsic / intrinsic) * 100;
  return `${formatNum(pct, 1)}%`;
}

function AccountHeaderContent() {
  return (
    <>
      <div className="font-medium text-zinc-600 dark:text-zinc-400">Account</div>
      <div className="mt-0.5 text-[10px] font-normal uppercase tracking-wide text-zinc-500 dark:text-zinc-500">Nickname</div>
    </>
  );
}

function AccountCell({
  accountName,
  nickname,
}: {
  accountName: string;
  nickname: string | null | undefined;
}) {
  const n = (nickname ?? "").trim();
  return (
    <td className="whitespace-nowrap py-2 pr-6 align-top">
      <div className="text-xs font-medium text-zinc-800 dark:text-zinc-200">{accountName}</div>
      <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-500">{n || "—"}</div>
    </td>
  );
}

function OptionContractsRedTile({
  title,
  description,
  badgeCount,
  rows,
  nickByAccountId,
  privacy,
  emptyMessage,
  optionColumnOrder,
  moveOptionColumn,
}: {
  title: string;
  description: ReactNode;
  badgeCount: number;
  rows: OptionContractRow[];
  nickByAccountId: Map<string, string | null>;
  privacy: ReturnType<typeof usePrivacy>;
  emptyMessage: string;
  optionColumnOrder: OptionColumnId[];
  moveOptionColumn: (from: number, to: number) => void;
}) {
  const nCols = optionColumnOrder.length;

  function optionHeader(col: OptionColumnId) {
    switch (col) {
      case "account":
        return (
          <DraggableColumnHeader
            key={col}
            colId={col}
            columnOrder={optionColumnOrder}
            moveColumn={moveOptionColumn}
            className={`whitespace-nowrap py-2 pr-6 text-left align-bottom ${COL_HDR_GRAB}`}
          >
            <AccountHeaderContent />
          </DraggableColumnHeader>
        );
      case "symbol":
        return (
          <DraggableColumnHeader
            key={col}
            colId={col}
            columnOrder={optionColumnOrder}
            moveColumn={moveOptionColumn}
            className={`whitespace-nowrap py-2 pr-6 font-medium ${COL_HDR_GRAB}`}
          >
            Symbol
          </DraggableColumnHeader>
        );
      case "qty":
        return (
          <DraggableColumnHeader
            key={col}
            colId={col}
            columnOrder={optionColumnOrder}
            moveColumn={moveOptionColumn}
            className={`whitespace-nowrap py-2 pr-6 text-right font-medium ${COL_HDR_GRAB}`}
          >
            Qty
          </DraggableColumnHeader>
        );
      case "price":
        return (
          <DraggableColumnHeader
            key={col}
            colId={col}
            columnOrder={optionColumnOrder}
            moveColumn={moveOptionColumn}
            className={`whitespace-nowrap py-2 pr-6 text-right font-medium ${COL_HDR_GRAB}`}
          >
            Price
          </DraggableColumnHeader>
        );
      case "marketValue":
        return (
          <DraggableColumnHeader
            key={col}
            colId={col}
            columnOrder={optionColumnOrder}
            moveColumn={moveOptionColumn}
            className={`whitespace-nowrap py-2 pr-6 text-right font-medium ${COL_HDR_GRAB}`}
          >
            Market value
          </DraggableColumnHeader>
        );
      case "delta":
        return (
          <DraggableColumnHeader
            key={col}
            colId={col}
            columnOrder={optionColumnOrder}
            moveColumn={moveOptionColumn}
            className={`whitespace-nowrap py-2 pr-6 text-right font-medium ${COL_HDR_GRAB}`}
          >
            Delta
          </DraggableColumnHeader>
        );
      case "intrinsic":
        return (
          <DraggableColumnHeader
            key={col}
            colId={col}
            columnOrder={optionColumnOrder}
            moveColumn={moveOptionColumn}
            className={`whitespace-nowrap py-2 pr-6 text-right align-bottom font-medium ${COL_HDR_GRAB}`}
          >
            <div>Intrinsic</div>
            <div className="mt-0.5 text-[10px] font-normal uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
              per ctr.
            </div>
          </DraggableColumnHeader>
        );
      case "extrinsic":
        return (
          <DraggableColumnHeader
            key={col}
            colId={col}
            columnOrder={optionColumnOrder}
            moveColumn={moveOptionColumn}
            className={`whitespace-nowrap py-2 pr-6 text-right align-bottom font-medium ${COL_HDR_GRAB}`}
          >
            <div>Extrinsic</div>
            <div className="mt-0.5 text-[10px] font-normal uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
              per ctr.
            </div>
          </DraggableColumnHeader>
        );
      case "extrinsicPctIntrinsic":
        return (
          <DraggableColumnHeader
            key={col}
            colId={col}
            columnOrder={optionColumnOrder}
            moveColumn={moveOptionColumn}
            className={`whitespace-nowrap py-2 pr-6 text-right align-bottom font-medium ${COL_HDR_GRAB}`}
          >
            <div>% extrinsic</div>
            <div className="mt-0.5 text-[10px] font-normal uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
              of intrinsic
            </div>
          </DraggableColumnHeader>
        );
      case "dte":
        return (
          <DraggableColumnHeader
            key={col}
            colId={col}
            columnOrder={optionColumnOrder}
            moveColumn={moveOptionColumn}
            className={`whitespace-nowrap py-2 pr-6 text-right font-medium ${COL_HDR_GRAB}`}
          >
            DTE
          </DraggableColumnHeader>
        );
      case "expiration":
        return (
          <DraggableColumnHeader
            key={col}
            colId={col}
            columnOrder={optionColumnOrder}
            moveColumn={moveOptionColumn}
            className={`whitespace-nowrap py-2 pr-4 text-left font-medium ${COL_HDR_GRAB}`}
          >
            Expiration
          </DraggableColumnHeader>
        );
      default: {
        const _exhaustive: never = col;
        return _exhaustive;
      }
    }
  }

  function optionCell(col: OptionColumnId, r: OptionContractRow) {
    switch (col) {
      case "account":
        return (
          <AccountCell
            key={col}
            accountName={r.accountName}
            nickname={nickByAccountId.get(r.accountId)}
          />
        );
      case "symbol":
        return (
          <td key={col} className="whitespace-nowrap py-2 pr-6 font-medium text-zinc-900 dark:text-zinc-100">
            <span
              className={
                r.quantity < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
              }
            >
              {formatOptionSymbolDisplay(r)}
            </span>
          </td>
        );
      case "qty":
        return (
          <td key={col} className={"whitespace-nowrap py-2 pr-6 text-right tabular-nums " + posNegClass(r.quantity)}>
            {formatInt(r.quantity)}
          </td>
        );
      case "price":
        return (
          <td key={col} className="whitespace-nowrap py-2 pr-6 text-right tabular-nums">
            {r.price == null ? "—" : formatUsd2(r.price, { mask: privacy.masked })}
          </td>
        );
      case "marketValue":
        return (
          <td
            key={col}
            className={
              "whitespace-nowrap py-2 pr-6 text-right tabular-nums " +
              (r.marketValue == null ? "" : posNegClass(r.marketValue))
            }
          >
            {r.marketValue == null ? "—" : formatUsd2(r.marketValue, { mask: privacy.masked })}
          </td>
        );
      case "delta":
        return (
          <td key={col} className={"whitespace-nowrap py-2 pr-6 text-right tabular-nums " + posNegClass(r.delta)}>
            {r.delta == null ? "—" : formatNum(r.delta, 3)}
          </td>
        );
      case "intrinsic":
        return (
          <td
            key={col}
            className={
              "whitespace-nowrap py-2 pr-6 text-right tabular-nums " +
              (r.intrinsic == null ? "" : posNegClass(r.intrinsic))
            }
          >
            {formatOptionPerContract(r.intrinsic, r.quantity, privacy.masked)}
          </td>
        );
      case "extrinsic":
        return (
          <td
            key={col}
            className={
              "whitespace-nowrap py-2 pr-6 text-right tabular-nums " +
              (r.extrinsic == null ? "" : posNegClass(r.extrinsic))
            }
          >
            {formatOptionPerContract(r.extrinsic, r.quantity, privacy.masked)}
          </td>
        );
      case "extrinsicPctIntrinsic":
        return (
          <td
            key={col}
            className="whitespace-nowrap py-2 pr-6 text-right tabular-nums text-zinc-800 dark:text-zinc-200"
          >
            {formatExtrinsicPctOfIntrinsic(r.intrinsic, r.extrinsic)}
          </td>
        );
      case "dte":
        return (
          <td
            key={col}
            className="whitespace-nowrap py-2 pr-6 text-right tabular-nums font-semibold text-red-700 dark:text-red-300"
          >
            {r.dte == null ? "—" : formatInt(r.dte)}
          </td>
        );
      case "expiration":
        return (
          <td key={col} className="whitespace-nowrap py-2 pr-4 tabular-nums text-zinc-700 dark:text-zinc-300">
            {r.optionExpiration ?? "—"}
          </td>
        );
      default: {
        const _exhaustive: never = col;
        return _exhaustive;
      }
    }
  }

  return (
    <section className="relative overflow-hidden rounded-2xl border border-red-200/80 bg-white shadow-sm dark:border-red-500/25 dark:bg-zinc-950">
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-red-100/90 via-red-50/40 to-white dark:from-red-600/18 dark:via-red-950/35 dark:to-zinc-950"
        aria-hidden
      />
      <div className="relative p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{description}</p>
          </div>
          <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-900 dark:bg-red-950/60 dark:text-red-100">
            {badgeCount} contract{badgeCount === 1 ? "" : "s"}
          </span>
        </div>

        <div className="mt-4 overflow-x-auto pb-1">
          <table className="w-max min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-red-200/80 text-left text-zinc-600 dark:border-red-500/20 dark:text-zinc-400">
                {optionColumnOrder.map((col) => optionHeader(col))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.positionId} className="border-b border-zinc-200/80 dark:border-white/10">
                  {optionColumnOrder.map((col) => optionCell(col, r))}
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={nCols} className="py-8 text-center text-zinc-600 dark:text-zinc-400">
                    {emptyMessage}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function isLowExtrinsicVsIntrinsic(row: OptionContractRow): boolean {
  if (row.securityType !== "option") return false;
  if ((row.quantity ?? 0) >= 0) return false;
  const int = row.intrinsic;
  const ext = row.extrinsic;
  if (typeof int !== "number" || !Number.isFinite(int) || int <= 0) return false;
  if (typeof ext !== "number" || !Number.isFinite(ext)) return false;
  return ext < EXTRINSIC_VS_INTRINSIC_MAX * int;
}

export default function AlertsPage() {
  const privacy = usePrivacy();
  const { order: optionColumnOrder, moveColumn: moveOptionColumn } = usePersistedColumnOrder(
    "alerts:optionContractColumns",
    OPTION_COLUMN_IDS,
  );
  const { order: eventColumnOrder, moveColumn: moveEventColumn } = usePersistedColumnOrder(
    "alerts:recentEventsColumns",
    EVENT_COLUMN_IDS,
  );
  const [rules, setRules] = useState<Rule[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [expiringOptions, setExpiringOptions] = useState<OptionContractRow[]>([]);
  const [lowExtrinsicOptions, setLowExtrinsicOptions] = useState<OptionContractRow[]>([]);
  const [nickByAccountId, setNickByAccountId] = useState<Map<string, string | null>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [includeSynthetic, setIncludeSynthetic] = useState(true);

  async function load() {
    setError(null);
    const [rResp, eResp, pResp, aResp] = await Promise.all([
      fetch("/api/alerts/rules"),
      fetch("/api/alerts/events?limit=50"),
      fetch("/api/positions", { cache: "no-store" }),
      fetch("/api/accounts", { cache: "no-store" }),
    ]);
    const rJson = (await rResp.json()) as { ok: boolean; rules?: Rule[]; error?: string };
    if (!rJson.ok) throw new Error(rJson.error ?? "Failed to load rules");
    setRules(rJson.rules ?? []);
    const eJson = (await eResp.json()) as { ok: boolean; events?: EventRow[]; error?: string };
    if (!eJson.ok) throw new Error(eJson.error ?? "Failed to load events");
    setEvents(eJson.events ?? []);

    const aJson = (await aResp.json()) as {
      ok: boolean;
      accounts?: Array<{ id: string; nickname: string | null }>;
      error?: string;
    };
    const nickMap = new Map<string, string | null>();
    if (aJson.ok) {
      for (const a of aJson.accounts ?? []) nickMap.set(a.id, a.nickname ?? null);
    }
    setNickByAccountId(nickMap);

    const pJson = (await pResp.json()) as { ok: boolean; positions?: OptionContractRow[]; error?: string };
    if (pJson.ok) {
      const all = pJson.positions ?? [];
      const exp = all.filter(
        (row) =>
          row.securityType === "option" &&
          typeof row.dte === "number" &&
          Number.isFinite(row.dte) &&
          row.dte < DTE_THRESHOLD,
      );
      exp.sort((a, b) => (a.dte ?? 999) - (b.dte ?? 999));
      setExpiringOptions(exp);

      const lowEx = all.filter(isLowExtrinsicVsIntrinsic);
      lowEx.sort((a, b) => {
        const ra = a.intrinsic! > 0 ? (a.extrinsic ?? 0) / a.intrinsic! : 1;
        const rb = b.intrinsic! > 0 ? (b.extrinsic ?? 0) / b.intrinsic! : 1;
        return ra - rb;
      });
      setLowExtrinsicOptions(lowEx);
    } else {
      setExpiringOptions([]);
      setLowExtrinsicOptions([]);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  async function saveRule(type: Rule["type"], enabled: boolean, config: RuleConfig) {
    await fetch("/api/alerts/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, enabled, config }),
    });
    await load();
  }

  async function runNow() {
    setRunning(true);
    try {
      await fetch(`/api/alerts/run?synthetic=${includeSynthetic ? "1" : "0"}`, { method: "POST" });
      await load();
    } finally {
      setRunning(false);
    }
  }

  const drift = rules.find((r) => r.type === "drift");
  const conc = rules.find((r) => r.type === "concentration");
  const driftThresholdPct = (() => {
    const raw = drift?.config?.thresholdPct;
    return typeof raw === "number" ? raw : 0.05;
  })();
  const concMaxSingleUnderlyingPct = (() => {
    const raw = conc?.config?.maxSingleUnderlyingPct;
    return typeof raw === "number" ? raw : 0.25;
  })();

  const positionsBlurb = (
    <>
      From your latest position snapshots (same data as{" "}
      <Link href="/positions" className="font-medium underline-offset-4 hover:underline">
        Positions
      </Link>
      ).
    </>
  );

  return (
    <div className="flex w-full max-w-6xl flex-1 flex-col gap-6 py-8 pl-4 pr-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Alerts</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            In-app alert events generated from your latest data.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/rebalancing"
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            Rebalancing
          </Link>
        </div>
      </div>

      <OptionContractsRedTile
        title={`Options expiring within ${DTE_THRESHOLD} days`}
        description={positionsBlurb}
        badgeCount={expiringOptions.length}
        rows={expiringOptions}
        nickByAccountId={nickByAccountId}
        privacy={privacy}
        emptyMessage={`No option positions under ${DTE_THRESHOLD} DTE in the latest snapshots.`}
        optionColumnOrder={optionColumnOrder}
        moveOptionColumn={moveOptionColumn}
      />

      <OptionContractsRedTile
        title="Low extrinsic vs intrinsic"
        description={
          <>
            Short option positions (negative qty) where extrinsic is under {(EXTRINSIC_VS_INTRINSIC_MAX * 100).toFixed(0)}%
            of intrinsic (intrinsic must be positive). {positionsBlurb}
          </>
        }
        badgeCount={lowExtrinsicOptions.length}
        rows={lowExtrinsicOptions}
        nickByAccountId={nickByAccountId}
        privacy={privacy}
        emptyMessage="No short option positions match this extrinsic / intrinsic relationship in the latest snapshots."
        optionColumnOrder={optionColumnOrder}
        moveOptionColumn={moveOptionColumn}
      />

      <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <label className="flex items-center gap-3 text-sm font-medium">
            <input
              type="checkbox"
              checked={includeSynthetic}
              onChange={(e) => setIncludeSynthetic(e.target.checked)}
              className="h-4 w-4 accent-zinc-900 dark:accent-white"
            />
            Include synthetic (Delta) exposure
          </label>
          <button
            type="button"
            onClick={runNow}
            disabled={running}
            className="rounded-full bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            {running ? "Running…" : "Run rules now"}
          </button>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-zinc-300 p-4 dark:border-white/20">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Drift rule</div>
              <button
                className="text-sm underline-offset-4 hover:underline"
                onClick={() => saveRule("drift", !(drift?.enabled ?? false), drift?.config ?? { thresholdPct: 0.05 })}
              >
                {drift?.enabled ? "Disable" : "Enable"}
              </button>
            </div>
            <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Threshold (%):{" "}
              <input
                className="ml-2 w-24 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-white/20 dark:bg-zinc-950"
                value={(driftThresholdPct * 100).toFixed(2)}
                onChange={(e) => saveRule("drift", drift?.enabled ?? true, { thresholdPct: Number(e.target.value) / 100 })}
              />
            </div>
          </div>

          <div className="rounded-xl border border-zinc-300 p-4 dark:border-white/20">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Concentration rule</div>
              <button
                className="text-sm underline-offset-4 hover:underline"
                onClick={() =>
                  saveRule(
                    "concentration",
                    !(conc?.enabled ?? false),
                    conc?.config ?? { maxSingleUnderlyingPct: 0.25 },
                  )
                }
              >
                {conc?.enabled ? "Disable" : "Enable"}
              </button>
            </div>
            <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Max single underlying (%):{" "}
              <input
                className="ml-2 w-24 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-white/20 dark:bg-zinc-950"
                value={(concMaxSingleUnderlyingPct * 100).toFixed(2)}
                onChange={(e) =>
                  saveRule("concentration", conc?.enabled ?? true, { maxSingleUnderlyingPct: Number(e.target.value) / 100 })
                }
              />
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <h2 className="text-base font-semibold">Recent events</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-300 text-left text-zinc-600 dark:border-white/20 dark:text-zinc-400">
                {eventColumnOrder.map((col) => {
                  const c = `py-2 pr-4 font-medium ${COL_HDR_GRAB}`;
                  switch (col) {
                    case "when":
                      return (
                        <DraggableColumnHeader
                          key={col}
                          colId={col}
                          columnOrder={eventColumnOrder}
                          moveColumn={moveEventColumn}
                          className={c}
                        >
                          When
                        </DraggableColumnHeader>
                      );
                    case "severity":
                      return (
                        <DraggableColumnHeader
                          key={col}
                          colId={col}
                          columnOrder={eventColumnOrder}
                          moveColumn={moveEventColumn}
                          className={c}
                        >
                          Severity
                        </DraggableColumnHeader>
                      );
                    case "title":
                      return (
                        <DraggableColumnHeader
                          key={col}
                          colId={col}
                          columnOrder={eventColumnOrder}
                          moveColumn={moveEventColumn}
                          className={c}
                        >
                          Title
                        </DraggableColumnHeader>
                      );
                    case "rule":
                      return (
                        <DraggableColumnHeader
                          key={col}
                          colId={col}
                          columnOrder={eventColumnOrder}
                          moveColumn={moveEventColumn}
                          className={c}
                        >
                          Rule
                        </DraggableColumnHeader>
                      );
                    default: {
                      const _e: never = col;
                      return _e;
                    }
                  }
                })}
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-b border-zinc-200 dark:border-white/20">
                  {eventColumnOrder.map((col) => {
                    switch (col) {
                      case "when":
                        return (
                          <td key={col} className="py-2 pr-4">
                            {new Date(e.occurred_at).toLocaleString()}
                          </td>
                        );
                      case "severity":
                        return (
                          <td key={col} className="py-2 pr-4 font-medium">
                            {e.severity}
                          </td>
                        );
                      case "title":
                        return (
                          <td key={col} className="py-2 pr-4">
                            {e.title}
                          </td>
                        );
                      case "rule":
                        return (
                          <td key={col} className="py-2 pr-4">
                            {e.rule_type}
                          </td>
                        );
                      default: {
                        const _e: never = col;
                        return _e;
                      }
                    }
                  })}
                </tr>
              ))}
              {events.length === 0 ? (
                <tr>
                  <td colSpan={eventColumnOrder.length} className="py-6 text-center text-zinc-600 dark:text-zinc-400">
                    No events yet. Enable a rule and run it.
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
