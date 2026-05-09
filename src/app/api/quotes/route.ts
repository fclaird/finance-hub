import { NextResponse } from "next/server";

import { normalizeSchwabQuoteSymbol } from "@/lib/market/schwabSymbol";
import { schwabMarketFetch } from "@/lib/schwab/client";

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
  return normalizeSchwabQuoteSymbol(s);
}

export type NormalizedQuote = {
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

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { symbols?: string[] } | null;
  const symbols = Array.from(new Set((body?.symbols ?? []).map(normSym).filter(Boolean)));
  if (symbols.length === 0) return NextResponse.json({ ok: true, quotes: [], n: 0 });

  // Schwab /quotes supports multi-symbol; keep conservative batching.
  const BATCH = 100;
  const out: NormalizedQuote[] = [];
  const nowIso = new Date().toISOString();

  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    const resp = await schwabMarketFetch<Record<string, unknown>>(`/quotes?symbols=${encodeURIComponent(batch.join(","))}`);

    for (const sym of batch) {
      const entry = resp[sym] ?? resp[sym.toUpperCase()];
      const q = extractQuoteObject(entry);
      if (!q) {
        out.push({
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

      out.push({
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
        changePercent: changePercent == null ? null : changePercent,
        updatedAt: nowIso,
      });
    }
  }

  return NextResponse.json({ ok: true, quotes: out, n: out.length });
}

