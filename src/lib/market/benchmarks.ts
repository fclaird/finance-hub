import { getDb } from "@/lib/db";
import { logError } from "@/lib/log";
import { schwabMarketFetch } from "@/lib/schwab/client";

type SchwabPriceHistoryResp = {
  candles?: Array<{
    datetime: number; // ms epoch
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  symbol?: string;
  empty?: boolean;
};

function isoDateFromMs(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

export async function ensureBenchmarkHistory(symbol: string): Promise<void> {
  const db = getDb();

  // If we already have a reasonable amount cached, skip refresh.
  const cachedCount = db
    .prepare(`SELECT COUNT(1) AS n FROM price_points WHERE provider='schwab' AND symbol = ?`)
    .get(symbol) as { n: number } | undefined;

  if ((cachedCount?.n ?? 0) > 250) return; // ~1 year of dailies

  // Try the largest period Schwab supports (20y daily).
  const params = new URLSearchParams();
  params.set("symbol", symbol);
  params.set("periodType", "year");
  params.set("period", "20");
  params.set("frequencyType", "daily");
  params.set("frequency", "1");

  let data: SchwabPriceHistoryResp;
  try {
    data = await schwabMarketFetch<SchwabPriceHistoryResp>(`/pricehistory?${params.toString()}`);
  } catch (e) {
    logError(`benchmark_fetch_failed_${symbol}`, e);
    throw e;
  }

  const candles = data.candles ?? [];
  if (candles.length === 0) return;

  const upsert = db.prepare(`
    INSERT INTO price_points (provider, symbol, date, close)
    VALUES ('schwab', @symbol, @date, @close)
    ON CONFLICT(provider, symbol, date) DO UPDATE SET close = excluded.close
  `);

  const tx = db.transaction(() => {
    for (const c of candles) {
      upsert.run({ symbol, date: isoDateFromMs(c.datetime), close: c.close });
    }
  });
  tx();
}

export function getCachedBenchmarkSeries(symbol: string): Array<{ date: string; close: number }> {
  const db = getDb();
  return db
    .prepare(
      `
      SELECT date, close
      FROM price_points
      WHERE provider='schwab' AND symbol = ?
      ORDER BY date ASC
    `,
    )
    .all(symbol) as Array<{ date: string; close: number }>;
}

