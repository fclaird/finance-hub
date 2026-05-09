import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { carryForwardGreeksFromPriorSnapshots, getLatestSchwabSnapshotIds } from "@/lib/schwab/greeksCarryForward";
import { schwabMarketFetch } from "@/lib/schwab/client";

type QuotePayload = Record<string, unknown>;

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function pickGreek(quote: Record<string, unknown>, key: string): number | null {
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

  const snapshotIds = getLatestSchwabSnapshotIds(db);

  if (snapshotIds.length === 0) {
    return NextResponse.json({ ok: false, error: "No holdings snapshots yet. Run sync first." }, { status: 400 });
  }

  const snapshotsJson = JSON.stringify(snapshotIds);
  const carryForwardApplied = carryForwardGreeksFromPriorSnapshots(db, snapshotIds);

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
    .all({ snapshots_json: snapshotsJson }) as Array<{ position_id: string; symbol: string }>;

  const symbols = Array.from(new Set(optionPositions.map((p) => p.symbol).filter(Boolean)));
  if (symbols.length === 0) {
    return NextResponse.json({
      ok: true,
      carryForwardApplied,
      updated: 0,
      message: "No option positions found in latest snapshot.",
    });
  }

  const BATCH = 50;
  const updated: Array<{ symbol: string; delta: number | null }> = [];

  /** Keep prior Greeks when quotes omit them (e.g. market closed); only overwrite when Schwab returns a number. */
  const upsertGreek = db.prepare(`
    INSERT INTO option_greeks (id, position_id, delta, gamma, theta, vega, iv, updated_at)
    VALUES (@id, @position_id, @delta, @gamma, @theta, @vega, @iv, datetime('now'))
    ON CONFLICT(position_id) DO UPDATE SET
      delta = COALESCE(excluded.delta, option_greeks.delta),
      gamma = COALESCE(excluded.gamma, option_greeks.gamma),
      theta = COALESCE(excluded.theta, option_greeks.theta),
      vega = COALESCE(excluded.vega, option_greeks.vega),
      iv = COALESCE(excluded.iv, option_greeks.iv),
      updated_at = CASE
        WHEN excluded.delta IS NOT NULL OR excluded.gamma IS NOT NULL OR excluded.theta IS NOT NULL
          OR excluded.vega IS NOT NULL OR excluded.iv IS NOT NULL
        THEN excluded.updated_at
        ELSE option_greeks.updated_at
      END
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

  return NextResponse.json({
    ok: true,
    carryForwardApplied,
    updated: updated.length,
    sample: updated.slice(0, 10),
  });
}
