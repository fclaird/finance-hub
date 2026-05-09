import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { schwabMarketFetch } from "@/lib/schwab/client";
import { BASKETS, type TerminalBasketKey } from "@/lib/terminal/baskets";
import { computeMovers } from "@/lib/terminal/movers";
import { SP500_SYMBOLS } from "@/lib/terminal/universes/sp500";
import { DATA_MODE_COOKIE, parseDataMode } from "@/lib/dataMode";
import { getTerminalUniverseSymbols } from "@/lib/terminal/universe";

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function extractQuoteObject(entry: unknown): Record<string, unknown> | null {
  if (!entry || typeof entry !== "object") return null;
  const obj = entry as Record<string, unknown>;
  const quote = obj.quote;
  if (quote && typeof quote === "object") return quote as Record<string, unknown>;
  return obj;
}

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const scope = (url.searchParams.get("scope") ?? "basket").trim() as "basket" | "sp500" | "myUniverse" | "combined";
  const basketKey = (url.searchParams.get("basket") ?? "big50").trim() as TerminalBasketKey;
  const top = Math.max(1, Math.min(100, Number(url.searchParams.get("top") ?? "50") || 50));
  const watchlistId = url.searchParams.get("watchlistId");

  let symbols: string[] = [];
  if (scope === "sp500") {
    symbols = SP500_SYMBOLS.map(normSym).filter(Boolean);
  } else if (scope === "myUniverse" || scope === "combined") {
    const jar = await cookies();
    const mode = parseDataMode(jar.get(DATA_MODE_COOKIE)?.value);
    const mine = getTerminalUniverseSymbols({ mode, includeWatchlistId: watchlistId });
    if (scope === "combined") {
      symbols = Array.from(new Set([...SP500_SYMBOLS.map(normSym), ...mine.map(normSym)].filter(Boolean)));
    } else {
      symbols = mine;
    }
  } else {
    symbols = (BASKETS[basketKey] ?? []).map(normSym).filter(Boolean);
  }

  if (symbols.length === 0) return NextResponse.json({ ok: false, error: "No symbols for scope" }, { status: 400 });

  const BATCH = 100;
  const quotes: Array<{
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
  }> = [];

  const nowIso = new Date().toISOString();
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    const resp = await schwabMarketFetch<Record<string, unknown>>(`/quotes?symbols=${encodeURIComponent(batch.join(","))}`);
    for (const sym of batch) {
      const entry = resp[sym] ?? resp[sym.toUpperCase()];
      const q = extractQuoteObject(entry);
      if (!q) {
        quotes.push({
          symbol: sym,
          last: null,
          bid: null,
          ask: null,
          mark: null,
          close: null,
          open: null,
          high: null,
          low: null,
          volume: null,
          change: null,
          changePercent: null,
          updatedAt: nowIso,
        });
        continue;
      }

      const last = asNumber(q.lastPrice) ?? null;
      const bid = asNumber(q.bidPrice ?? q.bid) ?? null;
      const ask = asNumber(q.askPrice ?? q.ask) ?? null;
      const mark = asNumber(q.mark) ?? null;
      const close = asNumber(q.closePrice) ?? null;
      const open = asNumber(q.openPrice) ?? null;
      const high = asNumber(q.highPrice) ?? null;
      const low = asNumber(q.lowPrice) ?? null;
      const volume = asNumber(q.totalVolume ?? q.volume) ?? null;
      const change = asNumber(q.netChange ?? q.change) ?? (last != null && close != null ? last - close : null);
      const changePercent =
        asNumber(q.netPercentChangeInDouble ?? q.changePercent) ??
        (change != null && close != null && close !== 0 ? change / close : null);

      quotes.push({
        symbol: sym,
        last,
        bid,
        ask,
        mark,
        close,
        open,
        high,
        low,
        volume,
        change,
        changePercent,
        updatedAt: nowIso,
      });
    }
  }

  const key = scope === "basket" ? basketKey : scope;
  const movers = computeMovers(key, quotes, top);
  return NextResponse.json({ ok: true, scope, top, symbols: symbols.length, watchlistId, ...movers });
}

