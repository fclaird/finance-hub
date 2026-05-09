"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useEquityMarketPolling } from "@/hooks/useEquityMarketPolling";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { usePrivacy } from "@/app/components/PrivacyProvider";
import { formatInt, formatNum, formatUsd2 } from "@/lib/format";
import { posNegClass, priceDirClass } from "@/lib/terminal/colors";

type NormalizedQuote = {
  symbol: string;
  last: number | null;
  bid: number | null;
  ask: number | null;
  mark: number | null;
  close: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  change: number | null;
  changePercent: number | null;
  updatedAt: string;
};

type PositionsRow = {
  accountId: string;
  accountName: string;
  securityType: string;
  symbol: string;
  underlyingSymbol: string | null;
  quantity: number;
  marketValue: number | null;
  delta: number | null;
};

type CompanyPayload =
  | {
      ok: true;
      symbol: string;
      companyName: string | null;
      sector: string | null;
      industry: string | null;
      marketCap: number | null;
      pe: number | null;
      divYield: number | null;
      beta: number | null;
      week52High: number | null;
      week52Low: number | null;
      avgVol: number | null;
    }
  | { ok: false; error: string };

type NewsItem = { title: string; link: string; pubDate: string; symbols: string[]; category: string };

const PCT2 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const USD_COMPACT = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

function usd2Masked(v: number, masked: boolean) {
  return formatUsd2(v, { mask: masked });
}

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

type WindowKey = "1D" | "5D" | "1M" | "3M" | "6M" | "1Y" | "3Y" | "5Y";

export default function TerminalSymbolPage() {
  const privacy = usePrivacy();
  const params = useParams<{ symbol?: string }>();
  const sym = normSym(params?.symbol ?? "");

  const [quote, setQuote] = useState<NormalizedQuote | null>(null);
  const [company, setCompany] = useState<CompanyPayload | null>(null);
  const [benchSeries, setBenchSeries] = useState<Record<string, Array<{ date: string; close: number }>>>({});
  const [windowKey, setWindowKey] = useState<WindowKey>("6M");
  const [nowMs, setNowMs] = useState<number>(0);
  const [positions, setPositions] = useState<PositionsRow[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function loadAll() {
    setError(null);
    try {
      const [qResp, bResp, pResp, companyResp, newsResp] = await Promise.all([
        fetch("/api/quotes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbols: [sym] }),
        }),
        fetch(`/api/performance/benchmarks?symbols=${encodeURIComponent([sym, "SPY", "QQQ"].join(","))}`, { cache: "no-store" }),
        fetch("/api/positions", { cache: "no-store" }),
        fetch(`/api/terminal/company?symbol=${encodeURIComponent(sym)}`, { cache: "no-store" }),
        fetch(`/api/terminal/news?symbols=${encodeURIComponent(sym)}&mode=company`, { cache: "no-store" }),
      ]);

      const qJson = (await qResp.json()) as { ok: boolean; quotes?: NormalizedQuote[]; error?: string };
      if (!qJson.ok) throw new Error(qJson.error ?? "Failed to load quote");
      setQuote((qJson.quotes ?? [])[0] ?? null);

      const bJson = (await bResp.json().catch(() => null)) as
        | { ok: boolean; series?: Record<string, Array<{ date: string; close: number }>> }
        | null;
      setBenchSeries(bJson?.series ?? {});

      const pJson = (await pResp.json()) as { ok: boolean; positions?: PositionsRow[]; error?: string };
      if (!pJson.ok) throw new Error(pJson.error ?? "Failed to load positions");
      const rows = (pJson.positions ?? []).filter((r) => {
        const s = normSym(r.symbol ?? "");
        const u = normSym(r.underlyingSymbol ?? "");
        return s === sym || u === sym;
      });
      setPositions(rows);

      const compJson = (await companyResp.json().catch(() => null)) as CompanyPayload | null;
      setCompany(compJson);

      const newsJson = (await newsResp.json().catch(() => null)) as { ok: boolean; items?: NewsItem[] } | null;
      setNews(newsJson?.ok ? (newsJson.items ?? []) : []);

    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    const t = setTimeout(() => void loadAll(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym]);

  useEquityMarketPolling(
    () => {
      void loadAll();
    },
    60_000,
    [sym, windowKey],
  );

  useEffect(() => {
    const t = setTimeout(() => setNowMs(Date.now()), 0);
    return () => clearTimeout(t);
  }, [sym, windowKey]);

  const exposure = useMemo(() => {
    let spotMv = 0;
    let synthMv = 0;
    let synthShares = 0;
    let heldShares = 0;
    for (const r of positions) {
      if (r.securityType === "option") {
        const d = typeof r.delta === "number" && Number.isFinite(r.delta) ? r.delta : 0;
        const shares = (r.quantity ?? 0) * 100 * d;
        synthShares += shares;
        const px = quote?.last ?? quote?.close ?? 0;
        synthMv += shares * px;
      } else {
        heldShares += r.quantity ?? 0;
        spotMv += r.marketValue ?? 0;
      }
    }
    return {
      heldShares,
      synthShares,
      netShares: heldShares + synthShares,
      spotMv,
      synthMv,
      netMv: spotMv + synthMv,
    };
  }, [positions, quote]);

  const optionContribs = useMemo(() => {
    const out: Array<{ optionSymbol: string; quantity: number; delta: number; syntheticShares: number }> = [];
    for (const r of positions) {
      if (r.securityType !== "option") continue;
      const d = typeof r.delta === "number" && Number.isFinite(r.delta) ? r.delta : 0;
      const qty = r.quantity ?? 0;
      const syntheticShares = qty * 100 * d;
      out.push({ optionSymbol: r.symbol, quantity: qty, delta: d, syntheticShares });
    }
    out.sort((a, b) => Math.abs(b.syntheticShares) - Math.abs(a.syntheticShares));
    return out.slice(0, 10);
  }, [positions]);

  const windowStartIso = useMemo(() => {
    const DAY = 24 * 60 * 60_000;
    const now = nowMs;
    const durMs =
      windowKey === "1D"
        ? 1 * DAY
        : windowKey === "5D"
          ? 5 * DAY
          : windowKey === "1M"
            ? 30 * DAY
            : windowKey === "3M"
              ? 92 * DAY
              : windowKey === "6M"
                ? 183 * DAY
                : windowKey === "1Y"
                  ? 365 * DAY
                  : windowKey === "3Y"
                    ? 3 * 365 * DAY
                    : 5 * 365 * DAY;
    return new Date(now - durMs).toISOString().slice(0, 10);
  }, [windowKey, nowMs]);

  const perfData = useMemo(() => {
    const s = benchSeries[sym] ?? [];
    const spy = benchSeries.SPY ?? [];
    const qqq = benchSeries.QQQ ?? [];
    if (s.length < 2) return [];

    function baseOnOrBefore(series: Array<{ date: string; close: number }>, baseDate: string): number {
      if (series.length === 0) return 1;
      // series is already sorted by date ASC from the backend.
      let lo = 0;
      let hi = series.length - 1;
      let bestIdx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const d = series[mid]!.date;
        if (d <= baseDate) {
          bestIdx = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      const picked = bestIdx >= 0 ? series[bestIdx] : series[0];
      return picked?.close || 1;
    }

    const map = new Map<string, { sym?: number; spy?: number; qqq?: number }>();
    for (const p of s) map.set(p.date, { ...(map.get(p.date) ?? {}), sym: p.close });
    for (const p of spy) map.set(p.date, { ...(map.get(p.date) ?? {}), spy: p.close });
    for (const p of qqq) map.set(p.date, { ...(map.get(p.date) ?? {}), qqq: p.close });

    let dates = Array.from(map.keys()).sort((a, b) => a.localeCompare(b));
    dates = dates.filter((d) => d >= windowStartIso);
    if (dates.length < 2) dates = Array.from(map.keys()).sort((a, b) => a.localeCompare(b)).slice(-2);

    const baseDate = dates[0] ?? s[0]!.date;
    const firstSym = baseOnOrBefore(s, baseDate);
    const firstSpy = baseOnOrBefore(spy, baseDate);
    const firstQqq = baseOnOrBefore(qqq, baseDate);

    return dates
      .map((d) => {
        const v = map.get(d)!;
        if (v.sym == null) return null;
        return {
          date: d,
          sym: ((v.sym / firstSym) - 1) * 100,
          SPY: v.spy == null ? null : ((v.spy / firstSpy) - 1) * 100,
          QQQ: v.qqq == null ? null : ((v.qqq / firstQqq) - 1) * 100,
        };
      })
      .filter((x): x is { date: string; sym: number; SPY: number | null; QQQ: number | null } => !!x);
  }, [benchSeries, sym, windowStartIso]);

  const headerCompanyName =
    company && company.ok ? ((company.companyName ?? "").trim() || sym) : sym;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{headerCompanyName}</h1>
          <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            <span className="font-mono">{sym}</span>
          </div>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Quote, history, news, and your portfolio exposure for this symbol (read-only).
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/terminal"
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            Terminal
          </Link>
          <Link
            href="/positions"
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            Positions
          </Link>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</div>
      ) : null}

      <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <div className="rounded-xl border border-zinc-300 bg-white/60 p-4 dark:border-white/20 dark:bg-black/20">
          <div className="text-sm font-semibold">Quote</div>
          <div className="mt-2 grid gap-2 text-sm tabular-nums">
            <div className="flex items-baseline justify-between">
              <div className="text-xs text-zinc-600 dark:text-zinc-400">Last</div>
              <div className={"text-lg font-semibold " + priceDirClass(quote?.last, quote?.close)}>
                {quote?.last == null ? "—" : quote.last.toFixed(2)}
              </div>
            </div>
            <div className="flex items-baseline justify-between">
              <div className="text-xs text-zinc-600 dark:text-zinc-400">$ Chg</div>
              <div className={posNegClass(quote?.change)}>{quote?.change == null ? "—" : usd2Masked(quote.change, privacy.masked)}</div>
            </div>
            <div className="flex items-baseline justify-between">
              <div className="text-xs text-zinc-600 dark:text-zinc-400">% Chg</div>
              <div className={posNegClass(quote?.changePercent == null ? null : quote.changePercent * 100)}>
                {quote?.changePercent == null ? "—" : PCT2.format(quote.changePercent * 100) + "%"}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-zinc-600 dark:text-zinc-400">
              <div>Bid: {quote?.bid == null ? "—" : quote.bid.toFixed(2)}</div>
              <div>Ask: {quote?.ask == null ? "—" : quote.ask.toFixed(2)}</div>
              <div>High: {quote?.high == null ? "—" : quote.high.toFixed(2)}</div>
              <div>Low: {quote?.low == null ? "—" : quote.low.toFixed(2)}</div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-zinc-300 bg-white/60 p-4 dark:border-white/20 dark:bg-black/20">
            <div className="text-sm font-semibold">Company</div>
            {company?.ok !== true ? (
              <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Company fundamentals unavailable.</div>
            ) : (
              <div className="mt-2 grid gap-2 text-sm">
                <div className="text-base font-semibold">{company.companyName ?? sym}</div>
                <div className="text-xs text-zinc-600 dark:text-zinc-400">
                  {(company.sector ?? "—") + (company.industry ? ` • ${company.industry}` : "")}
                </div>
                <div className="mt-1 grid grid-cols-2 gap-2 text-xs tabular-nums text-zinc-700 dark:text-zinc-300">
                  <div>Market cap: {company.marketCap == null ? "—" : USD_COMPACT.format(company.marketCap)}</div>
                  <div>P/E: {company.pe == null ? "—" : company.pe.toFixed(1)}</div>
                  <div>Dividend: {company.divYield == null ? "—" : PCT2.format(company.divYield * 100) + "%"}</div>
                  <div>Beta: {company.beta == null ? "—" : company.beta.toFixed(2)}</div>
                  <div>52w low: {company.week52Low == null ? "—" : company.week52Low.toFixed(2)}</div>
                  <div>52w high: {company.week52High == null ? "—" : company.week52High.toFixed(2)}</div>
                  <div>Avg vol: {company.avgVol == null ? "—" : Math.round(company.avgVol).toLocaleString()}</div>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-zinc-300 bg-white/60 p-4 dark:border-white/20 dark:bg-black/20">
            <div className="text-sm font-semibold">At a glance</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs tabular-nums text-zinc-700 dark:text-zinc-300">
              <div>Last: {quote?.last == null ? "—" : quote.last.toFixed(2)}</div>
              <div className={posNegClass(quote?.change)}>Chg: {quote?.change == null ? "—" : usd2Masked(quote.change, privacy.masked)}</div>
              <div className={posNegClass(quote?.changePercent == null ? null : quote.changePercent * 100)}>
                %: {quote?.changePercent == null ? "—" : PCT2.format(quote.changePercent * 100) + "%"}
              </div>
              <div>Vol: {quote?.volume == null ? "—" : formatInt(Math.round(quote.volume))}</div>
            </div>
          </div>
        </div>

        <div className="mt-4 min-w-0 rounded-xl border border-zinc-300 bg-white/60 p-4 dark:border-white/20 dark:bg-black/20">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-semibold">Performance overlay (% rebased)</div>
            <div className="grid grid-cols-8 gap-1">
              {(["1D", "5D", "1M", "3M", "6M", "1Y", "3Y", "5Y"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setWindowKey(k)}
                  className={
                    "h-8 rounded-md px-2 text-xs font-semibold " +
                    (windowKey === k
                      ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                      : "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5")
                  }
                >
                  {k}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-zinc-600 dark:text-zinc-400">
            <div className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#0f766e" }} />
              <span className="font-medium text-zinc-700 dark:text-zinc-200">{sym}</span>
            </div>
            <div className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#2563eb" }} />
              <span className="font-medium text-zinc-700 dark:text-zinc-200">SPY</span>
            </div>
            <div className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#7c3aed" }} />
              <span className="font-medium text-zinc-700 dark:text-zinc-200">QQQ</span>
            </div>
          </div>
          {perfData.length < 2 ? (
            <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Not enough cached history yet.</div>
          ) : (
            <div className="mt-2 h-72 w-full min-w-0">
              <ResponsiveContainer>
                <LineChart data={perfData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={false} />
                  <YAxis tickFormatter={(v) => `${Number(v).toFixed(0)}%`} />
                  <Tooltip formatter={(v) => `${Number(v).toFixed(2)}%`} labelFormatter={(l) => String(l)} />
                  <Line type="monotone" dataKey="sym" name={sym} strokeWidth={2} dot={false} stroke="#0f766e" />
                  <Line type="monotone" dataKey="SPY" name="SPY" strokeWidth={2} dot={false} stroke="#2563eb" />
                  <Line type="monotone" dataKey="QQQ" name="QQQ" strokeWidth={2} dot={false} stroke="#7c3aed" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <div className="text-sm font-semibold">Your exposure</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-zinc-300 bg-white/60 p-3 text-sm dark:border-white/20 dark:bg-black/20">
            <div className="text-xs text-zinc-600 dark:text-zinc-400">Shares</div>
            <div className="mt-1 grid gap-1 tabular-nums">
              <div className="flex justify-between"><span>Held</span><span className={"font-semibold " + posNegClass(exposure.heldShares)}>{formatNum(exposure.heldShares, 2)}</span></div>
              <div className="flex justify-between"><span>Synthetic</span><span className={"font-semibold " + posNegClass(exposure.synthShares)}>{formatNum(exposure.synthShares, 2)}</span></div>
              <div className="flex justify-between"><span>Net</span><span className={"font-semibold " + posNegClass(exposure.netShares)}>{formatNum(exposure.netShares, 2)}</span></div>
            </div>
          </div>
          <div className="rounded-xl border border-zinc-300 bg-white/60 p-3 text-sm dark:border-white/20 dark:bg-black/20">
            <div className="text-xs text-zinc-600 dark:text-zinc-400">Market value</div>
            <div className="mt-1 grid gap-1 tabular-nums">
              <div className="flex justify-between"><span>Spot</span><span className={"font-semibold " + posNegClass(exposure.spotMv)}>{usd2Masked(exposure.spotMv, privacy.masked)}</span></div>
              <div className="flex justify-between"><span>Synthetic</span><span className={"font-semibold " + posNegClass(exposure.synthMv)}>{usd2Masked(exposure.synthMv, privacy.masked)}</span></div>
              <div className="flex justify-between"><span>Net</span><span className={"font-semibold " + posNegClass(exposure.netMv)}>{usd2Masked(exposure.netMv, privacy.masked)}</span></div>
            </div>
          </div>
          <div className="rounded-xl border border-zinc-300 bg-white/60 p-3 text-sm dark:border-white/20 dark:bg-black/20">
            <div className="text-xs text-zinc-600 dark:text-zinc-400">Positions</div>
            <div className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
              {positions.length} row{positions.length === 1 ? "" : "s"} from latest snapshots
            </div>
          </div>
        </div>
        <div className="mt-4 rounded-xl border border-zinc-300 bg-white/60 p-4 dark:border-white/20 dark:bg-black/20">
          <div className="text-sm font-semibold">Top option contributors (synthetic shares)</div>
          {optionContribs.length === 0 ? (
            <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">No options found for this underlying in your latest snapshots.</div>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-xs text-zinc-600 dark:text-zinc-400">
                  <tr>
                    <th className="py-1 pr-4 text-left font-medium">Option</th>
                    <th className="py-1 pr-4 text-right font-medium">Qty</th>
                    <th className="py-1 pr-4 text-right font-medium">Delta</th>
                    <th className="py-1 text-right font-medium">Synth sh</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {optionContribs.map((c) => (
                    <tr key={c.optionSymbol} className="border-t border-zinc-200/70 dark:border-white/10">
                      <td className="py-1 pr-4">{c.optionSymbol}</td>
                      <td className="py-1 pr-4 text-right">{c.quantity.toFixed(0)}</td>
                      <td className="py-1 pr-4 text-right">{c.delta.toFixed(3)}</td>
                      <td className={"py-1 text-right font-semibold " + posNegClass(c.syntheticShares)}>{c.syntheticShares.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <div className="text-sm font-semibold">News</div>
        {news.length === 0 ? (
          <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">No items found.</div>
        ) : (
          <div className="mt-3 grid gap-2">
            {news.slice(0, 12).map((it) => (
              <a
                key={it.link}
                href={it.link}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-zinc-300 bg-white/60 p-3 text-sm hover:bg-white dark:border-white/20 dark:bg-black/20 dark:hover:bg-black/30"
              >
                <div className="font-medium text-zinc-900 dark:text-zinc-100">{it.title}</div>
                <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                  {(it.category ? it.category + " • " : "") + (it.pubDate ? new Date(it.pubDate).toLocaleString() : "")}
                </div>
              </a>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

