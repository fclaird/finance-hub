import { NextResponse } from "next/server";

import { fetchSchwabInstrumentFundamental } from "@/lib/schwab/instrumentFundamental";

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = normSym(url.searchParams.get("symbol") ?? "");
  if (!symbol) return NextResponse.json({ ok: false, error: "Missing symbol" }, { status: 400 });

  try {
    const r = await fetchSchwabInstrumentFundamental(symbol);
    return NextResponse.json({
      ok: true,
      symbol: r.symbol,
      companyName: r.companyName,
      sector: r.sector,
      industry: r.industry,
      marketCap: r.marketCap,
      pe: r.pe,
      divYield: r.divYield,
      beta: r.beta,
      week52High: r.week52High,
      week52Low: r.week52Low,
      avgVol: r.avgVol,
      raw: r.raw,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

