import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { buildCounterfactualDripSeries } from "@/lib/dividendModels/counterfactualDrip";
import { parsePortfolioMeta } from "@/lib/dividendModels/portfolioMeta";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id: portfolioId } = await ctx.params;
  const url = new URL(req.url);
  const horizonRaw = url.searchParams.get("horizon") ?? url.searchParams.get("years") ?? "5";
  const horizon: 3 | 5 = horizonRaw === "3" ? 3 : 5;
  const drip = url.searchParams.get("drip") === "1" || url.searchParams.get("drip") === "true";

  const db = getDb();
  const exists = db.prepare(`SELECT 1 FROM dividend_model_portfolios WHERE id = ?`).get(portfolioId);
  if (!exists) return NextResponse.json({ ok: false, error: "Portfolio not found" }, { status: 404 });

  const metaRow = db
    .prepare(`SELECT meta_json FROM dividend_model_portfolios WHERE id = ?`)
    .get(portfolioId) as { meta_json: string | null } | undefined;
  const accountId = parsePortfolioMeta(metaRow?.meta_json).sliceAccountId?.trim();
  if (!accountId) {
    return NextResponse.json({ ok: false, error: "Set sliceAccountId on this portfolio to run counterfactuals" }, { status: 400 });
  }

  const syms = db
    .prepare(`SELECT symbol FROM dividend_model_holdings WHERE portfolio_id = ? ORDER BY sort_order ASC, symbol ASC`)
    .all(portfolioId) as Array<{ symbol: string }>;
  const symbols = syms.map((s) => s.symbol.toUpperCase());
  if (symbols.length === 0) {
    return NextResponse.json({ ok: false, error: "No holdings" }, { status: 400 });
  }

  const { anchorMonthEnd, points } = buildCounterfactualDripSeries(db, accountId, symbols, horizon, drip);
  return NextResponse.json({
    ok: true,
    horizonYears: horizon,
    drip,
    anchorMonthEnd,
    points,
  });
}
