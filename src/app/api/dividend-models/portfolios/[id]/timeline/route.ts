import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { assertPortfolioExists, buildModeledMonthlyTimeline } from "@/lib/dividendModels/timeline";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id: portfolioId } = await ctx.params;
  const url = new URL(req.url);
  const yearsRaw = url.searchParams.get("years") ?? "5";
  const years: 3 | 5 = yearsRaw === "3" ? 3 : 5;
  const includeSpy = url.searchParams.get("includeSpy") === "1" || url.searchParams.get("includeSpy") === "true";
  const includeQqq = url.searchParams.get("includeQqq") === "1" || url.searchParams.get("includeQqq") === "true";

  const db = getDb();
  if (!assertPortfolioExists(db, portfolioId)) {
    return NextResponse.json({ ok: false, error: "Portfolio not found" }, { status: 404 });
  }

  const points = await buildModeledMonthlyTimeline(db, portfolioId, years, includeSpy, includeQqq);
  const monthsReturned = points.length;
  const firstMonthEnd = monthsReturned > 0 ? points[0]!.month_end : null;
  const lastMonthEnd = monthsReturned > 0 ? points[points.length - 1]!.month_end : null;

  return NextResponse.json({
    ok: true,
    mode: "modeled_monthly",
    years,
    monthsReturned,
    firstMonthEnd,
    lastMonthEnd,
    points,
    footnote:
      "Dividends use synced cashflows when available; otherwise a straight-line monthly estimate from Schwab fundamentals (annual ÷ 12).",
  });
}
