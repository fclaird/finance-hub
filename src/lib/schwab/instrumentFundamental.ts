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

export type SchwabCompanyPayload = {
  symbol: string;
  companyName: string | null;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  pe: number | null;
  divYield: number | null;
  beta: number | null;
  week52High: number | null;
  week52Low: number | null;
  avgVol: number | null;
  raw: Record<string, unknown>;
};

export function parseSchwabInstrumentFundamental(resp: unknown, symbol: string): Omit<SchwabCompanyPayload, "symbol"> {
  const symU = normSym(symbol);
  const root = asObj(resp);
  const entry = root ? (asObj(root[symU]) ?? asObj(root[symbol]) ?? asObj(root[symbol.toUpperCase()])) : null;
  const fundamental =
    (entry
      ? asObj((entry as Record<string, unknown>)["fundamental"]) ??
        asObj((entry as Record<string, unknown>)["fundamentals"]) ??
        entry
      : null) ?? {};

  const companyName =
    getString(fundamental, "companyName") ??
    getString(entry, "description") ??
    getString(fundamental, "description") ??
    null;

  return {
    companyName,
    sector: getString(fundamental, "sector"),
    industry: getString(fundamental, "industry"),
    marketCap: asNumber(fundamental["marketCap"]),
    pe: asNumber(fundamental["peRatio"]),
    divYield: (() => {
      const v = asNumber(fundamental["divYield"]);
      if (v == null || !Number.isFinite(v)) return null;
      // Schwab sometimes reports percent points (e.g. 3.2) instead of decimal yield.
      if (v > 1 && v <= 100) return v / 100;
      return v;
    })(),
    beta: asNumber(fundamental["beta"]),
    week52High: asNumber(fundamental["high52"]),
    week52Low: asNumber(fundamental["low52"]),
    avgVol: asNumber(fundamental["volAvg"]),
    raw: fundamental,
  };
}

export async function fetchSchwabInstrumentFundamental(symbol: string): Promise<SchwabCompanyPayload> {
  const sym = normSym(symbol);
  const resp = await schwabMarketFetch<unknown>(
    `/instruments?symbol=${encodeURIComponent(sym)}&projection=fundamental`,
  );
  const parsed = parseSchwabInstrumentFundamental(resp, sym);
  return { symbol: sym, ...parsed };
}
