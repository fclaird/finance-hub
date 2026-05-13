import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { parsePortfolioMeta } from "@/lib/dividendModels/portfolioMeta";
import { refreshDividendModelPortfolio } from "@/lib/dividendModels/refresh";
import { resolveSchwabSlice } from "@/lib/dividendModels/schwabSlice";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Overwrite `dividend_model_holdings.shares` and `avg_unit_cost` from the latest Schwab snapshot
 * for symbols in this portfolio when `sliceAccountId` is set on the portfolio.
 */
export async function POST(_req: Request, ctx: Ctx) {
  const { id: portfolioId } = await ctx.params;
  const db = getDb();
  const row = db
    .prepare(`SELECT meta_json FROM dividend_model_portfolios WHERE id = ?`)
    .get(portfolioId) as { meta_json: string | null } | undefined;
  if (!row) return NextResponse.json({ ok: false, error: "Portfolio not found" }, { status: 404 });

  const meta = parsePortfolioMeta(row.meta_json);
  const accountId = meta.sliceAccountId?.trim();
  if (!accountId) {
    return NextResponse.json({ ok: false, error: "Set sliceAccountId on this portfolio before syncing from Schwab" }, { status: 400 });
  }

  const syms = db
    .prepare(`SELECT symbol FROM dividend_model_holdings WHERE portfolio_id = ? ORDER BY sort_order ASC, symbol ASC`)
    .all(portfolioId) as Array<{ symbol: string }>;
  const symbols = syms.map((s) => s.symbol.toUpperCase());
  if (symbols.length === 0) {
    return NextResponse.json({ ok: false, error: "No holdings to sync" }, { status: 400 });
  }

  const slice = resolveSchwabSlice(db, accountId, symbols);
  const upd = db.prepare(
    `UPDATE dividend_model_holdings SET shares = @shares, avg_unit_cost = @avg WHERE portfolio_id = @pid AND UPPER(symbol) = @sym`,
  );

  let updated = 0;
  const missing: string[] = [];
  for (const p of slice.positions) {
    if (p.missing || p.quantity == null) {
      missing.push(p.symbol);
      continue;
    }
    const r = upd.run({
      pid: portfolioId,
      sym: p.symbol,
      shares: p.quantity,
      avg: p.avgUnitCost,
    });
    if (r.changes > 0) updated += 1;
  }

  let refresh: Awaited<ReturnType<typeof refreshDividendModelPortfolio>> | null = null;
  try {
    refresh = await refreshDividendModelPortfolio(portfolioId, db);
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        updated,
        missingSymbols: missing,
        snapshotId: slice.snapshotId,
        snapshotAsOf: slice.asOf,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    updated,
    missingSymbols: missing,
    snapshotId: slice.snapshotId,
    snapshotAsOf: slice.asOf,
    refresh,
  });
}
