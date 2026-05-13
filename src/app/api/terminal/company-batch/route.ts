import { NextResponse } from "next/server";

import { getSecCompanyTickerMap, lookupSecCompanyTitle } from "@/lib/openData/secCompanyTickers";
import { resolveCompanyNamesOpenFigi } from "@/lib/openData/openFigiNames";
import { fetchSchwabInstrumentFundamental } from "@/lib/schwab/instrumentFundamental";

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

const MAX_SYMBOLS = 120;
const CHUNK = 5;

export async function POST(req: Request) {
  let body: { symbols?: unknown };
  try {
    body = (await req.json()) as { symbols?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const raw = Array.isArray(body.symbols) ? body.symbols : [];
  const symbols = [...new Set(raw.map((s) => normSym(String(s ?? ""))).filter(Boolean))].slice(0, MAX_SYMBOLS);

  const names: Record<string, string | null> = {};

  for (let i = 0; i < symbols.length; i += CHUNK) {
    const chunk = symbols.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map(async (sym) => {
        try {
          const r = await fetchSchwabInstrumentFundamental(sym);
          names[sym] = r.companyName?.trim() || null;
        } catch {
          names[sym] = null;
        }
      }),
    );
  }

  const missingAfterSchwab = symbols.filter((s) => !names[s]);
  if (missingAfterSchwab.length > 0) {
    const openFigi = await resolveCompanyNamesOpenFigi(missingAfterSchwab);
    for (const s of missingAfterSchwab) {
      const hit = openFigi[s]?.trim();
      if (hit) names[s] = hit;
    }
  }

  const stillMissing = symbols.filter((s) => !names[s]);
  if (stillMissing.length > 0) {
    const secMap = await getSecCompanyTickerMap();
    for (const s of stillMissing) {
      const t = lookupSecCompanyTitle(secMap, s);
      if (t) names[s] = t;
    }
  }

  return NextResponse.json({ ok: true, names });
}
