import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { assertPortfolioExists, buildForwardLiveTimeline } from "@/lib/dividendModels/timeline";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id: portfolioId } = await ctx.params;
  const url = new URL(req.url);
  const includeSpy = url.searchParams.get("includeSpy") === "1" || url.searchParams.get("includeSpy") === "true";
  const includeQqq = url.searchParams.get("includeQqq") === "1" || url.searchParams.get("includeQqq") === "true";

  const db = getDb();
  if (!assertPortfolioExists(db, portfolioId)) {
    return NextResponse.json({ ok: false, error: "Portfolio not found" }, { status: 404 });
  }

  const live = db.prepare(`SELECT live_started_at FROM dividend_model_portfolios WHERE id = ?`).get(portfolioId) as {
    live_started_at: string | null;
  };
  if (!live?.live_started_at) {
    return NextResponse.json({
      ok: true,
      mode: "forward_live",
      liveStartedAt: null,
      points: [],
      message: "Live forward log has not been started for this portfolio.",
    });
  }

  const points = buildForwardLiveTimeline(db, portfolioId, includeSpy, includeQqq, live.live_started_at);
  return NextResponse.json({
    ok: true,
    mode: "forward_live",
    liveStartedAt: live.live_started_at,
    points,
  });
}
