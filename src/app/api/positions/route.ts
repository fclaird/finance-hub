import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";

type ParsedOption = {
  expiration: string; // YYYY-MM-DD
  right: "C" | "P";
  strike: number;
};

function parseOptionFromSecurity(symbol: string | null, name: string | null): ParsedOption | null {
  // Prefer Schwab-style symbol: "TSLA   260619C00260000"
  if (symbol) {
    const s = symbol.replace(/\s+/g, " ").trim();
    const m = s.match(/([0-9]{6})([CP])([0-9]{8})$/);
    if (m) {
      const yy = Number(m[1]!.slice(0, 2));
      const mm = Number(m[1]!.slice(2, 4));
      const dd = Number(m[1]!.slice(4, 6));
      const year = 2000 + yy;
      const strike = Number(m[3]!) / 1000;
      return {
        expiration: `${year.toString().padStart(4, "0")}-${mm.toString().padStart(2, "0")}-${dd.toString().padStart(2, "0")}`,
        right: m[2]! as "C" | "P",
        strike,
      };
    }
  }

  // Fallback to name: "TSLA 2026-06-19 C 260"
  if (name) {
    const n = name.trim();
    const m2 = n.match(/([0-9]{4}-[0-9]{2}-[0-9]{2})\s+([CP])\s+([0-9]+(\.[0-9]+)?)/);
    if (m2) {
      return { expiration: m2[1]!, right: m2[2]! as "C" | "P", strike: Number(m2[3]!) };
    }
  }

  return null;
}

function daysToExpiration(expirationIso: string, asOfIso: string): number | null {
  const exp = new Date(`${expirationIso}T00:00:00Z`).getTime();
  const asOf = new Date(asOfIso).getTime();
  if (!Number.isFinite(exp) || !Number.isFinite(asOf)) return null;
  return Math.max(0, Math.ceil((exp - asOf) / (24 * 3600 * 1000)));
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const snapshotId = url.searchParams.get("snapshotId");

  const db = getDb();
  const latest = db
    .prepare(
      `
      SELECT hs.id AS id
      FROM holding_snapshots hs
      ORDER BY hs.as_of DESC
      LIMIT 1
    `,
    )
    .get() as { id: string } | undefined;

  const snap = snapshotId ?? latest?.id;
  if (!snap) return NextResponse.json({ ok: true, snapshotId: null, positions: [] });

  const rows = db
    .prepare(
      `
      SELECT
        p.id AS positionId,
        hs.as_of AS asOf,
        a.id AS accountId,
        a.name AS accountName,
        a.type AS accountType,
        s.symbol AS symbol,
        s.name AS securityName,
        s.security_type AS securityType,
        us.symbol AS underlyingSymbol,
        p.quantity AS quantity,
        p.price AS price,
        p.market_value AS marketValue,
        og.delta AS delta,
        og.gamma AS gamma,
        og.theta AS theta
      FROM positions p
      JOIN holding_snapshots hs ON hs.id = p.snapshot_id
      JOIN accounts a ON a.id = hs.account_id
      JOIN securities s ON s.id = p.security_id
      LEFT JOIN securities us ON us.id = s.underlying_security_id
      LEFT JOIN option_greeks og ON og.position_id = p.id
      WHERE p.snapshot_id = ?
      ORDER BY a.name ASC, s.security_type DESC, s.symbol ASC
    `,
    )
    .all(snap) as Array<{
    positionId: string;
    asOf: string;
    accountId: string;
    accountName: string;
    accountType: string;
    symbol: string | null;
    securityName: string | null;
    securityType: string;
    underlyingSymbol: string | null;
    quantity: number;
    price: number | null;
    marketValue: number | null;
    delta: number | null;
    gamma: number | null;
    theta: number | null;
  }>;

  // Underlying prices (implied from spot positions in same snapshot): px = mv / qty
  const underRows = db
    .prepare(
      `
      SELECT s.symbol AS symbol, SUM(p.quantity) AS qty, SUM(COALESCE(p.market_value, 0)) AS mv
      FROM positions p
      JOIN securities s ON s.id = p.security_id
      WHERE p.snapshot_id = ?
        AND s.security_type != 'option'
        AND s.symbol IS NOT NULL
      GROUP BY s.symbol
    `,
    )
    .all(snap) as Array<{ symbol: string; qty: number; mv: number }>;

  const underPx = new Map<string, number>();
  for (const u of underRows) {
    if (u.qty) underPx.set(u.symbol, u.mv / u.qty);
  }

  const out = rows.map((r) => {
    if (r.securityType !== "option") {
      return {
        ...r,
        optionExpiration: null,
        optionRight: null,
        optionStrike: null,
        dte: null,
        intrinsic: null,
        extrinsic: null,
      };
    }

    const parsed = parseOptionFromSecurity(r.symbol, r.securityName);
    const dte = parsed ? daysToExpiration(parsed.expiration, r.asOf) : null;
    const S = r.underlyingSymbol ? underPx.get(r.underlyingSymbol) : undefined;
    const K = parsed?.strike;
    const right = parsed?.right;
    const qtyAbs = Math.abs(r.quantity ?? 0);
    const premium = (r.price ?? 0) * 100 * qtyAbs;

    let intrinsic = null as number | null;
    if (S != null && K != null && right) {
      const perShare =
        right === "C" ? Math.max(0, S - K) : Math.max(0, K - S);
      intrinsic = perShare * 100 * qtyAbs;
    }
    const extrinsic = intrinsic == null ? null : premium - intrinsic;

    return {
      ...r,
      optionExpiration: parsed?.expiration ?? null,
      optionRight: parsed?.right ?? null,
      optionStrike: parsed?.strike ?? null,
      dte,
      intrinsic,
      extrinsic,
    };
  });

  return NextResponse.json({ ok: true, snapshotId: snap, positions: out });
}

