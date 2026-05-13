import type Database from "better-sqlite3";

import { getDb } from "@/lib/db";
import { logError } from "@/lib/log";
import { ensureBenchmarkHistory } from "@/lib/market/benchmarks";
import { ensureCandles } from "@/lib/terminal/ohlcv";
import { newId } from "@/lib/id";

import { sumDividendCashflowsByPayDateRange } from "./cashflows";
import { monthEndForDate, monthEndsBetweenInclusive, fridayOfUtcWeekContaining, compareIso, parseIsoDate } from "./dates";
import { closeOnOrBeforeTs, benchmarkCloseOnOrBefore } from "./prices";
import { fetchMergedDividendFundamentals } from "./mergedFundamentals";
import { fetchSchwabQuotesNormalized } from "./quotes";
import { parsePortfolioMeta } from "./portfolioMeta";

function monthStartIso(monthEndIso: string): string {
  const y = monthEndIso.slice(0, 7);
  return `${y}-01`;
}

function syntheticMonthlyDividendPerShare(annualDivEst: number | null): number {
  if (annualDivEst == null || !Number.isFinite(annualDivEst) || annualDivEst <= 0) return 0;
  return annualDivEst / 12;
}

async function captureFundamentals(db: Database.Database, symbols: string[]): Promise<Map<string, { divYield: number | null; annualDivEst: number | null }>> {
  const map = new Map<string, { divYield: number | null; annualDivEst: number | null }>();
  const now = new Date().toISOString();
  const ins = db.prepare(
    `
    INSERT INTO dividend_model_symbol_fundamentals_snap (id, symbol, captured_at, div_yield, annual_div_est, next_ex_date, raw_json, source)
    VALUES (@id, @symbol, @captured_at, @div_yield, @annual_div_est, @next_ex_date, @raw_json, @source)
  `,
  );

  for (const sym of symbols) {
    try {
      const m = await fetchMergedDividendFundamentals(sym);
      map.set(sym, { divYield: m.divYield, annualDivEst: m.annualDivEst });
      ins.run({
        id: newId("dmfs"),
        symbol: sym,
        captured_at: now,
        div_yield: m.divYield,
        annual_div_est: m.annualDivEst,
        next_ex_date: m.nextExDate,
        raw_json: JSON.stringify(m.raw ?? {}),
        source: m.source,
      });
    } catch (e) {
      logError(`dividend_model_fundamental_${sym}`, e);
      map.set(sym, { divYield: null, annualDivEst: null });
    }
  }
  return map;
}

function latestFundamentalsBySymbol(
  db: Database.Database,
  symbols: string[],
): Map<string, { divYield: number | null; annualDivEst: number | null }> {
  const map = new Map<string, { divYield: number | null; annualDivEst: number | null }>();
  for (const sym of symbols) {
    const row = db
      .prepare(
        `
        SELECT div_yield AS divYield, annual_div_est AS annualDivEst
        FROM dividend_model_symbol_fundamentals_snap
        WHERE symbol = ?
        ORDER BY captured_at DESC
        LIMIT 1
      `,
      )
      .get(sym) as { divYield: number | null; annualDivEst: number | null } | undefined;
    if (row) map.set(sym, { divYield: row.divYield, annualDivEst: row.annualDivEst });
  }
  return map;
}

export type RefreshDividendModelPortfolioResult = {
  ok: true;
  symbols: number;
  monthlyRows: number;
  forwardPartialUpserted: boolean;
  message?: string;
};

export async function refreshDividendModelPortfolio(portfolioId: string, db: Database.Database = getDb()): Promise<RefreshDividendModelPortfolioResult> {
  const metaRow = db
    .prepare(`SELECT meta_json FROM dividend_model_portfolios WHERE id = ?`)
    .get(portfolioId) as { meta_json: string | null } | undefined;
  const sliceAccountId = parsePortfolioMeta(metaRow?.meta_json).sliceAccountId?.trim() || undefined;

  const holdings = db
    .prepare(
      `SELECT id, symbol, shares FROM dividend_model_holdings WHERE portfolio_id = ? ORDER BY sort_order ASC, symbol ASC`,
    )
    .all(portfolioId) as Array<{ id: string; symbol: string; shares: number | null }>;

  const symbols = holdings.map((h) => h.symbol.toUpperCase());
  if (symbols.length === 0) {
    return { ok: true, symbols: 0, monthlyRows: 0, forwardPartialUpserted: false, message: "No holdings" };
  }

  for (const sym of symbols) {
    await ensureCandles(sym, "1d", "5Y");
  }

  await captureFundamentals(db, symbols);
  const fundMap = latestFundamentalsBySymbol(db, symbols);

  const now = new Date();
  const endMonth = monthEndForDate(now);
  const startAnchor = new Date(Date.UTC(now.getUTCFullYear() - 5, now.getUTCMonth(), 1));
  const startMonth = monthEndForDate(startAnchor);
  const months = monthEndsBetweenInclusive(startMonth, endMonth);

  const delMonthly = db.prepare(`DELETE FROM dividend_model_portfolio_monthly WHERE portfolio_id = ?`);
  const delMonthlySym = db.prepare(`DELETE FROM dividend_model_portfolio_monthly_symbol WHERE portfolio_id = ?`);
  delMonthly.run(portfolioId);
  delMonthlySym.run(portfolioId);

  const insM = db.prepare(
    `
    INSERT INTO dividend_model_portfolio_monthly
      (portfolio_id, month_end, total_market_value, total_dividends, status, computed_at, is_backfilled)
    VALUES (@portfolio_id, @month_end, @total_market_value, @total_dividends, @status, @computed_at, @is_backfilled)
  `,
  );
  const insMs = db.prepare(
    `
    INSERT INTO dividend_model_portfolio_monthly_symbol
      (portfolio_id, symbol, month_end, month_dividends, market_value_eom, close_eom, shares_used)
    VALUES (@portfolio_id, @symbol, @month_end, @month_dividends, @market_value_eom, @close_eom, @shares_used)
  `,
  );

  const computedAt = now.toISOString();
  let monthlyRows = 0;

  const insertModeledMonth = db.transaction((me: string): boolean => {
    const monthStart = monthStartIso(me);
    const endMs = new Date(`${me}T23:59:59.999Z`).getTime();
    const isCurrentMonth = me === endMonth;

    let totalMv = 0;
    let totalDiv = 0;
    let pricedCount = 0;

    for (const h of holdings) {
      const sh = h.shares as number;
      const close = closeOnOrBeforeTs(db, h.symbol, endMs);
      if (close == null) continue;
      pricedCount += 1;
      const mv = close * sh;
      totalMv += mv;

      const cashDiv = sumDividendCashflowsByPayDateRange(db, h.symbol, monthStart, me, sliceAccountId);
      const f = fundMap.get(h.symbol);
      const syn = syntheticMonthlyDividendPerShare(f?.annualDivEst ?? null) * sh;
      const monthDiv = cashDiv > 0 ? cashDiv : syn;
      totalDiv += monthDiv;

      insMs.run({
        portfolio_id: portfolioId,
        symbol: h.symbol,
        month_end: me,
        month_dividends: monthDiv,
        market_value_eom: mv,
        close_eom: close,
        shares_used: sh,
      });
    }

    if (totalMv <= 0) return false;

    const allSymbolsPriced = pricedCount === holdings.length;
    const status = isCurrentMonth || !allSymbolsPriced ? "partial" : "final";
    const isBackfilled = isCurrentMonth ? 0 : 1;
    insM.run({
      portfolio_id: portfolioId,
      month_end: me,
      total_market_value: totalMv,
      total_dividends: totalDiv,
      status,
      computed_at: computedAt,
      is_backfilled: isBackfilled,
    });
    return true;
  });

  const anyMissingShares = holdings.some((h) => h.shares == null || !Number.isFinite(h.shares));
  if (!anyMissingShares) {
    for (const me of months) {
      if (insertModeledMonth(me)) monthlyRows += 1;
    }
  }

  const portfolio = db
    .prepare(`SELECT live_started_at FROM dividend_model_portfolios WHERE id = ?`)
    .get(portfolioId) as { live_started_at: string | null } | undefined;

  let forwardPartialUpserted = false;
  if (portfolio?.live_started_at) {
    forwardPartialUpserted = await upsertForwardPartialWeek(db, portfolioId, holdings, fundMap, computedAt, sliceAccountId);
  }

  return { ok: true, symbols: symbols.length, monthlyRows, forwardPartialUpserted };
}

async function upsertForwardPartialWeek(
  db: Database.Database,
  portfolioId: string,
  holdings: Array<{ id: string; symbol: string; shares: number | null }>,
  fundMap: Map<string, { divYield: number | null; annualDivEst: number | null }>,
  computedAt: string,
  sliceAccountId?: string,
): Promise<boolean> {
  const liveStart = db
    .prepare(`SELECT live_started_at FROM dividend_model_portfolios WHERE id = ?`)
    .get(portfolioId) as { live_started_at: string | null } | undefined;
  if (!liveStart?.live_started_at) return false;

  await ensureBenchmarkHistory("SPY");
  await ensureBenchmarkHistory("QQQ");

  const now = new Date();
  const thisFriday = fridayOfUtcWeekContaining(now);

  // Finalize prior weeks' partial rows (other Fridays strictly before thisFriday).
  const rows = db
    .prepare(
      `SELECT as_of, status FROM dividend_model_portfolio_forward_snap WHERE portfolio_id = ? AND status = 'partial'`,
    )
    .all(portfolioId) as Array<{ as_of: string; status: string }>;

  const updFinal = db.prepare(
    `UPDATE dividend_model_portfolio_forward_snap SET status = 'final', computed_at = ? WHERE portfolio_id = ? AND as_of = ?`,
  );
  for (const r of rows) {
    if (compareIso(r.as_of, thisFriday) < 0) {
      updFinal.run(computedAt, portfolioId, r.as_of);
    }
  }

  const quotes = await fetchSchwabQuotesNormalized(holdings.map((h) => h.symbol));
  let nav = 0;
  for (const h of holdings) {
    if (h.shares == null || !Number.isFinite(h.shares)) continue;
    const q = quotes.get(h.symbol.toUpperCase());
    const px = q?.mark ?? q?.last ?? q?.close;
    if (px == null || !Number.isFinite(px)) continue;
    nav += px * h.shares;
  }

  const lastFinal = db
    .prepare(
      `
      SELECT as_of FROM dividend_model_portfolio_forward_snap
      WHERE portfolio_id = ? AND status = 'final'
      ORDER BY as_of DESC
      LIMIT 1
    `,
    )
    .get(portfolioId) as { as_of: string } | undefined;

  const liveStartDay = liveStart.live_started_at.slice(0, 10);
  let divRangeStart = liveStartDay;
  if (lastFinal?.as_of) {
    const d = parseIsoDate(lastFinal.as_of);
    d.setUTCDate(d.getUTCDate() + 1);
    divRangeStart = d.toISOString().slice(0, 10);
  }

  let divPeriod = 0;
  for (const h of holdings) {
    if (h.shares == null || !Number.isFinite(h.shares)) continue;
    const cash = sumDividendCashflowsByPayDateRange(db, h.symbol, divRangeStart, thisFriday, sliceAccountId);
    if (cash > 0) divPeriod += cash;
    else {
      const f = fundMap.get(h.symbol);
      const weeks = 1;
      const annual = f?.annualDivEst;
      if (annual != null && Number.isFinite(annual)) {
        divPeriod += (annual * h.shares * weeks) / 52;
      }
    }
  }

  if (compareIso(thisFriday, liveStartDay) < 0) {
    return false;
  }

  const spy0 = benchmarkCloseOnOrBefore("SPY", liveStartDay) ?? benchmarkCloseOnOrBefore("SPY", thisFriday);
  const qqq0 = benchmarkCloseOnOrBefore("QQQ", liveStartDay) ?? benchmarkCloseOnOrBefore("QQQ", thisFriday);

  const spyT = benchmarkCloseOnOrBefore("SPY", thisFriday);
  const qqqT = benchmarkCloseOnOrBefore("QQQ", thisFriday);

  const spyPct =
    spy0 != null && spyT != null && spy0 !== 0 ? ((spyT / spy0) - 1) * 100 : null;
  const qqqPct =
    qqq0 != null && qqqT != null && qqq0 !== 0 ? ((qqqT / qqq0) - 1) * 100 : null;

  const upsert = db.prepare(
    `
    INSERT INTO dividend_model_portfolio_forward_snap
      (portfolio_id, as_of, nav_total, dividends_period, status, computed_at, spy_rebased_pct, qqq_rebased_pct)
    VALUES (@portfolio_id, @as_of, @nav_total, @dividends_period, @status, @computed_at, @spy_rebased_pct, @qqq_rebased_pct)
    ON CONFLICT(portfolio_id, as_of) DO UPDATE SET
      nav_total = excluded.nav_total,
      dividends_period = excluded.dividends_period,
      status = excluded.status,
      computed_at = excluded.computed_at,
      spy_rebased_pct = excluded.spy_rebased_pct,
      qqq_rebased_pct = excluded.qqq_rebased_pct
  `,
  );

  upsert.run({
    portfolio_id: portfolioId,
    as_of: thisFriday,
    nav_total: nav,
    dividends_period: divPeriod,
    status: "partial",
    computed_at: computedAt,
    spy_rebased_pct: spyPct,
    qqq_rebased_pct: qqqPct,
  });

  return true;
}

/** Finalize modeled months and forward weeks (cron-safe). */
export function finalizeDividendModelRollups(db: Database.Database = getDb()): { monthlyFinalized: number; forwardFinalized: number } {
  const now = new Date();
  const firstThisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;

  const r1 = db
    .prepare(
      `
      UPDATE dividend_model_portfolio_monthly
      SET status = 'final', is_backfilled = 1
      WHERE month_end < ? AND status = 'partial'
    `,
    )
    .run(firstThisMonth);

  const thisFriday = fridayOfUtcWeekContaining(now);
  const r2 = db
    .prepare(
      `
      UPDATE dividend_model_portfolio_forward_snap
      SET status = 'final'
      WHERE status = 'partial' AND as_of < ?
    `,
    )
    .run(thisFriday);

  return { monthlyFinalized: r1.changes, forwardFinalized: r2.changes };
}
