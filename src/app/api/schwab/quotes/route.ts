import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { latestSnapshotId } from "@/lib/snapshots";
import { schwabMarketFetch } from "@/lib/schwab/client";
import { schwabQuoteObjectFromEntry } from "@/lib/schwab/quoteEntry";
import { schwabQuoteDisplayPrice } from "@/lib/market/schwabQuoteDisplay";

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function pickPrice(quote: Record<string, unknown>): number | null {
  const rawLast = asNumber(quote.lastPrice) ?? null;
  const mark = asNumber(quote.mark) ?? null;
  const close = asNumber(quote.closePrice) ?? null;
  const display = schwabQuoteDisplayPrice(rawLast, mark, close);
  if (display != null && display > 0) return display;
  return (
    asNumber(quote.bid) ??
    asNumber(quote.ask) ??
    (close != null && close > 0 ? close : null) ??
    null
  );
}

export async function POST() {
  const db = getDb();
  const snap = latestSnapshotId(db, "schwab") ?? latestSnapshotId(db);
  if (!snap) return NextResponse.json({ ok: false, error: "No snapshots yet." }, { status: 400 });

  const symbols = db
    .prepare(
      `
      SELECT DISTINCT s.symbol AS symbol
      FROM positions p
      JOIN securities s ON s.id = p.security_id
      WHERE p.snapshot_id = ?
        AND s.symbol IS NOT NULL
        AND s.security_type != 'option'
    `,
    )
    .all(snap) as Array<{ symbol: string }>;

  const uniq = Array.from(new Set(symbols.map((r) => (r.symbol ?? "").trim()).filter(Boolean)));
  if (uniq.length === 0) return NextResponse.json({ ok: true, updated: 0, symbols: 0 });

  const today = new Date().toISOString().slice(0, 10);
  const upsert = db.prepare(`
    INSERT INTO price_points (provider, symbol, date, close)
    VALUES ('schwab', @symbol, @date, @close)
    ON CONFLICT(provider, symbol, date) DO UPDATE SET close = excluded.close, created_at = datetime('now')
  `);

  const BATCH = 100;
  let updated = 0;

  for (let i = 0; i < uniq.length; i += BATCH) {
    const batch = uniq.slice(i, i + BATCH);
    const resp = await schwabMarketFetch<Record<string, unknown>>(
      `/quotes?symbols=${encodeURIComponent(batch.join(","))}`,
    );

    for (const sym of batch) {
      const entry = (resp as Record<string, unknown>)[sym] ?? (resp as Record<string, unknown>)[sym.toUpperCase()];
      const quote = schwabQuoteObjectFromEntry(entry);
      if (!quote) continue;
      const px = pickPrice(quote);
      if (px == null || px <= 0) continue;
      upsert.run({ symbol: sym.toUpperCase(), date: today, close: px });
      updated++;
    }
  }

  return NextResponse.json({ ok: true, updated, symbols: uniq.length, date: today });
}

