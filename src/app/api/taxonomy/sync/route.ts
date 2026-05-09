import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { syncTaxonomyFromSchwab } from "@/lib/taxonomy";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { symbols?: unknown } | null;
    const symbolsRaw = Array.isArray(body?.symbols) ? body?.symbols : [];
    const symbols = symbolsRaw.filter((s): s is string => typeof s === "string").map((s) => s.trim());

    const db = getDb();
    if (symbols.length === 0) return NextResponse.json({ ok: true, requested: 0, missing: 0, upserted: 0 });
    const known = db
      .prepare(
        `
      SELECT symbol FROM security_taxonomy
      WHERE symbol IN (${symbols.map(() => "?").join(",")})
    `,
      )
      .all(...symbols) as Array<{ symbol: string }>;
    const knownSet = new Set(known.map((r) => r.symbol));
    const missing = symbols.filter((s) => s && !knownSet.has(s.toUpperCase()));

    const res = await syncTaxonomyFromSchwab(missing);
    return NextResponse.json({ ok: true, requested: symbols.length, missing: missing.length, upserted: res.upserted });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

