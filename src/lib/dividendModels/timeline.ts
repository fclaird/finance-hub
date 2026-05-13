import type Database from "better-sqlite3";

import { ensureBenchmarkHistory } from "@/lib/market/benchmarks";

import { monthEndForDate } from "./dates";
import { benchmarkCloseOnOrBefore } from "./prices";

export type ModeledTimelinePoint = {
  month_end: string;
  portfolio_rebased_pct: number | null;
  total_market_value: number | null;
  total_dividends: number;
  spy_rebased_pct: number | null;
  qqq_rebased_pct: number | null;
  status: string;
};

export async function buildModeledMonthlyTimeline(
  db: Database.Database,
  portfolioId: string,
  years: 3 | 5,
  includeSpy: boolean,
  includeQqq: boolean,
): Promise<ModeledTimelinePoint[]> {
  const now = new Date();
  const cutoff = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()));
  const cutoffMonthEnd = monthEndForDate(cutoff);

  const rows = db
    .prepare(
      `
      SELECT month_end, total_market_value, total_dividends, status
      FROM dividend_model_portfolio_monthly
      WHERE portfolio_id = ? AND month_end >= ?
      ORDER BY month_end ASC
    `,
    )
    .all(portfolioId, cutoffMonthEnd) as Array<{
    month_end: string;
    total_market_value: number | null;
    total_dividends: number;
    status: string;
  }>;

  if (rows.length === 0) return [];

  if (includeSpy) await ensureBenchmarkHistory("SPY");
  if (includeQqq) await ensureBenchmarkHistory("QQQ");

  const firstMv = rows.find((r) => r.total_market_value != null && r.total_market_value > 0)?.total_market_value ?? null;
  const firstMe = rows.find((r) => r.total_market_value != null && r.total_market_value > 0)?.month_end;

  let spyBase: number | null = null;
  let qqqBase: number | null = null;
  if (firstMe) {
    if (includeSpy) spyBase = benchmarkCloseOnOrBefore("SPY", firstMe);
    if (includeQqq) qqqBase = benchmarkCloseOnOrBefore("QQQ", firstMe);
  }

  return rows.map((r) => {
    const mv = r.total_market_value;
    const portfolioRebased =
      firstMv != null && mv != null && firstMv > 0 ? ((mv / firstMv) - 1) * 100 : null;

    let spyPct: number | null = null;
    let qqqPct: number | null = null;
    if (includeSpy && spyBase != null && spyBase !== 0) {
      const c = benchmarkCloseOnOrBefore("SPY", r.month_end);
      spyPct = c != null ? ((c / spyBase) - 1) * 100 : null;
    }
    if (includeQqq && qqqBase != null && qqqBase !== 0) {
      const c = benchmarkCloseOnOrBefore("QQQ", r.month_end);
      qqqPct = c != null ? ((c / qqqBase) - 1) * 100 : null;
    }

    return {
      month_end: r.month_end,
      portfolio_rebased_pct: portfolioRebased,
      total_market_value: mv,
      total_dividends: r.total_dividends ?? 0,
      spy_rebased_pct: spyPct,
      qqq_rebased_pct: qqqPct,
      status: r.status,
    };
  });
}

export type LiveTimelinePoint = {
  as_of: string;
  nav_total: number | null;
  dividends_period: number;
  portfolio_rebased_pct: number | null;
  spy_rebased_pct: number | null;
  qqq_rebased_pct: number | null;
  status: string;
};

export function buildForwardLiveTimeline(
  db: Database.Database,
  portfolioId: string,
  includeSpy: boolean,
  includeQqq: boolean,
  /** ISO date (YYYY-MM-DD); only snapshots on or after live start are returned (Mode B). */
  liveStartedDay: string,
): LiveTimelinePoint[] {
  const start = liveStartedDay.slice(0, 10);
  const rows = db
    .prepare(
      `
      SELECT as_of, nav_total, dividends_period, status, spy_rebased_pct, qqq_rebased_pct
      FROM dividend_model_portfolio_forward_snap
      WHERE portfolio_id = ? AND as_of >= ?
      ORDER BY as_of ASC
    `,
    )
    .all(portfolioId, start) as Array<{
    as_of: string;
    nav_total: number | null;
    dividends_period: number;
    status: string;
    spy_rebased_pct: number | null;
    qqq_rebased_pct: number | null;
  }>;

  if (rows.length === 0) return [];

  const firstNav = rows.find((r) => r.nav_total != null && r.nav_total > 0)?.nav_total ?? null;

  return rows.map((r) => {
    const nav = r.nav_total;
    const portfolioRebased =
      firstNav != null && nav != null && firstNav > 0 ? ((nav / firstNav) - 1) * 100 : null;

    return {
      as_of: r.as_of,
      nav_total: nav,
      dividends_period: r.dividends_period ?? 0,
      portfolio_rebased_pct: portfolioRebased,
      spy_rebased_pct: includeSpy ? r.spy_rebased_pct : null,
      qqq_rebased_pct: includeQqq ? r.qqq_rebased_pct : null,
      status: r.status,
    };
  });
}

export function assertPortfolioExists(db: Database.Database, portfolioId: string): boolean {
  const row = db.prepare(`SELECT 1 AS x FROM dividend_model_portfolios WHERE id = ? LIMIT 1`).get(portfolioId) as { x: number } | undefined;
  return !!row;
}
