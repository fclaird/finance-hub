import { getDb } from "@/lib/db";
import type { DataMode } from "@/lib/dataMode";
import { bucketFromAccount } from "@/lib/accountBuckets";
import { notPosterityWhereSql } from "@/lib/posterity";

export type ExposureRow = {
  underlyingSymbol: string;
  spotMarketValue: number;
  heldShares: number;
  syntheticMarketValue: number;
  syntheticShares: number;
};

export type BucketExposure = {
  bucketKey: "brokerage" | "retirement";
  exposure: ExposureRow[];
};

const DEFAULT_CONTRACT_MULTIPLIER = 100;

export function getUnderlyingExposureRollup(mode: DataMode = "auto"): ExposureRow[] {
  // Reuse the bucketed exposure implementation and merge buckets back into a combined rollup.
  const bySym = new Map<string, ExposureRow>();
  for (const b of getUnderlyingExposureByBucket(mode)) {
    for (const r of b.exposure) {
      const prev = bySym.get(r.underlyingSymbol) ?? {
        underlyingSymbol: r.underlyingSymbol,
        spotMarketValue: 0,
        heldShares: 0,
        syntheticMarketValue: 0,
        syntheticShares: 0,
      };
      prev.spotMarketValue += r.spotMarketValue;
      prev.heldShares += r.heldShares;
      prev.syntheticMarketValue += r.syntheticMarketValue;
      prev.syntheticShares += r.syntheticShares;
      bySym.set(r.underlyingSymbol, prev);
    }
  }

  const out = Array.from(bySym.values());
  out.sort(
    (a, b) => Math.abs(b.spotMarketValue + b.syntheticMarketValue) - Math.abs(a.spotMarketValue + a.syntheticMarketValue),
  );
  return out;
}

export function getUnderlyingExposureByBucket(mode: DataMode = "auto"): BucketExposure[] {
  const db = getDb();
  const where =
    mode === "schwab"
      ? `a.id LIKE 'schwab_%' AND ${notPosterityWhereSql("a")}`
      : "1=1";

  const snapshots = db
    .prepare(
      `
      SELECT a.name AS account_name, a.nickname AS account_nickname, hs.id AS snapshot_id
      FROM accounts a
      JOIN holding_snapshots hs ON hs.account_id = a.id
      WHERE ${where}
        AND hs.as_of = (
        SELECT MAX(hs2.as_of) FROM holding_snapshots hs2 WHERE hs2.account_id = a.id
      )
    `,
    )
    .all() as Array<{ account_name: string; account_nickname: string | null; snapshot_id: string }>;

  const byBucket = new Map<"brokerage" | "retirement", Map<string, ExposureRow>>();

  for (const s of snapshots) {
    const bucket = bucketFromAccount(s.account_name, s.account_nickname);
    if (!byBucket.has(bucket)) byBucket.set(bucket, new Map());
    const map = byBucket.get(bucket)!;

    // spot mv and shares by symbol for this snapshot
    const spot = db
      .prepare(
        `
        SELECT
          COALESCE(sec.symbol, 'UNKNOWN') AS symbol,
          SUM(COALESCE(p.market_value, 0)) AS mv,
          SUM(COALESCE(p.quantity, 0)) AS qty
        FROM positions p
        JOIN securities sec ON sec.id = p.security_id
        WHERE p.snapshot_id = ?
          AND sec.security_type != 'option'
          AND sec.security_type != 'cash'
        GROUP BY COALESCE(sec.symbol, 'UNKNOWN')
      `,
      )
      .all(s.snapshot_id) as Array<{ symbol: string; mv: number; qty: number }>;

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
      if ((r.symbol ?? "").trim().toUpperCase() === "CASH") continue;
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
      if ((r.symbol ?? "").trim().toUpperCase() === "CASH") continue;
      const prev = map.get(r.symbol) ?? {
        underlyingSymbol: r.symbol,
        spotMarketValue: 0,
        heldShares: 0,
        syntheticMarketValue: 0,
        syntheticShares: 0,
      };
      prev.spotMarketValue += r.mv;
      prev.heldShares += r.qty ?? 0;
      map.set(r.symbol, prev);
    }

    for (const syn of synthetic) {
      const sym = syn.underlying_symbol;
      if ((sym ?? "").trim().toUpperCase() === "CASH") continue;
      const prev = map.get(sym) ?? {
        underlyingSymbol: sym,
        spotMarketValue: 0,
        heldShares: 0,
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

