import { NextResponse } from "next/server";

import { schwabMarketFetch } from "@/lib/schwab/client";

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function getString(o: Record<string, unknown> | null, key: string): string | null {
  if (!o) return null;
  const v = o[key];
  return typeof v === "string" ? v : null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = normSym(url.searchParams.get("symbol") ?? "");
  if (!symbol) return NextResponse.json({ ok: false, error: "Missing symbol" }, { status: 400 });

  let resp: unknown;
  try {
    resp = await schwabMarketFetch<unknown>(`/instruments?symbol=${encodeURIComponent(symbol)}&projection=fundamental`);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }

  const root = asObj(resp);
  const entry = root ? (asObj(root[symbol]) ?? asObj(root[symbol.toUpperCase()])) : null;
  const fundamental =
    (entry
      ? asObj((entry as Record<string, unknown>)["fundamental"]) ??
        asObj((entry as Record<string, unknown>)["fundamentals"]) ??
        entry
      : null) ?? {};

  const companyName =
    getString(entry, "description") ??
    getString(fundamental, "description") ??
    null;

  const sector = getString(fundamental, "sector");
  const industry = getString(fundamental, "industry");

  const marketCap = asNumber(fundamental["marketCap"]);
  const pe = asNumber(fundamental["peRatio"]);
  const divYield = asNumber(fundamental["divYield"]);
  const beta = asNumber(fundamental["beta"]);
  const week52High = asNumber(fundamental["high52"]);
  const week52Low = asNumber(fundamental["low52"]);
  const avgVol = asNumber(fundamental["volAvg"]);

  return NextResponse.json({
    ok: true,
    symbol,
    companyName,
    sector,
    industry,
    marketCap,
    pe,
    divYield,
    beta,
    week52High,
    week52Low,
    avgVol,
    raw: fundamental,
  });
}

