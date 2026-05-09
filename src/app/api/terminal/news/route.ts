import { NextResponse } from "next/server";

type NewsItem = { title: string; link: string; pubDate: string; symbols: string[]; category: string };

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

const TTL_MS = 5 * 60_000;
const cache = new Map<string, { expiresAt: number; items: NewsItem[] }>();

function parseRss(xml: string, sym: string, category: string): NewsItem[] {
  const items: NewsItem[] = [];
  const blocks = xml.match(/<item>([\s\S]*?)<\/item>/gi) ?? [];
  for (const b of blocks.slice(0, 12)) {
    const title = (b.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i)?.[1] ?? b.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "")
      .replace(/&amp;/g, "&")
      .trim();
    const link = (b.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ?? "").trim();
    const pubDate = (b.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] ?? "").trim();
    if (!title || !link) continue;
    items.push({ title, link, pubDate, symbols: [sym], category });
  }
  return items;
}

async function fetchSymbolNews(sym: string, category: string): Promise<NewsItem[]> {
  const s = normSym(sym);
  if (!s) return [];
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(s)}&region=US&lang=en-US`;
  const hit = cache.get(url);
  if (hit && hit.expiresAt > Date.now()) return hit.items;

  const resp = await fetch(url, { headers: { "User-Agent": "finance-hub-terminal" } });
  if (!resp.ok) return [];
  const xml = await resp.text();
  const items = parseRss(xml, s, category);
  cache.set(url, { expiresAt: Date.now() + TTL_MS, items });
  return items;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = (url.searchParams.get("mode") ?? "").toLowerCase(); // 'company' to suppress macro/anomaly baskets
  const symbols = (url.searchParams.get("symbols") ?? "")
    .split(",")
    .map(normSym)
    .filter(Boolean);
  const anomalySymbols = (url.searchParams.get("anomalies") ?? "")
    .split(",")
    .map(normSym)
    .filter(Boolean);

  // Macro basket fixed; no FX/futures/commodities.
  const macro = ["SPY", "QQQ", "DIA", "IWM", "XLK", "XLF", "XLE", "XLV", "XLY", "XLP", "XLU", "XLI"];

  const focus = Array.from(new Set(symbols)).slice(0, 8);
  const anoms = Array.from(new Set(anomalySymbols)).slice(0, 8);

  const fetched =
    mode === "company"
      ? await Promise.all([...focus.slice(0, 1).map((s) => fetchSymbolNews(s, "company"))])
      : await Promise.all([
          ...focus.map((s) => fetchSymbolNews(s, "watchlist")),
          ...anoms.map((s) => fetchSymbolNews(s, "highVolume")),
          ...macro.slice(0, 6).map((s) => fetchSymbolNews(s, "macro")),
        ]);

  const all = fetched.flat();
  const dedup = new Map<string, NewsItem>();
  for (const it of all) {
    const key = it.link;
    const prev = dedup.get(key);
    if (!prev) dedup.set(key, it);
    else {
      prev.symbols = Array.from(new Set([...prev.symbols, ...it.symbols]));
    }
  }

  const items = Array.from(dedup.values()).sort((a, b) => (b.pubDate ?? "").localeCompare(a.pubDate ?? ""));
  return NextResponse.json({ ok: true, mode: mode || "default", items });
}

