import { NextResponse } from "next/server";

import { getAllocationByBucket } from "@/lib/analytics/allocation";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeSynthetic = url.searchParams.get("synthetic") !== "0";
  return NextResponse.json({ ok: true, ...getAllocationByBucket(includeSynthetic) });
}

