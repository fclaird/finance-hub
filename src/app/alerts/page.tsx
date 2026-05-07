"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type RuleConfig = Record<string, unknown>;
type Rule = { id: string; type: "drift" | "concentration"; enabled: boolean; config: RuleConfig };
type EventRow = { id: string; occurred_at: string; severity: string; title: string; details_json: string | null; rule_type: string };

export default function AlertsPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [includeSynthetic, setIncludeSynthetic] = useState(true);

  async function load() {
    setError(null);
    const [rResp, eResp] = await Promise.all([fetch("/api/alerts/rules"), fetch("/api/alerts/events?limit=50")]);
    const rJson = (await rResp.json()) as { ok: boolean; rules?: Rule[]; error?: string };
    if (!rJson.ok) throw new Error(rJson.error ?? "Failed to load rules");
    setRules(rJson.rules ?? []);
    const eJson = (await eResp.json()) as { ok: boolean; events?: EventRow[]; error?: string };
    if (!eJson.ok) throw new Error(eJson.error ?? "Failed to load events");
    setEvents(eJson.events ?? []);
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

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8">
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
                <th className="py-2 pr-4 font-medium">When</th>
                <th className="py-2 pr-4 font-medium">Severity</th>
                <th className="py-2 pr-4 font-medium">Title</th>
                <th className="py-2 pr-4 font-medium">Rule</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-b border-zinc-200 dark:border-white/20">
                  <td className="py-2 pr-4">{new Date(e.occurred_at).toLocaleString()}</td>
                  <td className="py-2 pr-4 font-medium">{e.severity}</td>
                  <td className="py-2 pr-4">{e.title}</td>
                  <td className="py-2 pr-4">{e.rule_type}</td>
                </tr>
              ))}
              {events.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-zinc-600 dark:text-zinc-400">
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

