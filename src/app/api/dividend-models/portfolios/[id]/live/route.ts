import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { refreshDividendModelPortfolio } from "@/lib/dividendModels/refresh";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Start forward weekly logging (Mode B chart). Sets `live_started_at` to today's UTC date.
 * Does not backfill weekly rows before this date. Triggers one refresh so the current partial week row is written.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { id: portfolioId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { action?: string } | null;
  if (body?.action !== "start") {
    return NextResponse.json({ ok: false, error: 'Expected JSON body { "action": "start" }' }, { status: 400 });
  }

  const db = getDb();
  const exists = db.prepare(`SELECT live_started_at FROM dividend_model_portfolios WHERE id = ?`).get(portfolioId) as
    | { live_started_at: string | null }
    | undefined;
  if (!exists) return NextResponse.json({ ok: false, error: "Portfolio not found" }, { status: 404 });
  if (exists.live_started_at) {
    return NextResponse.json({ ok: true, liveStartedAt: exists.live_started_at, already: true });
  }

  const day = new Date().toISOString().slice(0, 10);
  db.prepare(`UPDATE dividend_model_portfolios SET live_started_at = ? WHERE id = ?`).run(day, portfolioId);

  let refreshMessage: string | undefined;
  try {
    const r = await refreshDividendModelPortfolio(portfolioId, db);
    refreshMessage = r.message;
  } catch {
    /* client can run Refresh data */
  }

  return NextResponse.json({ ok: true, liveStartedAt: day, refreshMessage });
}
