"use client";

import { useMemo, useState } from "react";

type SyncResult = { ok: boolean; accounts?: number; error?: string };
type GreeksResult = { ok: boolean; updated?: number; error?: string };

export default function ConnectionsPage() {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [greeks, setGreeks] = useState<GreeksResult | null>(null);
  const [refreshingGreeks, setRefreshingGreeks] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState<string | null>(null);

  const body = useMemo(() => {
    if (!result) return null;
    if (!result.ok) return `Error: ${result.error ?? "Unknown error"}`;
    return `Synced ${result.accounts ?? 0} account(s).`;
  }, [result]);

  async function syncNow() {
    setSyncing(true);
    setResult(null);
    setGreeks(null);
    try {
      const resp = await fetch("/api/schwab/sync", { method: "POST" });
      const json = (await resp.json()) as SyncResult;
      setResult(json);
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setSyncing(false);
    }
  }

  async function seedDemo() {
    setSeeding(true);
    setSeedMsg(null);
    setResult(null);
    setGreeks(null);
    try {
      const resp = await fetch("/api/demo/seed", { method: "POST" });
      const json = (await resp.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Failed to seed demo data");
      setSeedMsg("Demo data loaded. Check Allocation, Performance, Rebalancing, Alerts.");
    } catch (e) {
      setSeedMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSeeding(false);
    }
  }

  async function refreshGreeks() {
    setRefreshingGreeks(true);
    setGreeks(null);
    try {
      const resp = await fetch("/api/schwab/refresh-greeks", { method: "POST" });
      const json = (await resp.json()) as GreeksResult;
      setGreeks(json);
    } catch (e) {
      setGreeks({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setRefreshingGreeks(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          This is local-only. Tokens are stored encrypted on disk using `FINANCE_HUB_PASSPHRASE`.
        </p>
      </div>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-zinc-950">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-base font-semibold">Demo mode</div>
            <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Load realistic sample holdings (including options deltas) to explore the UI without connecting accounts.
            </div>
          </div>
          <button
            type="button"
            onClick={seedDemo}
            disabled={seeding}
            className="shrink-0 rounded-full bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            {seeding ? "Loading…" : "Load demo data"}
          </button>
        </div>
        {seedMsg ? (
          <div className="mt-4 rounded-xl bg-zinc-50 p-3 text-sm text-zinc-800 dark:bg-black/40 dark:text-zinc-200">
            {seedMsg}
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-zinc-950">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-base font-semibold">Schwab</div>
            <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Connect via OAuth, then sync holdings/positions into the local SQLite database.
            </div>
          </div>
          <a
            href="/api/schwab/start"
            className="shrink-0 rounded-full bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            Connect Schwab
          </a>
        </div>

        <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-500">
          Note: Schwab connect requires `SCHWAB_CLIENT_ID`, `SCHWAB_CLIENT_SECRET`, and `SCHWAB_REDIRECT_URI` in `.env.local`.
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={syncNow}
            disabled={syncing}
            className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            {syncing ? "Syncing…" : "Sync now"}
          </button>
          <button
            type="button"
            onClick={refreshGreeks}
            disabled={refreshingGreeks}
            className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            {refreshingGreeks ? "Refreshing greeks…" : "Refresh option greeks"}
          </button>
          <a
            href="/api/health"
            className="text-sm text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400"
            target="_blank"
            rel="noreferrer"
          >
            View health
          </a>
        </div>

        {body ? (
          <div className="mt-4 rounded-xl bg-zinc-50 p-3 text-sm text-zinc-800 dark:bg-black/40 dark:text-zinc-200">
            {body}
          </div>
        ) : null}

        {greeks ? (
          <div className="mt-3 rounded-xl bg-zinc-50 p-3 text-sm text-zinc-800 dark:bg-black/40 dark:text-zinc-200">
            {greeks.ok
              ? `Updated greeks for ${greeks.updated ?? 0} option quote(s).`
              : `Greeks refresh error: ${greeks.error ?? "Unknown error"}`}
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-zinc-950">
        <div className="text-base font-semibold">Plaid (later)</div>
        <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          We’ll add Plaid as an alternate ingestion path (and for Vanguard 529 later).
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
            onClick={async () => {
              const ensurePlaid = () =>
                new Promise<void>((resolve, reject) => {
                  if ((window as any).Plaid) return resolve();
                  const s = document.createElement("script");
                  s.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
                  s.async = true;
                  s.onload = () => resolve();
                  s.onerror = () => reject(new Error("Failed to load Plaid Link script"));
                  document.head.appendChild(s);
                });

              await ensurePlaid();
              const ltResp = await fetch("/api/plaid/link-token", { method: "POST" });
              const ltJson = (await ltResp.json()) as { ok: boolean; link_token?: string; error?: string };
              if (!ltJson.ok || !ltJson.link_token) throw new Error(ltJson.error ?? "Failed to create link token");

              const handler = (window as any).Plaid.create({
                token: ltJson.link_token,
                onSuccess: async (public_token: string) => {
                  await fetch("/api/plaid/exchange", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ public_token }),
                  });
                },
              });
              handler.open();
            }}
          >
            Connect Plaid
          </button>
          <button
            type="button"
            className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
            onClick={async () => {
              await fetch("/api/plaid/sync", { method: "POST" });
            }}
          >
            Sync Plaid holdings
          </button>
        </div>
      </section>
    </div>
  );
}

