import { NextResponse } from "next/server";

import { getPortfolioValueSeries, getPortfolioValueSeriesByBucket } from "@/lib/analytics/performance";

export async function GET() {
  // Default keeps backwards compat
  return NextResponse.json({ ok: true, series: getPortfolioValueSeries() });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { bucket?: "combined" | "retirement" | "brokerage" } | null;
  const bucket = body?.bucket ?? "combined";
  return NextResponse.json({ ok: true, bucket, series: getPortfolioValueSeriesByBucket(bucket) });
}

