import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { buildPortfolioDashboard, fetchDividendCashflowsForSymbols } from "@/lib/dividendModels/dashboardMetrics";
import { inferHoldingCategory } from "@/lib/dividendModels/holdingCategory";
import { loadEnrichedHoldings } from "@/lib/dividendModels/enrichedHoldings";
import { parsePortfolioMeta } from "@/lib/dividendModels/portfolioMeta";
import { resolveSchwabSlice, sliceTotals, sumAccountDividendsForSymbolsPayWindow } from "@/lib/dividendModels/schwabSlice";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id: portfolioId } = await ctx.params;
  const db = getDb();
  const exists = db.prepare(`SELECT 1 FROM dividend_model_portfolios WHERE id = ?`).get(portfolioId);
  if (!exists) return NextResponse.json({ ok: false, error: "Portfolio not found" }, { status: 404 });

  const metaRow = db
    .prepare(`SELECT meta_json FROM dividend_model_portfolios WHERE id = ?`)
    .get(portfolioId) as { meta_json: string | null } | undefined;
  const sliceAccountId = parsePortfolioMeta(metaRow?.meta_json).sliceAccountId?.trim() ?? null;

  const rows = await loadEnrichedHoldings(db, portfolioId);
  const symbols = rows.map((r) => r.symbol);
  const dividends = fetchDividendCashflowsForSymbols(db, symbols, sliceAccountId);
  const dashboard = buildPortfolioDashboard(
    rows.map((r) => ({
      symbol: r.symbol,
      shares: r.shares,
      last: r.last,
      marketValue: r.marketValue,
      sector: r.sector,
      industry: r.industry,
      avgUnitCost: r.avgUnitCost,
    })),
    dividends,
    inferHoldingCategory,
  );

  if (sliceAccountId) {
    const slice = resolveSchwabSlice(db, sliceAccountId, symbols);
    const t = sliceTotals(slice.positions);
    const missingSymbols = slice.positions.filter((p) => p.missing).map((p) => p.symbol);
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const ttmStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, now.getUTCDate()));
    const ttmStartIso = ttmStart.toISOString().slice(0, 10);
    const yearEnd = new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), now.getUTCDate()));
    const yearEndIso = yearEnd.toISOString().slice(0, 10);
    const trailingTwelveMonthsDividends = sumAccountDividendsForSymbolsPayWindow(
      db,
      sliceAccountId,
      symbols,
      ttmStartIso,
      today,
      false,
    );
    const forwardProjected = sumAccountDividendsForSymbolsPayWindow(
      db,
      sliceAccountId,
      symbols,
      today,
      yearEndIso,
      true,
    );
    const forwardActual = sumAccountDividendsForSymbolsPayWindow(
      db,
      sliceAccountId,
      symbols,
      today,
      yearEndIso,
      false,
    );
    const forwardYearProjectedDividends = forwardProjected > 0 ? forwardProjected : Math.max(0, forwardActual);

    dashboard.slice = {
      accountId: sliceAccountId,
      snapshotId: slice.snapshotId,
      snapshotAsOf: slice.asOf,
      schwabMarketValue: t.totalMarketValue,
      schwabCostBasis: t.totalCostBasis,
      unrealizedPl: t.totalMarketValue - t.totalCostBasis,
      matchedPositions: t.matchedSymbols,
      missingSymbols,
      trailingTwelveMonthsDividends,
      forwardYearProjectedDividends,
    };
  } else {
    dashboard.slice = null;
  }

  return NextResponse.json({ ok: true, dashboard });
}
