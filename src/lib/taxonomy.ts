import { getDb } from "@/lib/db";
import { schwabMarketFetch } from "@/lib/schwab/client";

export type MarketCapBucket = "mega" | "large" | "mid" | "small" | "micro" | "unknown";
export type RevenueGeoBucket = "US" | "Intl" | "Mixed" | "unknown";

export type TaxonomyCategory = "sector" | "marketCap" | "revenueGeo";

export type SecurityTaxonomy = {
  symbol: string;
  sector: string | null;
  industry: string | null;
  marketCapBucket: MarketCapBucket | null;
  revenueGeoBucket: RevenueGeoBucket | null;
  source: string | null;
  updatedAt: string;
};

function normSym(sym: string) {
  return (sym ?? "").trim().toUpperCase();
}

function asBucket(v: unknown, buckets: readonly string[]) {
  const s = typeof v === "string" ? v.trim() : "";
  return (buckets as readonly string[]).includes(s) ? s : null;
}

export function getTaxonomy(symbol: string): SecurityTaxonomy | null {
  const sym = normSym(symbol);
  if (!sym) return null;
  const db = getDb();
  const row = db
    .prepare(
      `
      SELECT symbol, sector, industry, market_cap_bucket, revenue_geo_bucket, source, updated_at
      FROM security_taxonomy
      WHERE symbol = ?
      LIMIT 1
    `,
    )
    .get(sym) as
    | {
        symbol: string;
        sector: string | null;
        industry: string | null;
        market_cap_bucket: string | null;
        revenue_geo_bucket: string | null;
        source: string | null;
        updated_at: string;
      }
    | undefined;

  if (!row) return null;
  return {
    symbol: row.symbol,
    sector: row.sector,
    industry: row.industry,
    marketCapBucket: (asBucket(row.market_cap_bucket, ["mega", "large", "mid", "small", "micro", "unknown"]) as MarketCapBucket | null) ?? null,
    revenueGeoBucket: (asBucket(row.revenue_geo_bucket, ["US", "Intl", "Mixed", "unknown"]) as RevenueGeoBucket | null) ?? null,
    source: row.source,
    updatedAt: row.updated_at,
  };
}

export function taxonomyBucket(symbol: string, category: TaxonomyCategory): string {
  const t = getTaxonomy(symbol);
  if (!t) return "Unknown";
  if (category === "sector") return t.sector ?? "Unknown";
  if (category === "marketCap") return t.marketCapBucket ?? "unknown";
  return t.revenueGeoBucket ?? "unknown";
}

/**
 * Best-effort provider sync. If Schwab fundamentals/instruments aren't available,
 * this returns 0 upserts and leaves taxonomy as Unknown.
 */
export async function syncTaxonomyFromSchwab(symbols: string[]): Promise<{ upserted: number }> {
  const uniq = Array.from(new Set(symbols.map(normSym).filter(Boolean)));
  if (uniq.length === 0) return { upserted: 0 };

  // Attempt Schwab market-data style fundamentals (TD-style endpoint). If the tenant doesn't support it,
  // swallow and return 0.
  let resp: unknown;
  try {
    const url = `/instruments?symbol=${encodeURIComponent(uniq.join(","))}&projection=fundamental`;
    resp = await schwabMarketFetch<unknown>(url);
  } catch {
    return { upserted: 0 };
  }

  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO security_taxonomy (symbol, sector, industry, market_cap_bucket, revenue_geo_bucket, source, updated_at)
    VALUES (@symbol, @sector, @industry, @market_cap_bucket, @revenue_geo_bucket, 'schwab', datetime('now'))
    ON CONFLICT(symbol) DO UPDATE SET
      sector = excluded.sector,
      industry = excluded.industry,
      market_cap_bucket = excluded.market_cap_bucket,
      revenue_geo_bucket = excluded.revenue_geo_bucket,
      source = excluded.source,
      updated_at = excluded.updated_at
  `);

  let upserted = 0;
  const asObj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" ? (v as Record<string, unknown>) : null);
  const root = asObj(resp);
  if (!root) return { upserted: 0 };

  for (const sym of uniq) {
    const entry = root[sym] ?? root[sym.toUpperCase()];
    const eObj = asObj(entry);
    if (!eObj) continue;
    const fundamental = asObj(eObj.fundamental) ?? asObj(eObj.fundamentals) ?? eObj;
    const sector = typeof fundamental?.sector === "string" ? fundamental.sector : null;
    const industry = typeof fundamental?.industry === "string" ? fundamental.industry : null;
    if (!sector && !industry) continue;

    upsert.run({
      symbol: sym,
      sector,
      industry,
      market_cap_bucket: null,
      revenue_geo_bucket: null,
    });
    upserted++;
  }

  return { upserted };
}

