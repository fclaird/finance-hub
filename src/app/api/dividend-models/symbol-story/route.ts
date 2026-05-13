import { NextResponse } from "next/server";

import { buildSymbolNarrative } from "@/lib/dividendModels/symbolNarrative";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "").trim().toUpperCase();
  if (!symbol) return NextResponse.json({ ok: false, error: "Missing symbol" }, { status: 400 });

  try {
    const narrative = await buildSymbolNarrative(symbol);
    return NextResponse.json({ ok: true, ...narrative });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
