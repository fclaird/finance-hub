import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getDb } from "@/lib/db";
import { DATA_MODE_COOKIE, parseDataMode } from "@/lib/dataMode";

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const underlying = normSym(url.searchParams.get("underlying") ?? "");
  if (!underlying) return NextResponse.json({ ok: false, error: "Missing underlying" }, { status: 400 });

  const jar = await cookies();
  const mode = parseDataMode(jar.get(DATA_MODE_COOKIE)?.value);

  const db = getDb();
  const where = mode === "schwab" ? "a.id LIKE 'schwab_%'" : "a.id NOT LIKE 'demo_%'";

  const snaps = db
    .prepare(
      `
      SELECT hs.id AS snapshot_id
      FROM accounts a
      JOIN holding_snapshots hs ON hs.account_id = a.id
      WHERE ${where}
        AND hs.as_of = (
          SELECT MAX(hs2.as_of) FROM holding_snapshots hs2 WHERE hs2.account_id = a.id
        )
    `,
    )
    .all() as Array<{ snapshot_id: string }>;
  const snapshotIds = snaps.map((r) => r.snapshot_id);
  if (snapshotIds.length === 0) return NextResponse.json({ ok: true, underlying, impliedPrice: null, contributors: [] });

  // Implied price from non-option positions: mv/qty
  const spot = db
    .prepare(
      `
      SELECT SUM(p.quantity) AS qty, SUM(COALESCE(p.market_value, 0)) AS mv
      FROM positions p
      JOIN securities s ON s.id = p.security_id
      WHERE p.snapshot_id IN (SELECT value FROM json_each(@snaps))
        AND s.security_type != 'option'
        AND UPPER(COALESCE(s.symbol, '')) = @sym
    `,
    )
    .get({ snaps: JSON.stringify(snapshotIds), sym: underlying }) as { qty: number | null; mv: number | null } | undefined;

  const qty = spot?.qty ?? 0;
  const mv = spot?.mv ?? 0;
  const impliedPrice = underlying === "CASH" ? 1 : qty ? mv / qty : null;

  const opts = db
    .prepare(
      `
      SELECT
        p.id AS positionId,
        s.symbol AS optionSymbol,
        COALESCE(us.symbol, s.symbol, 'UNKNOWN') AS underlyingSymbol,
        p.quantity AS quantity,
        og.delta AS delta
      FROM positions p
      JOIN securities s ON s.id = p.security_id
      LEFT JOIN securities us ON us.id = s.underlying_security_id
      LEFT JOIN option_greeks og ON og.position_id = p.id
      WHERE p.snapshot_id IN (SELECT value FROM json_each(@snaps))
        AND s.security_type = 'option'
        AND UPPER(COALESCE(us.symbol, s.symbol, '')) = @sym
    `,
    )
    .all({ snaps: JSON.stringify(snapshotIds), sym: underlying }) as Array<{
    positionId: string;
    optionSymbol: string | null;
    underlyingSymbol: string;
    quantity: number;
    delta: number | null;
  }>;

  const contributors = opts
    .map((r) => {
      const d = typeof r.delta === "number" && Number.isFinite(r.delta) ? r.delta : 0;
      const shares = r.quantity * 100 * d;
      return {
        optionSymbol: (r.optionSymbol ?? "").toString(),
        quantity: r.quantity,
        delta: r.delta,
        syntheticShares: shares,
      };
    })
    .filter((c) => c.optionSymbol)
    .sort((a, b) => Math.abs(b.syntheticShares) - Math.abs(a.syntheticShares))
    .slice(0, 12);

  const syntheticShares = contributors.reduce((s, c) => s + c.syntheticShares, 0);
  const syntheticMarketValue = impliedPrice != null ? syntheticShares * impliedPrice : null;

  return NextResponse.json({
    ok: true,
    underlying,
    impliedPrice,
    syntheticShares,
    syntheticMarketValue,
    contributors,
    snapshots: snapshotIds.length,
  });
}

