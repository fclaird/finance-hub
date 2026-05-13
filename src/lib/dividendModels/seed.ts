import type Database from "better-sqlite3";

import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";

import { DEFAULT_DIVIDEND_MODEL_PORTFOLIO_ID, DEFAULT_DIVIDEND_MODEL_SYMBOLS } from "./constants";

export function ensureDefaultDividendModelPortfolio(db: Database.Database = getDb()): void {
  const n = db.prepare(`SELECT COUNT(1) AS c FROM dividend_model_portfolios`).get() as { c: number };
  if ((n?.c ?? 0) > 0) return;

  db.prepare(
    `INSERT INTO dividend_model_portfolios (id, name, live_started_at, meta_json) VALUES (?, ?, NULL, NULL)`,
  ).run(DEFAULT_DIVIDEND_MODEL_PORTFOLIO_ID, "Dividend model (default)");

  const ins = db.prepare(
    `INSERT INTO dividend_model_holdings (id, portfolio_id, symbol, sort_order, shares) VALUES (?, ?, ?, ?, NULL)`,
  );
  const tx = db.transaction(() => {
    DEFAULT_DIVIDEND_MODEL_SYMBOLS.forEach((sym, i) => {
      ins.run(newId("dmh"), DEFAULT_DIVIDEND_MODEL_PORTFOLIO_ID, sym.toUpperCase(), i);
    });
  });
  tx();
}
