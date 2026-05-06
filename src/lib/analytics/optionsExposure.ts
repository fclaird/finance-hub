import { getDb } from "@/lib/db";

export type ExposureRow = {
  underlyingSymbol: string;
  spotMarketValue: number;
  syntheticMarketValue: number;
  syntheticShares: number;
};

export type BucketExposure = {
  bucketKey: "brokerage" | "retirement";
  exposure: ExposureRow[];
};

const DEFAULT_CONTRACT_MULTIPLIER = 100;

export function getUnderlyingExposureRollup(): ExposureRow[] {
  const db = getDb();

  const latestSnapshot = db
    .prepare(
      `
      SELECT hs.id as snapshot_id
      FROM holding_snapshots hs
      ORDER BY hs.as_of DESC
      LIMIT 1
    `,
    )
    .get() as { snapshot_id: string } | undefined;

  if (!latestSnapshot) return [];

  // Spot exposure: sum market_value for non-options by symbol.
  const spot = db
    .prepare(
      `
      SELECT COALESCE(s.symbol, 'UNKNOWN') AS symbol, SUM(COALESCE(p.market_value, 0)) AS mv
      FROM positions p
      JOIN securities s ON s.id = p.security_id
      WHERE p.snapshot_id = ?
        AND s.security_type != 'option'
      GROUP BY COALESCE(s.symbol, 'UNKNOWN')
    `,
    )
    .all(latestSnapshot.snapshot_id) as Array<{ symbol: string; mv: number }>;

  // Synthetic exposure from options: sum qty * 100 * delta * underlying_price (fallback to 0 if unknown).
  // We approximate underlying_price using the spot position's implied price (mv/qty) when possible.
  const synthetic = db
    .prepare(
      `
      SELECT
        COALESCE(us.symbol, s.symbol, 'UNKNOWN') AS underlying_symbol,
        SUM(p.quantity * ? * COALESCE(og.delta, 0)) AS synthetic_shares
      FROM positions p
      JOIN securities s ON s.id = p.security_id
      LEFT JOIN securities us ON us.id = s.underlying_security_id
      LEFT JOIN option_greeks og ON og.position_id = p.id
      WHERE p.snapshot_id = ?
        AND s.security_type = 'option'
      GROUP BY COALESCE(us.symbol, s.symbol, 'UNKNOWN')
    `,
    )
    .all(DEFAULT_CONTRACT_MULTIPLIER, latestSnapshot.snapshot_id) as Array<{
    underlying_symbol: string;
    synthetic_shares: number;
  }>;

  const spotBySym = new Map<string, { mv: number; impliedPrice: number | null }>();
  for (const r of spot) {
    // Try to infer underlying price from any non-option position in that symbol.
    const qtyRow = db
      .prepare(
        `
        SELECT SUM(quantity) AS qty, SUM(COALESCE(market_value, 0)) AS mv
        FROM positions p
        JOIN securities s ON s.id = p.security_id
        WHERE p.snapshot_id = ?
          AND s.symbol = ?
          AND s.security_type != 'option'
      `,
      )
      .get(latestSnapshot.snapshot_id, r.symbol) as { qty: number | null; mv: number | null } | undefined;

    const qty = qtyRow?.qty ?? 0;
    const mv = qtyRow?.mv ?? r.mv ?? 0;
    const impliedPrice = qty !== 0 ? mv / qty : null;
    spotBySym.set(r.symbol, { mv, impliedPrice: impliedPrice && Number.isFinite(impliedPrice) ? impliedPrice : null });
  }

  const out: ExposureRow[] = [];
  const syms = new Set<string>([...spotBySym.keys(), ...synthetic.map((s) => s.underlying_symbol)]);
  for (const sym of syms) {
    const spotInfo = spotBySym.get(sym);
    const syntheticInfo = synthetic.find((s) => s.underlying_symbol === sym);
    const syntheticShares = syntheticInfo?.synthetic_shares ?? 0;
    const price = spotInfo?.impliedPrice ?? 0;
    out.push({
      underlyingSymbol: sym,
      spotMarketValue: spotInfo?.mv ?? 0,
      syntheticMarketValue: syntheticShares * price,
      syntheticShares,
    });
  }

  out.sort((a, b) => Math.abs(b.spotMarketValue + b.syntheticMarketValue) - Math.abs(a.spotMarketValue + a.syntheticMarketValue));
  return out;
}

function accountBucket(accountType: string): "brokerage" | "retirement" {
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

export function getUnderlyingExposureByBucket(): BucketExposure[] {
  const db = getDb();

  const snapshots = db
    .prepare(
      `
      SELECT a.type AS account_type, hs.id AS snapshot_id
      FROM accounts a
      JOIN holding_snapshots hs ON hs.account_id = a.id
      WHERE hs.as_of = (
        SELECT MAX(hs2.as_of) FROM holding_snapshots hs2 WHERE hs2.account_id = a.id
      )
    `,
    )
    .all() as Array<{ account_type: string; snapshot_id: string }>;

  const byBucket = new Map<"brokerage" | "retirement", Map<string, ExposureRow>>();

  for (const s of snapshots) {
    const bucket = accountBucket(s.account_type);
    if (!byBucket.has(bucket)) byBucket.set(bucket, new Map());
    const map = byBucket.get(bucket)!;

    // spot mv by symbol for this snapshot
    const spot = db
      .prepare(
        `
        SELECT COALESCE(sec.symbol, 'UNKNOWN') AS symbol, SUM(COALESCE(p.market_value, 0)) AS mv
        FROM positions p
        JOIN securities sec ON sec.id = p.security_id
        WHERE p.snapshot_id = ?
          AND sec.security_type != 'option'
        GROUP BY COALESCE(sec.symbol, 'UNKNOWN')
      `,
      )
      .all(s.snapshot_id) as Array<{ symbol: string; mv: number }>;

    // synthetic shares by underlying symbol for this snapshot
    const synthetic = db
      .prepare(
        `
        SELECT
          COALESCE(us.symbol, sec.symbol, 'UNKNOWN') AS underlying_symbol,
          SUM(p.quantity * ? * COALESCE(og.delta, 0)) AS synthetic_shares
        FROM positions p
        JOIN securities sec ON sec.id = p.security_id
        LEFT JOIN securities us ON us.id = sec.underlying_security_id
        LEFT JOIN option_greeks og ON og.position_id = p.id
        WHERE p.snapshot_id = ?
          AND sec.security_type = 'option'
        GROUP BY COALESCE(us.symbol, sec.symbol, 'UNKNOWN')
      `,
      )
      .all(DEFAULT_CONTRACT_MULTIPLIER, s.snapshot_id) as Array<{
      underlying_symbol: string;
      synthetic_shares: number;
    }>;

    // implied price for each symbol in this snapshot
    const implied = new Map<string, number>();
    for (const r of spot) {
      const qtyRow = db
        .prepare(
          `
          SELECT SUM(quantity) AS qty, SUM(COALESCE(market_value, 0)) AS mv
          FROM positions p
          JOIN securities sec ON sec.id = p.security_id
          WHERE p.snapshot_id = ?
            AND sec.symbol = ?
            AND sec.security_type != 'option'
        `,
        )
        .get(s.snapshot_id, r.symbol) as { qty: number | null; mv: number | null } | undefined;
      const qty = qtyRow?.qty ?? 0;
      const mv = qtyRow?.mv ?? r.mv ?? 0;
      if (qty) implied.set(r.symbol, mv / qty);
    }

    // merge into bucket map
    for (const r of spot) {
      const prev = map.get(r.symbol) ?? {
        underlyingSymbol: r.symbol,
        spotMarketValue: 0,
        syntheticMarketValue: 0,
        syntheticShares: 0,
      };
      prev.spotMarketValue += r.mv;
      map.set(r.symbol, prev);
    }

    for (const syn of synthetic) {
      const sym = syn.underlying_symbol;
      const prev = map.get(sym) ?? {
        underlyingSymbol: sym,
        spotMarketValue: 0,
        syntheticMarketValue: 0,
        syntheticShares: 0,
      };
      prev.syntheticShares += syn.synthetic_shares;
      const px = implied.get(sym) ?? 0;
      prev.syntheticMarketValue += syn.synthetic_shares * px;
      map.set(sym, prev);
    }
  }

  const out: BucketExposure[] = [];
  for (const [bucketKey, m] of byBucket.entries()) {
    const exposure = Array.from(m.values()).sort(
      (a, b) => Math.abs(b.spotMarketValue + b.syntheticMarketValue) - Math.abs(a.spotMarketValue + a.syntheticMarketValue),
    );
    out.push({ bucketKey, exposure });
  }

  out.sort((a, b) => (a.bucketKey === "retirement" ? -1 : 1) - (b.bucketKey === "retirement" ? -1 : 1));
  return out;
}

