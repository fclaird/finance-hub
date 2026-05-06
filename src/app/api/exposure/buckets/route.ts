import { NextResponse } from "next/server";

import { getUnderlyingExposureByBucket } from "@/lib/analytics/optionsExposure";

export async function GET() {
  return NextResponse.json({ ok: true, buckets: getUnderlyingExposureByBucket() });
}

