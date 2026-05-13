import type Database from "better-sqlite3";

import { monthEndForDate, monthEndsBetweenInclusive } from "@/lib/dividendModels/dates";
import { closeOnOrBeforeTs } from "@/lib/dividendModels/prices";
import { resolveSchwabSlice, sumAccountDividendsForSymbolsPayWindow } from "@/lib/dividendModels/schwabSlice";

export type CounterfactualMonthPoint = {
  month_end: string;
  /** Dividends paid into the slice in this calendar month (from cashflows). */
  monthDividend: number;
  /** Portfolio mark: equity at month-end closes plus uninvested cash when drip is off. */
  nav: number | null;
};

function monthStartFromMonthEnd(me: string): string {
  return `${me.slice(0, 7)}-01`;
}

/**
 * Hypothetical path: buy **current** Schwab slice share counts at month-end closes starting at
 * `horizonYears` ago, then apply actual account dividend cashflows for those tickers each month.
 * DRIP reinvests the month's dividends at month-end closes weighted by market value.
 */
export function buildCounterfactualDripSeries(
  db: Database.Database,
  accountId: string,
  symbols: string[],
  horizonYears: 3 | 5,
  drip: boolean,
): { anchorMonthEnd: string; points: CounterfactualMonthPoint[] } {
  const slice = resolveSchwabSlice(db, accountId, symbols);
  const qty: Record<string, number> = {};
  for (const p of slice.positions) {
    if (p.missing || p.quantity == null || !Number.isFinite(p.quantity) || p.quantity <= 0) continue;
    qty[p.symbol] = p.quantity;
  }
  const syms = Object.keys(qty);
  if (syms.length === 0) {
    return { anchorMonthEnd: "", points: [] };
  }

  const now = new Date();
  const anchor = new Date(Date.UTC(now.getUTCFullYear() - horizonYears, now.getUTCMonth(), now.getUTCDate()));
  const anchorMonthEnd = monthEndForDate(anchor);
  const endMonth = monthEndForDate(now);
  const months = monthEndsBetweenInclusive(anchorMonthEnd, endMonth);
  if (months.length === 0) return { anchorMonthEnd, points: [] };

  let cash = 0;
  const points: CounterfactualMonthPoint[] = [];

  for (const me of months) {
    const endMs = new Date(`${me}T23:59:59.999Z`).getTime();
    const px: Record<string, number> = {};
    let mv = 0;
    for (const s of syms) {
      const c = closeOnOrBeforeTs(db, s, endMs);
      if (c != null && Number.isFinite(c) && c > 0) {
        px[s] = c;
        mv += qty[s]! * c;
      }
    }

    const m0 = monthStartFromMonthEnd(me);
    const divMonth = sumAccountDividendsForSymbolsPayWindow(db, accountId, syms, m0, me, false);

    if (drip && divMonth > 0 && mv > 0) {
      for (const s of syms) {
        const p = px[s];
        if (p == null || p <= 0) continue;
        const w = (qty[s]! * p) / mv;
        qty[s]! += (divMonth * w) / p;
      }
    } else if (!drip) {
      cash += divMonth;
    }

    let nav: number | null = null;
    let mv2 = 0;
    for (const s of syms) {
      const p = px[s];
      if (p == null) continue;
      mv2 += qty[s]! * p;
    }
    if (mv2 > 0 || cash > 0) {
      nav = mv2 + (drip ? 0 : cash);
    }

    points.push({ month_end: me, monthDividend: divMonth, nav });
  }

  return { anchorMonthEnd, points };
}
