import { NextResponse } from "next/server";

import { getConsolidatedAllocation } from "@/lib/analytics/allocation";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeSynthetic = url.searchParams.get("synthetic") !== "0";
  const data = getConsolidatedAllocation(includeSynthetic);
  return NextResponse.json({ ok: true, includeSynthetic, ...data });
}

