"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { usePrivacy } from "@/app/components/PrivacyProvider";

const NAV = [
  { href: "/positions", label: "Positions" },
  { href: "/allocation", label: "Allocation" },
  { href: "/diversification", label: "Diversification" },
  { href: "/earnings", label: "Earnings" },
  { href: "/performance", label: "Performance" },
  { href: "/dividends", label: "Dividends" },
  { href: "/rebalancing", label: "Rebalancing" },
  { href: "/alerts", label: "Alerts" },
];

type DataMode = "auto" | "schwab";

export function SidebarNav() {
  const pathname = usePathname();
  const [mode, setMode] = useState<DataMode>("auto");
  const [avail, setAvail] = useState<{ hasSchwab: boolean }>({ hasSchwab: false });
  const privacy = usePrivacy();

  const modeLabel = useMemo(() => {
    if (mode === "schwab") return "REAL";
    return "AUTO";
  }, [mode]);

  useEffect(() => {
    void (async () => {
      try {
        const resp = await fetch("/api/data-mode", { cache: "no-store" });
        const json = (await resp.json()) as {
          ok: boolean;
          mode?: DataMode;
          availability?: { hasSchwab: boolean };
        };
        if (json.ok) {
          if (json.mode) setMode(json.mode);
          if (json.availability) setAvail(json.availability);
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  async function setDataMode(next: DataMode) {
    setMode(next);
    try {
      await fetch("/api/data-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
    } finally {
      window.location.reload();
    }
  }

  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 overflow-y-auto border-r border-zinc-300 bg-white/70 p-4 backdrop-blur dark:border-white/20 dark:bg-black/40 md:block">
      <div className="px-2 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold tracking-tight">Finance Hub</div>
          <div
            className={
              "rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide " +
              (modeLabel === "REAL"
                ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200"
                : "bg-zinc-100 text-zinc-700 dark:bg-white/10 dark:text-zinc-300")
            }
            title="Data mode for the dashboard"
          >
            {modeLabel}
          </div>
        </div>
        <div className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">Local-first</div>
      </div>

      <div className="mt-3 rounded-xl border border-zinc-300 bg-white/70 p-2 dark:border-white/20 dark:bg-black/30">
        <div className="px-1 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">Data source</div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void setDataMode("schwab")}
            disabled={!avail.hasSchwab}
            className={
              "rounded-lg px-2 py-1.5 text-xs font-semibold transition " +
              (mode === "schwab"
                ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                : "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 disabled:opacity-40 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5")
            }
            title={!avail.hasSchwab ? "Run Schwab sync in Connections first" : "View Schwab-synced snapshot data"}
          >
            Schwab
          </button>
        </div>
        <button
          type="button"
          onClick={() => void setDataMode("auto")}
          className={
            "mt-2 w-full rounded-lg px-2 py-1.5 text-xs font-semibold transition " +
            (mode === "auto"
              ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
              : "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5")
          }
          title="Auto = use latest snapshot regardless of source"
        >
          Auto (latest)
        </button>
      </div>
      <nav className="mt-3 flex flex-col gap-1">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                "rounded-lg px-3 py-2 text-sm font-medium transition-colors " +
                (active
                  ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                  : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-white/10")
              }
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-4 rounded-xl border border-zinc-300 bg-white/70 p-2 dark:border-white/20 dark:bg-black/30">
        <div className="px-1 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">Privacy</div>
        <button
          type="button"
          onClick={() => privacy.toggle()}
          className={
            "mt-2 w-full rounded-lg px-2 py-1.5 text-xs font-semibold transition " +
            (privacy.masked
              ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
              : "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5")
          }
          title="Mask dollar values on screen"
        >
          {privacy.masked ? "Privacy on (mask $)" : "Privacy off"}
        </button>
      </div>
    </aside>
  );
}

