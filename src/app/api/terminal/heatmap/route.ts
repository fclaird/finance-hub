import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { logError } from "@/lib/log";
import { schwabMarketFetch } from "@/lib/schwab/client";
import { schwabQuoteObjectFromEntry } from "@/lib/schwab/quoteEntry";
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

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const view = (url.searchParams.get("view") ?? "portfolio").trim() as "spy" | "qqq" | "portfolio";
  const watchlistId = url.searchParams.get("watchlistId");

  try {
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
    const caps =
      symbols.length === 0
        ? ([] as Array<{ symbol: string; market_cap: number | null }>)
        : (db
            .prepare(
              `
              SELECT symbol, market_cap
              FROM security_taxonomy
              WHERE symbol IN (${symbols.map(() => "?").join(",")})
              `,
            )
            .all(...symbols) as Array<{ symbol: string; market_cap: number | null }>);
    const capMap = new Map<string, number | null>();
    for (const r of caps) capMap.set(normSym(r.symbol), r.market_cap);

    const BATCH = 100;
    const items: Array<{ symbol: string; changePercent: number | null; marketCap: number | null }> = [];

    for (let i = 0; i < symbols.length; i += BATCH) {
      const batch = symbols.slice(i, i + BATCH);
      const resp = await schwabMarketFetch<Record<string, unknown>>(
        `/quotes?symbols=${encodeURIComponent(batch.join(","))}`,
      );
      for (const sym of batch) {
        const entry = resp[sym] ?? resp[sym.toUpperCase()];
        const q = schwabQuoteObjectFromEntry(entry);
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
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logError("terminal_heatmap_get", e);
    return NextResponse.json(
      { ok: false, error: msg, view, watchlistId, n: 0, items: [] },
      { status: 502 },
    );
  }
}

