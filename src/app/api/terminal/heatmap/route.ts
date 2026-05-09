import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { schwabMarketFetch } from "@/lib/schwab/client";
import { DATA_MODE_COOKIE, parseDataMode } from "@/lib/dataMode";
import { getDb } from "@/lib/db";
import { BASKETS } from "@/lib/terminal/baskets";
import { getTerminalUniverseSymbols } from "@/lib/terminal/universe";
import { SP500_SYMBOLS } from "@/lib/terminal/universes/sp500";
import { syncTaxonomyFromSchwab } from "@/lib/taxonomy";

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
  const view = (url.searchParams.get("view") ?? "portfolio").trim() as "spy" | "qqq" | "portfolio";
  const watchlistId = url.searchParams.get("watchlistId");

  const jar = await cookies();
  const mode = parseDataMode(jar.get(DATA_MODE_COOKIE)?.value);

  let symbols: string[] = [];
  if (view === "spy") symbols = SP500_SYMBOLS.map(normSym).filter(Boolean);
  else if (view === "qqq") symbols = (BASKETS.big50 ?? []).map(normSym).filter(Boolean); // proxy for now
  else symbols = getTerminalUniverseSymbols({ mode, includeWatchlistId: watchlistId });

  // If we can, warm up some market-cap cache for these names (best-effort, non-blocking correctness).
  // Cap request size to keep response times reasonable; remaining names will just have null marketCap.
  const warm = symbols.slice(0, 200);
  await syncTaxonomyFromSchwab(warm).catch(() => null);

  const db = getDb();
  const caps = db
    .prepare(
      `
      SELECT symbol, market_cap
      FROM security_taxonomy
      WHERE symbol IN (${symbols.map(() => "?").join(",")})
    `,
    )
    .all(...symbols) as Array<{ symbol: string; market_cap: number | null }>;
  const capMap = new Map<string, number | null>();
  for (const r of caps) capMap.set(normSym(r.symbol), r.market_cap);

  const BATCH = 100;
  const items: Array<{ symbol: string; changePercent: number | null; marketCap: number | null }> = [];

  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    const resp = await schwabMarketFetch<Record<string, unknown>>(`/quotes?symbols=${encodeURIComponent(batch.join(","))}`);
    for (const sym of batch) {
      const entry = resp[sym] ?? resp[sym.toUpperCase()];
      const q = extractQuoteObject(entry);
      if (!q) {
        items.push({ symbol: sym, changePercent: null, marketCap: capMap.get(sym) ?? null });
        continue;
      }
      const last = asNumber(q.lastPrice) ?? null;
      const close = asNumber(q.closePrice) ?? null;
      const change = asNumber(q.netChange ?? q.change) ?? (last != null && close != null ? last - close : null);
      const changePercent =
        asNumber(q.netPercentChangeInDouble ?? q.changePercent) ??
        (change != null && close != null && close !== 0 ? change / close : null);

      items.push({
        symbol: sym,
        changePercent: changePercent == null ? null : changePercent,
        marketCap: capMap.get(sym) ?? null,
      });
    }
  }

  return NextResponse.json({ ok: true, view, watchlistId, n: items.length, items });
}

