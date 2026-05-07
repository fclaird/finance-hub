import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { latestSnapshotId } from "@/lib/snapshots";
import { schwabMarketFetch } from "@/lib/schwab/client";

type QuotePayload = Record<string, unknown>;

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function pickGreek(quote: Record<string, unknown>, key: string): number | null {
  // Try a few variants
  return (
    asNumber(quote[key]) ??
    asNumber(quote[key.toLowerCase()]) ??
    asNumber(quote[key.toUpperCase()]) ??
    null
  );
}

function extractQuoteObject(entry: unknown): Record<string, unknown> | null {
  if (!entry || typeof entry !== "object") return null;
  const obj = entry as Record<string, unknown>;
  const quote = obj.quote;
  if (quote && typeof quote === "object") return quote as Record<string, unknown>;
  return obj;
}

export async function POST() {
  const db = getDb();

  const latest = latestSnapshotId(db, "schwab") ?? latestSnapshotId(db);

  // Match Positions API behavior: latest snapshot per Schwab account.
  const snaps = (db
    .prepare(
      `
      SELECT hs.id AS snapshot_id
      FROM holding_snapshots hs
      JOIN accounts a ON a.id = hs.account_id
      WHERE a.id LIKE 'schwab_%'
        AND hs.as_of = (
          SELECT MAX(hs2.as_of) FROM holding_snapshots hs2 WHERE hs2.account_id = a.id
        )
      ORDER BY a.name ASC
    `,
    )
    .all() as Array<{ snapshot_id: string }>)
    .map((r) => r.snapshot_id);

  const snapshotIds = snaps.length ? snaps : latest ? [latest] : [];

  if (snapshotIds.length === 0) {
    return NextResponse.json({ ok: false, error: "No holdings snapshots yet. Run sync first." }, { status: 400 });
  }

  const optionPositions = db
    .prepare(
      `
      SELECT p.id as position_id, s.symbol as symbol
      FROM positions p
      JOIN securities s ON s.id = p.security_id
      LEFT JOIN option_greeks og ON og.position_id = p.id
      WHERE p.snapshot_id IN (SELECT value FROM json_each(@snapshots_json))
        AND s.security_type = 'option'
    `,
    )
    .all({ snapshots_json: JSON.stringify(snapshotIds) }) as Array<{ position_id: string; symbol: string }>;

  const symbols = Array.from(new Set(optionPositions.map((p) => p.symbol).filter(Boolean)));
  if (symbols.length === 0) {
    return NextResponse.json({ ok: true, updated: 0, message: "No option positions found in latest snapshot." });
  }

  // Schwab quotes endpoint supports multiple symbols. Use a conservative batch size.
  const BATCH = 50;
  const updated: Array<{ symbol: string; delta: number | null }> = [];

  const upsertGreek = db.prepare(`
    INSERT INTO option_greeks (id, position_id, delta, gamma, theta, vega, iv, updated_at)
    VALUES (@id, @position_id, @delta, @gamma, @theta, @vega, @iv, datetime('now'))
    ON CONFLICT(position_id) DO UPDATE SET
      delta = excluded.delta,
      gamma = excluded.gamma,
      theta = excluded.theta,
      vega = excluded.vega,
      iv = excluded.iv,
      updated_at = excluded.updated_at
  `);

  const posBySymbol = new Map<string, string[]>();
  for (const p of optionPositions) {
    if (!posBySymbol.has(p.symbol)) posBySymbol.set(p.symbol, []);
    posBySymbol.get(p.symbol)!.push(p.position_id);
  }

  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    const resp = await schwabMarketFetch<QuotePayload>(`/quotes?symbols=${encodeURIComponent(batch.join(","))}`);

    for (const sym of batch) {
      const entry = (resp as Record<string, unknown>)[sym] ?? (resp as Record<string, unknown>)[sym.toUpperCase()];
      const quote = extractQuoteObject(entry);
      if (!quote) continue;

      const delta = pickGreek(quote, "delta");
      const gamma = pickGreek(quote, "gamma");
      const theta = pickGreek(quote, "theta");
      const vega = pickGreek(quote, "vega");
      const iv = pickGreek(quote, "volatility") ?? pickGreek(quote, "iv");

      const posIds = posBySymbol.get(sym) ?? [];
      for (const positionId of posIds) {
        upsertGreek.run({
          id: newId("greek"),
          position_id: positionId,
          delta,
          gamma,
          theta,
          vega,
          iv,
        });
      }

      updated.push({ symbol: sym, delta });
    }
  }

  return NextResponse.json({ ok: true, updated: updated.length, sample: updated.slice(0, 10) });
}

