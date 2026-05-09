import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { isPosterityAccountId, POSTERITY_ACCOUNT_IDS } from "@/lib/posterity";

type ExposureRow = {
  underlyingSymbol: string;
  spotMarketValue: number;
  heldShares: number;
  syntheticMarketValue: number;
  syntheticShares: number;
};

const DEFAULT_CONTRACT_MULTIPLIER = 100;

function normId(s: string) {
  return (s ?? "").trim();
}

export async function GET(req: Request) {
  try {
  const url = new URL(req.url);
  const accountId = normId(url.searchParams.get("accountId") ?? "");
  if (!accountId) return NextResponse.json({ ok: false, error: "Missing accountId" }, { status: 400 });
  if (!isPosterityAccountId(accountId)) {
    return NextResponse.json(
      { ok: false, error: `Invalid posterity accountId. Expected one of: ${POSTERITY_ACCOUNT_IDS.join(", ")}` },
      { status: 400 },
    );
  }

  const db = getDb();
  const snap = db
    .prepare(
      `
      SELECT hs.id AS snapshot_id
      FROM holding_snapshots hs
      WHERE hs.account_id = ?
        AND hs.as_of = (SELECT MAX(hs2.as_of) FROM holding_snapshots hs2 WHERE hs2.account_id = hs.account_id)
      LIMIT 1
    `,
    )
    .get(accountId) as { snapshot_id: string } | undefined;

  const snapshotId = snap?.snapshot_id ?? null;
  if (!snapshotId) return NextResponse.json({ ok: true, accountId, snapshotId: null, exposure: [] satisfies ExposureRow[] });

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
    .all(snapshotId) as Array<{ symbol: string; mv: number; qty: number }>;

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
    .all(DEFAULT_CONTRACT_MULTIPLIER, snapshotId) as Array<{ underlying_symbol: string; synthetic_shares: number }>;

  const implied = new Map<string, number>();
  for (const r of spot) {
    const sym = (r.symbol ?? "").trim().toUpperCase();
    if (!sym || sym === "CASH") continue;
    if (r.qty) implied.set(sym, (r.mv ?? 0) / r.qty);
  }

  const bySym = new Map<string, ExposureRow>();
  for (const r of spot) {
    const sym = (r.symbol ?? "").trim().toUpperCase();
    if (!sym || sym === "CASH") continue;
    bySym.set(sym, {
      underlyingSymbol: sym,
      spotMarketValue: r.mv ?? 0,
      heldShares: r.qty ?? 0,
      syntheticMarketValue: 0,
      syntheticShares: 0,
    });
  }

  for (const s of synthetic) {
    const sym = (s.underlying_symbol ?? "").trim().toUpperCase();
    if (!sym || sym === "CASH") continue;
    const prev =
      bySym.get(sym) ??
      ({
        underlyingSymbol: sym,
        spotMarketValue: 0,
        heldShares: 0,
        syntheticMarketValue: 0,
        syntheticShares: 0,
      } satisfies ExposureRow);
    prev.syntheticShares += s.synthetic_shares ?? 0;
    const px = implied.get(sym) ?? 0;
    prev.syntheticMarketValue += (s.synthetic_shares ?? 0) * px;
    bySym.set(sym, prev);
  }

  const exposure = Array.from(bySym.values()).sort(
    (a, b) => Math.abs(b.spotMarketValue + b.syntheticMarketValue) - Math.abs(a.spotMarketValue + a.syntheticMarketValue),
  );

  return NextResponse.json({ ok: true, accountId, snapshotId, exposure });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

