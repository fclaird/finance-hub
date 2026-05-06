import { getDb } from "@/lib/db";

export type PortfolioValuePoint = {
  asOf: string;
  totalMarketValue: number;
};

export function getPortfolioValueSeries(): PortfolioValuePoint[] {
  const db = getDb();

  // Each sync creates per-account snapshots; roll those into a single timestamped portfolio value.
  const rows = db
    .prepare(
      `
      SELECT hs.as_of AS as_of, SUM(COALESCE(p.market_value, 0)) AS mv
      FROM holding_snapshots hs
      JOIN positions p ON p.snapshot_id = hs.id
      GROUP BY hs.as_of
      ORDER BY hs.as_of ASC
    `,
    )
    .all() as Array<{ as_of: string; mv: number }>;

  return rows.map((r) => ({ asOf: r.as_of, totalMarketValue: r.mv }));
}

type BucketKey = "combined" | "retirement" | "brokerage";

function accountBucket(accountType: string): "retirement" | "brokerage" {
  const t = (accountType ?? "").toLowerCase();
  if (
    t.includes("ira") ||
    t.includes("roth") ||
    t.includes("401") ||
    t.includes("403") ||
    t.includes("457") ||
    t.includes("pension") ||
    t.includes("retire")
  ) {
    return "retirement";
  }
  return "brokerage";
}

export function getPortfolioValueSeriesByBucket(bucket: BucketKey): PortfolioValuePoint[] {
  const db = getDb();
  if (bucket === "combined") return getPortfolioValueSeries();

  // That query groups by as_of and type; we need to aggregate into bucket per timestamp.
  const map = new Map<string, number>();
  const snaps = db
    .prepare(
      `
      SELECT hs.as_of as as_of, a.type as account_type, SUM(COALESCE(p.market_value, 0)) AS mv
      FROM holding_snapshots hs
      JOIN accounts a ON a.id = hs.account_id
      JOIN positions p ON p.snapshot_id = hs.id
      GROUP BY hs.as_of, a.id
      ORDER BY hs.as_of ASC
    `,
    )
    .all() as Array<{ as_of: string; account_type: string; mv: number }>;

  for (const r of snaps) {
    const b = accountBucket(r.account_type);
    if (b !== bucket) continue;
    map.set(r.as_of, (map.get(r.as_of) ?? 0) + r.mv);
  }

  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([asOf, totalMarketValue]) => ({ asOf, totalMarketValue }));
}

