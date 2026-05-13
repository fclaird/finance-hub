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

export type DividendModelQuote = {
  symbol: string;
  last: number | null;
  mark: number | null;
  close: number | null;
};

export async function fetchSchwabQuotesNormalized(symbols: string[]): Promise<Map<string, DividendModelQuote>> {
  const uniq = Array.from(new Set(symbols.map((s) => normalizeSchwabQuoteSymbol(s)).filter(Boolean)));
  const out = new Map<string, DividendModelQuote>();
  const BATCH = 100;
  for (let i = 0; i < uniq.length; i += BATCH) {
    const batch = uniq.slice(i, i + BATCH);
    const resp = await schwabMarketFetch<Record<string, unknown>>(`/quotes?symbols=${encodeURIComponent(batch.join(","))}`);
    for (const sym of batch) {
      const entry = resp[sym] ?? resp[sym.toUpperCase()];
      const q = extractQuoteObject(entry);
      if (!q) {
        out.set(sym, { symbol: sym, last: null, mark: null, close: null });
        continue;
      }
      const last = asNumber(q.lastPrice) ?? null;
      const mark = asNumber(q.mark) ?? null;
      const close = asNumber(q.closePrice) ?? null;
      out.set(sym, { symbol: sym, last, mark, close });
    }
  }
  return out;
}
