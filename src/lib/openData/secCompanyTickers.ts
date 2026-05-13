import { logError } from "@/lib/log";
import { normTicker, prettifyIssuerName } from "@/lib/openData/issuerDisplayName";

const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const UA = "FinanceHub/1.0 (https://github.com/local-first; company-name lookup)";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type SecRow = { cik_str?: number; ticker?: string; title?: string };

let cache: { loadedAt: number; map: Map<string, string> } | null = null;

function tickerVariants(sym: string): string[] {
  const u = normTicker(sym);
  const dash = u.replace(/\./g, "-");
  const dot = u.replace(/-/g, ".");
  return [...new Set([u, dash, dot].filter(Boolean))];
}

async function loadSecTickerMap(): Promise<Map<string, string>> {
  const resp = await fetch(SEC_TICKERS_URL, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!resp.ok) throw new Error(`SEC company_tickers: HTTP ${resp.status}`);
  const json = (await resp.json()) as Record<string, SecRow> | SecRow[];
  const map = new Map<string, string>();

  const ingest = (ticker: string | undefined, title: string | undefined) => {
    if (!ticker || !title) return;
    map.set(normTicker(ticker), title.trim());
  };

  if (Array.isArray(json)) {
    for (const row of json) ingest(row?.ticker, row?.title);
  } else {
    for (const k of Object.keys(json)) {
      const row = json[k];
      if (row && typeof row === "object") ingest(row.ticker, row.title);
    }
  }

  return map;
}

/**
 * Cached SEC registrant ticker → company title (official filing names, often ALL CAPS).
 * Returns null if download fails (rate limit, offline, etc.).
 */
export async function getSecCompanyTickerMap(): Promise<Map<string, string> | null> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.map;
  try {
    const map = await loadSecTickerMap();
    cache = { loadedAt: Date.now(), map };
    return map;
  } catch (e) {
    logError("sec_company_tickers_fetch", e);
    return null;
  }
}

export function lookupSecCompanyTitle(map: Map<string, string> | null, symbol: string): string | null {
  if (!map) return null;
  for (const key of tickerVariants(symbol)) {
    const raw = map.get(key);
    if (raw) return prettifyIssuerName(raw);
  }
  return null;
}
