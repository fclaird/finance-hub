"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Line, LineChart, ResponsiveContainer } from "recharts";

import { usePrivacy } from "@/app/components/PrivacyProvider";
import { useEquityMarketPolling } from "@/hooks/useEquityMarketPolling";
import { isUsEquityPreOpenFuturesPollWindow, isUsEquityRegularSessionOpen } from "@/lib/market/usEquitySession";
import { HeatmapGrid, type HeatmapItem } from "@/app/components/HeatmapGrid";
import { XDataAgeBanner } from "@/app/components/terminal/XDataAgeBanner";
import { XNewsSection } from "@/app/components/terminal/XNewsSection";
import type { XDigestPayload } from "@/lib/x/types";
import { formatUsd2 } from "@/lib/format";
import { posNegClass, priceDirClass } from "@/lib/terminal/colors";

type WatchlistRow = { id: string; name: string; createdAt: string; itemCount: number };

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

type MoversPayload = {
  ok: boolean;
  scope?: string;
  basketKey?: string; // legacy
  gainers?: NormalizedQuote[];
  losers?: NormalizedQuote[];
  error?: string;
};

type OptionFlowPayload = {
  ok: boolean;
  source?: string;
  hint?: string;
  detail?: string;
  scanned?: number;
  items?: Array<{ symbol: string; totalOptionVolume: number }>;
};

type SortCol = "symbol" | "company" | "last" | "chgPct" | "chg" | "volume" | "volX";
type VolumeInfo = { volume: number | null; avgVolume20: number | null; ratio: number | null; flagged: boolean };
type QuickGlance = {
  portfolioPct: number | null;
  spyPct: number | null;
  qqqPct: number | null;
  updatedAt: string;
};

type TerminalCol = "symbol" | "company" | "last" | "chg" | "chgPct" | "volume" | "volX";

const DEFAULT_TERMINAL_COL_ORDER: TerminalCol[] = ["symbol", "company", "last", "chg", "chgPct", "volume", "volX"];

const PCT2 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function pctToTileStyle(pct: number | null): CSSProperties | undefined {
  if (pct == null || !Number.isFinite(pct)) return undefined;
  const cap = 8;
  const t = clamp(Math.abs(pct) / cap, 0, 1);
  // Emerald-400 / red-400 — reads clearly on near-black UIs
  const base = pct >= 0 ? "52,211,153" : "248,113,113";
  const a1 = 0.26 + 0.32 * t;
  const a2 = 0.11 + 0.22 * t;
  const a3 = Math.max(a2 - 0.07, 0.06);
  const glowA = 0.22 + 0.28 * t;
  return {
    background: `linear-gradient(145deg, rgba(${base},${a1}) 0%, rgba(${base},${a2}) 52%, rgba(${base},${a3}) 100%)`,
    borderColor: pct >= 0 ? `rgba(52,211,153,${0.35 + 0.25 * t})` : `rgba(248,113,113,${0.35 + 0.25 * t})`,
    boxShadow: pct >= 0
      ? `0 0 28px -6px rgba(52,211,153,${glowA * 0.45}), inset 0 1px 0 0 rgba(255,255,255,${0.1 + 0.12 * t})`
      : `0 0 28px -6px rgba(248,113,113,${glowA * 0.45}), inset 0 1px 0 0 rgba(255,255,255,${0.08 + 0.08 * t})`,
  };
}

/** Horizontal vivid strip behind mover / volume rows (dark theme). */
function sentimentRowBackground(changeFraction: number | null): CSSProperties {
  if (changeFraction == null || !Number.isFinite(changeFraction)) return {};
  const pctPts = changeFraction * 100;
  const mag = clamp(Math.abs(pctPts), 0, 15) / 15;
  const widthPct = 28 + mag * 72;
  const pos = pctPts >= 0;
  const rgb = pos ? "52,211,153" : "248,113,113";
  return {
    backgroundImage: `linear-gradient(90deg, rgba(${rgb},0.5) 0%, rgba(${rgb},0.22) ${Math.round(widthPct * 0.45)}%, rgba(${rgb},0.08) ${widthPct}%, transparent ${widthPct}%)`,
  };
}

function usd2Masked(v: number, masked: boolean) {
  return formatUsd2(v, { mask: masked });
}

function num(v: number | null) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function volRatioLabel(ratio: number | null) {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  return ratio >= 10 ? `${ratio.toFixed(0)}×` : `${ratio.toFixed(1)}×`;
}

/** Header control only — must sit inside a single parent `<th>` (never wrap in another `<th>`). */
function SortTh({
  col,
  label,
  sortCol,
  sortAsc,
  onToggle,
  align = "right",
}: {
  col: SortCol;
  label: string;
  sortCol: SortCol;
  sortAsc: boolean;
  onToggle: (c: SortCol) => void;
  align?: "left" | "right";
}) {
  const active = sortCol === col;
  const arrow = active ? (sortAsc ? " ▲" : " ▼") : "";
  return (
    <button
      type="button"
      onClick={() => onToggle(col)}
      className={
        "inline-flex w-full items-center gap-1 hover:underline underline-offset-4 " +
        (align === "right" ? "justify-end" : "justify-start")
      }
    >
      <span>{label}</span>
      <span className="text-[10px] opacity-70">{arrow}</span>
    </button>
  );
}

export default function TerminalPage() {
  const router = useRouter();
  const privacy = usePrivacy();
  const [watchlists, setWatchlists] = useState<WatchlistRow[]>([]);
  const [watchlistId, setWatchlistId] = useState<string | null>(null);
  const [symbols, setSymbols] = useState<string[]>([]);
  const [quotes, setQuotes] = useState<NormalizedQuote[]>([]);
  const [movers, setMovers] = useState<MoversPayload | null>(null);
  const [optionFlow, setOptionFlow] = useState<OptionFlowPayload | null>(null);
  const [volumeInfo, setVolumeInfo] = useState<Map<string, VolumeInfo>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(0);
  const [sortCol, setSortCol] = useState<SortCol>("chgPct");
  const [sortAsc, setSortAsc] = useState(false);
  const [colOrder, setColOrder] = useState<TerminalCol[]>(DEFAULT_TERMINAL_COL_ORDER);
  const [companyBySymbol, setCompanyBySymbol] = useState<Map<string, string>>(new Map());
  const [news, setNews] = useState<
    Array<{ title: string; link: string; pubDate: string; symbols: string[]; category: string; source?: string }>
  >([]);
  const [xDigest, setXDigest] = useState<Pick<XDigestPayload, "sections" | "posts" | "generatedAt"> | null>(null);
  const [xDigestLoading, setXDigestLoading] = useState(false);
  const [xDigestError, setXDigestError] = useState<string | null>(null);
  const [volumeLeadersMode, setVolumeLeadersMode] = useState<"volume" | "volX">("volume");
  const [heatView, setHeatView] = useState<"portfolio" | "spy" | "qqq">("portfolio");
  const [heatItems, setHeatItems] = useState<HeatmapItem[]>([]);
  const [quick, setQuick] = useState<QuickGlance | null>(null);
  const [futuresItems, setFuturesItems] = useState<
    Array<{ symbol: string; quote: NormalizedQuote; series: Array<{ date: string; close: number }> }>
  >([]);
  const [clockTick, setClockTick] = useState(() => Date.now());

  const heatInit = useRef(false);
  const volInit = useRef(false);
  const newsInit = useRef(false);
  const heatViewPrimed = useRef(false);

  async function loadWatchlists() {
    const resp = await fetch("/api/watchlists", { cache: "no-store" });
    const json = (await resp.json()) as { ok: boolean; watchlists?: WatchlistRow[]; error?: string };
    if (!json.ok) throw new Error(json.error ?? "Failed to load watchlists");
    setWatchlists(json.watchlists ?? []);
  }

  async function loadUniverse(nextWatchlistId: string | null) {
    const params = new URLSearchParams();
    params.set("scope", heatView);
    if (heatView === "portfolio" && nextWatchlistId) params.set("watchlistId", nextWatchlistId);
    const q = params.toString() ? `?${params.toString()}` : "";
    const resp = await fetch(`/api/terminal/universe${q}`, { cache: "no-store" });
    const json = (await resp.json()) as { ok: boolean; symbols?: string[]; error?: string };
    if (!json.ok) throw new Error(json.error ?? "Failed to load terminal universe");
    setSymbols(json.symbols ?? []);
  }

  async function loadCompanyNames(symList: string[]) {
    if (symList.length === 0) {
      setCompanyBySymbol(new Map());
      return;
    }
    try {
      const resp = await fetch("/api/terminal/company-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: symList }),
      });
      const json = (await resp.json()) as { ok?: boolean; names?: Record<string, string | null> };
      if (!json.ok || !json.names) return;
      const m = new Map<string, string>();
      for (const [k, v] of Object.entries(json.names)) {
        const name = (v ?? "").trim();
        if (name) m.set(k.toUpperCase(), name);
      }
      setCompanyBySymbol(m);
    } catch {
      // ignore
    }
  }

  async function loadQuotes(symList: string[]) {
    if (symList.length === 0) {
      setQuotes([]);
      setLastUpdatedAt(new Date().toISOString());
      return;
    }
    const resp = await fetch("/api/quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: symList }),
    });
    const json = (await resp.json()) as { ok: boolean; quotes?: NormalizedQuote[]; error?: string };
    if (!json.ok) throw new Error(json.error ?? "Failed to load quotes");
    setQuotes(json.quotes ?? []);
    setLastUpdatedAt(new Date().toISOString());
  }

  async function loadVolumeAnomalies(symList: string[]) {
    if (symList.length === 0) {
      setVolumeInfo(new Map());
      return;
    }
    const resp = await fetch("/api/terminal/volume-anomalies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: symList }),
    });
    const json = (await resp.json()) as {
      ok: boolean;
      anomalies?: Record<string, VolumeInfo>;
      error?: string;
    };
    if (!json.ok) throw new Error(json.error ?? "Failed to load volume anomalies");
    const m = new Map<string, VolumeInfo>();
    for (const [k, v] of Object.entries(json.anomalies ?? {})) m.set(k.toUpperCase(), v);
    setVolumeInfo(m);
  }

  async function loadNews(symList: string[]) {
    const focus = symList.slice(0, 8).join(",");
    const anoms = Array.from(volumeInfo.entries())
      .filter(([, v]) => v.flagged)
      .map(([k]) => k)
      .slice(0, 8)
      .join(",");
    const qs = `?symbols=${encodeURIComponent(focus)}&anomalies=${encodeURIComponent(anoms)}`;
    const resp = await fetch(`/api/terminal/news${qs}`, { cache: "no-store" });
    const json = (await resp.json()) as { ok: boolean; items?: typeof news; error?: string };
    if (!json.ok) throw new Error(json.error ?? "Failed to load news");
    setNews(json.items ?? []);
  }

  async function fetchXDigestFromX() {
    setXDigestError(null);
    setXDigestLoading(true);
    try {
      const resp = await fetch("/api/terminal/x-digest/refresh", { method: "POST" });
      const json = (await resp.json()) as {
        ok: boolean;
        error?: string;
        empty?: boolean;
        sections?: XDigestPayload["sections"];
        posts?: XDigestPayload["posts"];
        generatedAt?: string;
      };
      if (!json.ok) {
        setXDigest(null);
        setXDigestError(json.error ?? "Failed to refresh X digest");
        return;
      }
      const generatedAt = json.generatedAt ?? new Date().toISOString();
      if (json.empty || !json.sections?.length) {
        setXDigest({ sections: [], posts: json.posts ?? {}, generatedAt });
        return;
      }
      setXDigest({
        sections: json.sections,
        posts: json.posts ?? {},
        generatedAt,
      });
    } catch (e) {
      setXDigest(null);
      setXDigestError(e instanceof Error ? e.message : String(e));
    } finally {
      setXDigestLoading(false);
    }
  }

  async function loadHeatmap(nextWatchlistId: string | null) {
    const wl = nextWatchlistId ? `&watchlistId=${encodeURIComponent(nextWatchlistId)}` : "";
    const resp = await fetch(`/api/terminal/heatmap?view=${encodeURIComponent(heatView)}${wl}`, { cache: "no-store" });
    const json = (await resp.json()) as { ok: boolean; items?: HeatmapItem[]; error?: string };
    if (!json.ok) throw new Error(json.error ?? "Failed to load heatmap");
    setHeatItems(json.items ?? []);
  }

  async function loadMovers(nextWatchlistId: string | null) {
    const wl = nextWatchlistId ? `&watchlistId=${encodeURIComponent(nextWatchlistId)}` : "";
    const resp = await fetch(`/api/terminal/movers?scope=combined&top=50${wl}`, { cache: "no-store" });
    const json = (await resp.json()) as MoversPayload;
    setMovers(json);
  }

  async function loadOptionFlow(nextWatchlistId: string | null) {
    try {
      const qs = new URLSearchParams();
      if (nextWatchlistId) qs.set("watchlistId", nextWatchlistId);
      const resp = await fetch(`/api/terminal/option-flow?${qs.toString()}`, { cache: "no-store" });
      const json = (await resp.json()) as OptionFlowPayload;
      setOptionFlow(json);
    } catch (e) {
      setOptionFlow({
        ok: true,
        source: "unavailable",
        hint: e instanceof Error ? e.message : String(e),
        items: [],
      });
    }
  }

  async function refreshAll(nextWatchlistId: string | null) {
    setError(null);
    try {
      await Promise.all([
        loadWatchlists().catch(() => null),
        loadUniverse(nextWatchlistId),
        loadMovers(nextWatchlistId),
        loadOptionFlow(nextWatchlistId),
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function loadFutures() {
    try {
      const resp = await fetch("/api/terminal/futures", { cache: "no-store" });
      const json = (await resp.json()) as {
        ok: boolean;
        items?: Array<{ symbol: string; quote: NormalizedQuote; series: Array<{ date: string; close: number }> }>;
      };
      if (json.ok) setFuturesItems(json.items ?? []);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    const t = setTimeout(() => void refreshAll(watchlistId), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = setInterval(() => setClockTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!heatViewPrimed.current) {
      heatViewPrimed.current = true;
      return;
    }
    void loadUniverse(watchlistId).catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heatView, watchlistId]);

  useEquityMarketPolling(
    () => {
      void (async () => {
        try {
          await loadUniverse(watchlistId);
          await loadMovers(watchlistId);
          await loadOptionFlow(watchlistId);
        } catch {
          // ignore
        }
      })();
    },
    60_000,
    [watchlistId, heatView],
  );

  useEffect(() => {
    const allowed = new Set<TerminalCol>(["symbol", "company", "last", "chg", "chgPct", "volume", "volX"]);
    const legacyAllowed = new Set<string>(["symbol", "last", "chg", "chgPct", "volume", "volX"]);

    function normalizeOrder(parsed: unknown): TerminalCol[] | null {
      if (!Array.isArray(parsed)) return null;
      let clean = parsed.filter((x) => typeof x === "string" && allowed.has(x as TerminalCol)) as TerminalCol[];
      if (clean.length === 0) {
        clean = parsed.filter((x) => typeof x === "string" && legacyAllowed.has(x as string)) as TerminalCol[];
      }
      if (clean.length === 0) return null;
      if (!clean.includes("company")) {
        const i = clean.indexOf("symbol");
        if (i >= 0) clean.splice(i + 1, 0, "company");
        else clean = ["symbol", "company", ...clean.filter((c) => c !== "symbol")];
      }
      for (const c of DEFAULT_TERMINAL_COL_ORDER) {
        if (!clean.includes(c)) clean.push(c);
      }
      return clean;
    }

    try {
      const rawV2 = localStorage.getItem("terminal_table_column_order_v2");
      if (rawV2) {
        const clean = normalizeOrder(JSON.parse(rawV2) as unknown);
        if (clean?.length) {
          setTimeout(() => setColOrder(clean), 0);
          return;
        }
      }
      const rawV1 = localStorage.getItem("terminal_table_column_order_v1");
      if (rawV1) {
        const clean = normalizeOrder(JSON.parse(rawV1) as unknown);
        if (clean?.length) setTimeout(() => setColOrder(clean), 0);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("terminal_table_column_order_v2", JSON.stringify(colOrder));
    } catch {
      // ignore
    }
  }, [colOrder]);

  useEffect(() => {
    const t = setTimeout(() => setNowMs(Date.now()), 0);
    return () => clearTimeout(t);
  }, [watchlistId, lastUpdatedAt]);

  useEffect(() => {
    if (symbols.length === 0) return;
    const t = setTimeout(() => void loadCompanyNames(symbols), 0);
    return () => clearTimeout(t);
  }, [symbols]);

  useEffect(() => {
    if (symbols.length === 0) return;
    const open = isUsEquityRegularSessionOpen(new Date());
    if (!open) return;
    const t = setTimeout(() => {
      void loadQuotes(symbols).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }, 0);
    return () => clearTimeout(t);
  }, [symbols]);

  const lastQuotesKeyClosed = useRef<string>("");
  useEffect(() => {
    if (symbols.length === 0) return;
    const open = isUsEquityRegularSessionOpen(new Date());
    if (open) return;
    const key = symbols.join(",");
    if (key === lastQuotesKeyClosed.current) return;
    lastQuotesKeyClosed.current = key;
    const t = setTimeout(() => {
      void loadQuotes(symbols).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }, 0);
    return () => clearTimeout(t);
  }, [symbols]);

  useEffect(() => {
    const t = setTimeout(() => {
      void (async () => {
        try {
          const posResp = await fetch("/api/positions", { cache: "no-store" });
          const posJson = (await posResp.json()) as {
            ok: boolean;
            positions?: Array<{ symbol: string | null; marketValue: number | null }>;
          };
          if (!posJson.ok) return;
          const mvBySym = new Map<string, number>();
          for (const p of posJson.positions ?? []) {
            const sym = (p.symbol ?? "").toUpperCase().trim();
            if (!sym || sym === "CASH") continue;
            const mv = p.marketValue;
            if (mv == null || !Number.isFinite(mv) || mv === 0) continue;
            mvBySym.set(sym, (mvBySym.get(sym) ?? 0) + mv);
          }

          const qMap = new Map<string, NormalizedQuote>();
          for (const q of quotes) qMap.set(q.symbol.toUpperCase(), q);

          const idxResp = await fetch("/api/quotes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ symbols: ["SPY", "QQQ"] }),
          });
          const idxJson = (await idxResp.json()) as { ok: boolean; quotes?: NormalizedQuote[] };
          for (const q of idxJson.quotes ?? []) qMap.set(q.symbol.toUpperCase(), q);

          let cur = 0;
          let prev = 0;
          for (const [sym, mv] of mvBySym.entries()) {
            const q = qMap.get(sym);
            const pct = q?.changePercent ?? null;
            if (pct == null || !Number.isFinite(pct)) continue;
            cur += mv;
            // NormalizedQuote.changePercent is a fraction (e.g. 0.0123), not percent points.
            prev += mv / (1 + pct);
          }

          const portfolioPct = prev > 0 ? (cur / prev - 1) * 100 : null;
          const spyPct = qMap.get("SPY")?.changePercent == null ? null : qMap.get("SPY")!.changePercent! * 100;
          const qqqPct = qMap.get("QQQ")?.changePercent == null ? null : qMap.get("QQQ")!.changePercent! * 100;
          setQuick({ portfolioPct, spyPct, qqqPct, updatedAt: new Date().toISOString() });
        } catch {
          // ignore
        }
      })();
    }, 0);
    return () => clearTimeout(t);
  }, [quotes, lastUpdatedAt]);

  useEffect(() => {
    if (symbols.length === 0) return;
    const open = isUsEquityRegularSessionOpen(new Date());
    if (!open && heatInit.current) return;
    heatInit.current = true;
    const t = setTimeout(() => {
      void loadHeatmap(watchlistId).catch(() => null);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchlistId, heatView, symbols]);

  useEffect(() => {
    if (symbols.length === 0) return;
    const open = isUsEquityRegularSessionOpen(new Date());
    if (!open && volInit.current) return;
    volInit.current = true;
    const t = setTimeout(() => {
      void loadVolumeAnomalies(symbols).catch(() => null);
    }, 0);
    return () => clearTimeout(t);
  }, [symbols]);

  useEffect(() => {
    if (symbols.length === 0) return;
    const open = isUsEquityRegularSessionOpen(new Date());
    if (!open && newsInit.current) return;
    newsInit.current = true;
    const t = setTimeout(() => {
      void loadNews(symbols).catch(() => null);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols, volumeInfo]);

  useEffect(() => {
    let five: ReturnType<typeof setInterval> | null = null;
    const run = () => void loadFutures();
    void run();
    const sync = () => {
      if (isUsEquityPreOpenFuturesPollWindow(new Date())) {
        if (five == null) {
          void run();
          five = setInterval(run, 300_000);
        }
      } else if (five != null) {
        clearInterval(five);
        five = null;
      }
    };
    sync();
    const meta = setInterval(sync, 60_000);
    return () => {
      clearInterval(meta);
      if (five != null) clearInterval(five);
    };
  }, []);

  function toggleSort(c: SortCol) {
    if (sortCol === c) setSortAsc((v) => !v);
    else {
      setSortCol(c);
      setSortAsc(c === "symbol" || c === "company" ? true : false);
    }
  }

  const sortedQuotes = useMemo(() => {
    const a = [...quotes];
    a.sort((x, y) => {
      let cmp = 0;
      switch (sortCol) {
        case "symbol":
          cmp = x.symbol.localeCompare(y.symbol, undefined, { numeric: true, sensitivity: "base" });
          break;
        case "company": {
          const na = (companyBySymbol.get(x.symbol.toUpperCase()) ?? "").toLowerCase();
          const nb = (companyBySymbol.get(y.symbol.toUpperCase()) ?? "").toLowerCase();
          cmp = na.localeCompare(nb, undefined, { sensitivity: "base" });
          break;
        }
        case "last":
          cmp = (num(x.last) ?? -Infinity) - (num(y.last) ?? -Infinity);
          break;
        case "chgPct":
          cmp = (num(x.changePercent) ?? -Infinity) - (num(y.changePercent) ?? -Infinity);
          break;
        case "chg":
          cmp = (num(x.change) ?? -Infinity) - (num(y.change) ?? -Infinity);
          break;
        case "volume":
          cmp = (num(x.volume) ?? -Infinity) - (num(y.volume) ?? -Infinity);
          break;
        case "volX": {
          const ax = volumeInfo.get(x.symbol)?.ratio ?? -Infinity;
          const bx = volumeInfo.get(y.symbol)?.ratio ?? -Infinity;
          cmp = ax - bx;
          break;
        }
      }
      if (cmp === 0) cmp = x.symbol.localeCompare(y.symbol);
      return sortAsc ? cmp : -cmp;
    });
    return a;
  }, [quotes, sortCol, sortAsc, volumeInfo, companyBySymbol]);

  const volumeLeaders = useMemo(() => {
    const rows = quotes
      .map((q) => {
        const v = volumeInfo.get(q.symbol);
        return { q, vol: q.volume ?? null, ratio: v?.ratio ?? null, flagged: v?.flagged ?? false };
      })
      .filter((r) => r.vol != null || r.ratio != null);

    rows.sort((a, b) => {
      if (volumeLeadersMode === "volX") {
        const cmp = (a.ratio ?? -Infinity) - (b.ratio ?? -Infinity);
        if (cmp !== 0) return -cmp;
        return ((b.vol ?? -Infinity) - (a.vol ?? -Infinity)) || a.q.symbol.localeCompare(b.q.symbol);
      }
      const cmp = (a.vol ?? -Infinity) - (b.vol ?? -Infinity);
      if (cmp !== 0) return -cmp;
      return ((b.ratio ?? -Infinity) - (a.ratio ?? -Infinity)) || a.q.symbol.localeCompare(b.q.symbol);
    });

    return rows.slice(0, 10);
  }, [quotes, volumeInfo, volumeLeadersMode]);

  const updatedLabel = useMemo(() => {
    if (!lastUpdatedAt) return "—";
    const ms = nowMs - new Date(lastUpdatedAt).getTime();
    if (!Number.isFinite(ms)) return "—";
    const sec = Math.max(0, Math.round(ms / 1000));
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    return `${min}m ago`;
  }, [lastUpdatedAt, nowMs]);

  const rthOpen = useMemo(() => isUsEquityRegularSessionOpen(new Date(clockTick)), [clockTick]);

  return (
    <div className="flex w-full max-w-7xl flex-1 flex-col gap-6 py-8 pl-4 pr-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Terminal</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Portfolio-aware quote monitor (holdings + option underlyings) with a big-name movers board. Live equity refresh runs every 60 seconds during US RTH only (09:30–16:00 ET).
          </p>
          {!rthOpen ? (
            <p className="mt-2 text-xs font-medium text-amber-800 dark:text-amber-200">
              Market closed — equity live refresh is paused. Futures (if configured) still update on their pre-open schedule.
            </p>
          ) : null}
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
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</div>
      ) : null}

      <section className="rounded-2xl border border-zinc-300 bg-white p-4 shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-semibold">Quick glance (today)</div>
          <div className="text-xs text-zinc-600 dark:text-zinc-400">{quick ? `Updated ${new Date(quick.updatedAt).toLocaleTimeString()}` : "—"}</div>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(
            [
              { key: "portfolio", label: "Portfolio", pct: quick?.portfolioPct ?? null },
              { key: "SPY", label: "SPY", pct: quick?.spyPct ?? null },
              { key: "QQQ", label: "QQQ", pct: quick?.qqqPct ?? null },
            ] as const
          ).map((r) => {
            const v = r.pct;
            const cls = posNegClass(v);
            return (
              <div
                key={r.key}
                style={pctToTileStyle(v)}
                className="rounded-xl border border-zinc-300 bg-white/60 px-4 py-3 dark:border-white/20 dark:bg-transparent"
              >
                <div className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{r.label}</div>
                <div className={"mt-1 text-lg font-semibold tabular-nums " + cls}>{v == null ? "—" : `${PCT2.format(v)}%`}</div>
              </div>
            );
          })}
        </div>
        <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
          Portfolio today % is computed from latest synced position market values weighted by each symbol’s % change (proxy).
        </div>
      </section>

      {futuresItems.length > 0 ? (
        <section className="rounded-2xl border border-zinc-300 bg-white p-4 shadow-sm dark:border-white/20 dark:bg-zinc-950">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold">Futures</div>
            <div className="text-[11px] text-zinc-600 dark:text-zinc-400">
              Set <span className="font-mono">TERMINAL_FUTURES_SYMBOLS</span> (e.g. <span className="font-mono">/ESM6,/NQM6</span>). Pre-open: every 5 min 08:30–09:30 ET; one fetch on load.
            </div>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {futuresItems.map((row) => {
              const last = row.quote.last ?? row.quote.mark;
              const pctPts = row.quote.changePercent == null ? null : row.quote.changePercent * 100;
              const chartData = row.series.map((p, idx) => ({ idx, c: p.close }));
              return (
                <div
                  key={row.symbol}
                  className="rounded-xl border border-zinc-300 bg-white/70 p-3 dark:border-white/20 dark:bg-black/20"
                >
                  <div className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100">{row.symbol}</div>
                  <div className="mt-1 grid grid-cols-2 gap-1 text-xs tabular-nums text-zinc-700 dark:text-zinc-300">
                    <div>Last</div>
                    <div className="text-right font-medium">{last == null ? "—" : last.toFixed(2)}</div>
                    <div>Chg %</div>
                    <div className={"text-right font-medium " + posNegClass(pctPts)}>{pctPts == null ? "—" : `${PCT2.format(pctPts)}%`}</div>
                  </div>
                  {chartData.length >= 2 ? (
                    <div className="mt-2 h-24 w-full min-w-0">
                      <ResponsiveContainer
                        width="100%"
                        height="100%"
                        minWidth={64}
                        minHeight={96}
                        initialDimension={{ width: 200, height: 96 }}
                      >
                        <LineChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                          <Line type="monotone" dataKey="c" dot={false} strokeWidth={1.5} stroke="#0f766e" />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="mt-2 text-[11px] text-zinc-500">No history cached yet.</div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="min-w-0 rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Watchlist overlay</div>
            <select
              value={watchlistId ?? ""}
              onChange={(e) => {
                const next = e.target.value || null;
                setWatchlistId(next);
                void refreshAll(next);
              }}
              className="h-9 rounded-lg border border-zinc-300 bg-white px-2 text-sm text-zinc-900 shadow-sm dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100"
            >
              <option value="">(none)</option>
              {watchlists.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.itemCount})
                </option>
              ))}
            </select>
            <Link href="/terminal/watchlists" className="text-sm font-medium text-zinc-900 underline-offset-4 hover:underline dark:text-zinc-100">
              Manage
            </Link>
          </div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            {symbols.length} symbols • Updated {updatedLabel}
          </div>
        </div>

        <details open className="mt-4 rounded-xl border border-zinc-300 bg-white/60 p-4 dark:border-white/20 dark:bg-black/20">
          <summary className="cursor-pointer list-none">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-semibold">Market heatmap (cap-weighted)</div>
              <div className="flex items-center gap-1">
                {(
                  [
                    { key: "spy", label: "SPY" },
                    { key: "qqq", label: "QQQ" },
                    { key: "portfolio", label: "Net portfolio" },
                  ] as const
                ).map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setHeatView(v.key);
                    }}
                    className={
                      "h-9 min-w-[5.5rem] whitespace-nowrap rounded-md px-3 text-sm font-semibold " +
                      (heatView === v.key
                        ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                        : "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5")
                    }
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          </summary>
          <div className="mt-3 min-w-0">
            <HeatmapGrid items={heatItems.slice(0, 220)} onPick={(s) => router.push(`/terminal/symbol/${encodeURIComponent(s)}`)} />
            {heatItems.length === 0 ? <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">No heatmap data yet.</div> : null}
          </div>
        </details>

        <div className="mt-4 grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex min-w-0 flex-col gap-4">
            <div className="min-w-0 overflow-x-auto rounded-xl ring-1 ring-zinc-300 dark:ring-white/20">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-300 bg-zinc-50 text-left text-zinc-600 dark:border-white/20 dark:bg-zinc-900/40 dark:text-zinc-400">
                  {colOrder.map((c) => {
                    const label =
                      c === "symbol"
                        ? "Symbol"
                        : c === "company"
                          ? "Company"
                          : c === "last"
                            ? "Last"
                            : c === "chg"
                              ? "$ Chg"
                              : c === "chgPct"
                                ? "% Chg"
                                : c === "volume"
                                  ? "Volume"
                                  : "Vol ×";
                    const align = c === "symbol" || c === "company" ? "left" : "right";
                    const colActive = sortCol === c;
                    const ariaSort = colActive ? (sortAsc ? "ascending" : "descending") : "none";
                    return (
                      <th
                        key={c}
                        draggable
                        aria-sort={ariaSort}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", c);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const from = e.dataTransfer.getData("text/plain") as TerminalCol;
                          if (!from || from === c) return;
                          const allowedCols = new Set<TerminalCol>([
                            "symbol",
                            "company",
                            "last",
                            "chg",
                            "chgPct",
                            "volume",
                            "volX",
                          ]);
                          if (!allowedCols.has(from)) return;
                          setColOrder((prev) => {
                            const next = [...prev];
                            const i = next.indexOf(from);
                            const j = next.indexOf(c);
                            if (i < 0 || j < 0) return prev;
                            next.splice(i, 1);
                            next.splice(j, 0, from);
                            return next;
                          });
                        }}
                        title="Drag to reorder columns"
                        className={
                          "py-2 pr-4 font-medium " + (align === "right" ? "text-right" : "text-left")
                        }
                      >
                        <SortTh col={c} label={label} sortCol={sortCol} sortAsc={sortAsc} onToggle={toggleSort} align={align as "left" | "right"} />
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedQuotes.map((q) => {
                  const chg = q.change ?? null;
                  const chgPct = q.changePercent == null ? null : q.changePercent * 100;
                  const v = volumeInfo.get(q.symbol);
                  return (
                    <tr
                      key={q.symbol}
                      className="border-b border-zinc-200 hover:bg-zinc-50/70 dark:border-white/20 dark:hover:bg-white/5"
                      onClick={() => router.push(`/terminal/symbol/${encodeURIComponent(q.symbol)}`)}
                    >
                      {colOrder.map((c) => {
                        switch (c) {
                          case "symbol":
                            return (
                              <td key={c} className="py-2 pr-4 font-semibold">
                                <span className="hover:underline underline-offset-4">{q.symbol}</span>
                              </td>
                            );
                          case "company": {
                            const cn = companyBySymbol.get(q.symbol.toUpperCase()) ?? "";
                            return (
                              <td key={c} className="max-w-[16rem] py-2 pr-4 text-left align-top text-sm text-zinc-700 dark:text-zinc-300">
                                <span className="line-clamp-2" title={cn || undefined}>
                                  {cn || "—"}
                                </span>
                              </td>
                            );
                          }
                          case "last":
                            return (
                              <td key={c} className={"py-2 pr-4 text-right tabular-nums " + priceDirClass(q.last, q.close)}>
                                {q.last == null ? "—" : q.last.toFixed(2)}
                              </td>
                            );
                          case "chg":
                            return (
                              <td key={c} className={"py-2 pr-4 text-right tabular-nums " + posNegClass(chg)}>
                                {chg == null ? "—" : usd2Masked(chg, privacy.masked)}
                              </td>
                            );
                          case "chgPct":
                            return (
                              <td key={c} className={"py-2 pr-4 text-right tabular-nums " + posNegClass(chgPct)}>
                                {chgPct == null ? "—" : PCT2.format(chgPct) + "%"}
                              </td>
                            );
                          case "volume":
                            return (
                              <td key={c} className="py-2 pr-4 text-right tabular-nums">
                                {q.volume == null ? "—" : Math.round(q.volume).toLocaleString()}
                              </td>
                            );
                          case "volX":
                            return (
                              <td key={c} className={"py-2 pr-4 text-right tabular-nums " + (v?.flagged ? "font-semibold text-amber-700 dark:text-amber-300" : "text-zinc-600 dark:text-zinc-400")}>
                                {volRatioLabel(v?.ratio ?? null)}
                              </td>
                            );
                        }
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>

            <div className="flex min-w-0 flex-col gap-4">
              <div className="rounded-xl border border-zinc-300 bg-white/60 p-4 dark:border-white/20 dark:bg-black/20">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm font-semibold">X digest</div>
                  <button
                    type="button"
                    disabled={xDigestLoading}
                    onClick={() => void fetchXDigestFromX()}
                    className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
                  >
                    {xDigestLoading ? "Fetching…" : "Fetch from X"}
                  </button>
                </div>
                <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
                  Loads your home timeline (24h), updates the local digest cache, and shows themed ideas. Not run automatically.
                </p>
                {xDigestError ? (
                  <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">
                    {xDigestError}
                  </div>
                ) : null}
                {xDigest?.generatedAt ? (
                  <div className="mt-3">
                    <XDataAgeBanner generatedAt={xDigest.generatedAt} />
                  </div>
                ) : null}
              </div>
              {xDigest && xDigest.sections.length > 0 ? (
                <XNewsSection variant="digest" payload={xDigest} showTitle={false} />
              ) : xDigest && xDigest.sections.length === 0 ? (
                <XNewsSection
                  variant="digest"
                  payload={xDigest}
                  showTitle={false}
                  emptyMessage="Fetch completed but no themed sections were produced (empty 24h window or summarizer output)."
                />
              ) : null}
              <div className="min-w-0 rounded-2xl border border-zinc-300 bg-white p-4 shadow-sm dark:border-white/20 dark:bg-zinc-950">
                <div className="text-sm font-semibold">News</div>
                <div className="mt-2 grid gap-2">
                  {news.slice(0, 10).map((n) => (
                    <a
                      key={n.link}
                      href={n.link}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-zinc-300 bg-white/70 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:hover:bg-white/5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-semibold">{n.title}</span>
                            {n.source ? (
                              <span className="shrink-0 rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-800 dark:bg-white/15 dark:text-zinc-200">
                                {n.source}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                            {(n.category === "highVolume" ? "High volume" : n.category === "watchlist" ? "Watchlist" : "Macro") +
                              (n.symbols?.length ? ` • ${n.symbols.slice(0, 4).join(",")}` : "")}
                          </div>
                        </div>
                        <div className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">{n.pubDate ? n.pubDate.slice(0, 16) : ""}</div>
                      </div>
                    </a>
                  ))}
                  {news.length === 0 ? <div className="text-sm text-zinc-600 dark:text-zinc-400">No headlines yet.</div> : null}
                </div>
              </div>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <div className="min-w-0 rounded-2xl border border-zinc-300 bg-white p-4 shadow-sm dark:border-white/20 dark:bg-zinc-950">
              <div className="text-sm font-semibold">Movers</div>
              {movers?.ok === false ? (
                <div className="mt-2 text-xs text-red-700 dark:text-red-300">{movers.error ?? "Failed to load movers"}</div>
              ) : null}

              <div className="mt-2 grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">Top gainers</div>
                  <div className="mt-1 grid gap-1">
                    {(movers?.gainers ?? []).slice(0, 8).map((q) => (
                      <button
                        key={q.symbol}
                        type="button"
                        onClick={() => router.push(`/terminal/symbol/${encodeURIComponent(q.symbol)}`)}
                        style={sentimentRowBackground(q.changePercent)}
                        className="relative flex w-full items-center justify-between overflow-hidden rounded-md border border-zinc-300 bg-white/70 px-2 py-1 text-xs dark:border-white/15 dark:bg-zinc-950/40"
                        title="Open symbol"
                      >
                        <span className="font-semibold">{q.symbol}</span>
                        <span className={"tabular-nums " + posNegClass(q.changePercent == null ? null : q.changePercent * 100)}>
                          {q.changePercent == null ? "—" : PCT2.format(q.changePercent * 100) + "%"}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">Top losers</div>
                  <div className="mt-1 grid gap-1">
                    {(movers?.losers ?? []).slice(0, 8).map((q) => (
                      <button
                        key={q.symbol}
                        type="button"
                        onClick={() => router.push(`/terminal/symbol/${encodeURIComponent(q.symbol)}`)}
                        style={sentimentRowBackground(q.changePercent)}
                        className="relative flex w-full items-center justify-between overflow-hidden rounded-md border border-zinc-300 bg-white/70 px-2 py-1 text-xs dark:border-white/15 dark:bg-zinc-950/40"
                        title="Open symbol"
                      >
                        <span className="font-semibold">{q.symbol}</span>
                        <span className={"tabular-nums " + posNegClass(q.changePercent == null ? null : q.changePercent * 100)}>
                          {q.changePercent == null ? "—" : PCT2.format(q.changePercent * 100) + "%"}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-5">
                <div className="text-sm font-semibold">Top option flow</div>
                <div className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
                  Total option volume from Schwab chains (subset of your terminal universe).
                </div>
                {optionFlow?.source === "unavailable" && (optionFlow.hint || optionFlow.detail) ? (
                  <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
                    {optionFlow.hint ?? optionFlow.detail}
                  </div>
                ) : null}
                <div className="mt-2 grid gap-1">
                  {(optionFlow?.items ?? []).slice(0, 10).map((it) => (
                    <button
                      key={it.symbol}
                      type="button"
                      onClick={() => router.push(`/terminal/symbol/${encodeURIComponent(it.symbol)}`)}
                      className="flex w-full items-center justify-between rounded-md border border-zinc-300 bg-white/70 px-2 py-1.5 text-xs dark:border-white/15 dark:bg-zinc-950/40"
                      title="Open symbol"
                    >
                      <span className="font-semibold">{it.symbol}</span>
                      <span className="tabular-nums text-zinc-700 dark:text-zinc-300">
                        {Math.round(it.totalOptionVolume).toLocaleString()} opt vol
                      </span>
                    </button>
                  ))}
                  {optionFlow?.ok && (optionFlow.items?.length ?? 0) === 0 && optionFlow.source === "schwab" ? (
                    <div className="text-sm text-zinc-600 dark:text-zinc-400">No chain volume in the scanned set.</div>
                  ) : null}
                  {!optionFlow ? <div className="text-sm text-zinc-600 dark:text-zinc-400">Loading…</div> : null}
                </div>
              </div>

              <div className="mt-5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">Volume leaders</div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setVolumeLeadersMode("volume")}
                      className={
                        "h-9 min-w-[3.25rem] whitespace-nowrap rounded-md px-3 text-sm font-semibold " +
                        (volumeLeadersMode === "volume"
                          ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                          : "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5")
                      }
                      title="Sort by raw volume"
                    >
                      Vol
                    </button>
                    <button
                      type="button"
                      onClick={() => setVolumeLeadersMode("volX")}
                      className={
                        "h-9 min-w-[3.25rem] whitespace-nowrap rounded-md px-3 text-sm font-semibold " +
                        (volumeLeadersMode === "volX"
                          ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                          : "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5")
                      }
                      title="Sort by unusual volume multiple (Vol×)"
                    >
                      Vol×
                    </button>
                  </div>
                </div>
                <div className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">From your terminal universe (portfolio + watchlist overlay)</div>
                <div className="mt-2 grid gap-1">
                  {volumeLeaders.slice(0, 8).map(({ q, vol, ratio, flagged }) => (
                    <button
                      key={q.symbol}
                      type="button"
                      onClick={() => router.push(`/terminal/symbol/${encodeURIComponent(q.symbol)}`)}
                      style={sentimentRowBackground(q.changePercent)}
                      className="relative flex w-full items-center justify-between overflow-hidden rounded-md border border-zinc-300 bg-white/70 px-2 py-1 text-xs dark:border-white/15 dark:bg-zinc-950/40"
                      title="Set active symbol"
                    >
                      <span className="font-semibold">{q.symbol}</span>
                      <span className="flex items-center gap-2 tabular-nums">
                        <span className={"w-[4.5rem] text-right " + posNegClass(q.changePercent == null ? null : q.changePercent * 100)}>
                          {q.changePercent == null ? "—" : PCT2.format(q.changePercent * 100) + "%"}
                        </span>
                        <span className={flagged ? "font-semibold text-amber-700 dark:text-amber-300" : "text-zinc-600 dark:text-zinc-400"}>
                          {volRatioLabel(ratio)}
                        </span>
                        <span className="text-zinc-700 dark:text-zinc-300">{vol == null ? "—" : Math.round(vol).toLocaleString()}</span>
                      </span>
                    </button>
                  ))}
                  {volumeLeaders.length === 0 ? <div className="text-sm text-zinc-600 dark:text-zinc-400">No volume data yet.</div> : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

