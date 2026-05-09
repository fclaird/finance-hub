import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { DATA_MODE_COOKIE, parseDataMode } from "@/lib/dataMode";
import { getTerminalUniverseSymbols } from "@/lib/terminal/universe";
import { QQQ_SYMBOLS } from "@/lib/terminal/universes/qqq";
import { SP500_SYMBOLS } from "@/lib/terminal/universes/sp500";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const watchlistId = url.searchParams.get("watchlistId");
  const scope = (url.searchParams.get("scope") ?? "portfolio").toLowerCase();
  const jar = await cookies();
  const mode = parseDataMode(jar.get(DATA_MODE_COOKIE)?.value);
  const symbols =
    scope === "spy"
      ? SP500_SYMBOLS
      : scope === "qqq"
        ? QQQ_SYMBOLS
        : getTerminalUniverseSymbols({ mode, includeWatchlistId: watchlistId });
  return NextResponse.json({ ok: true, mode, scope, watchlistId, symbols, n: symbols.length });
}

