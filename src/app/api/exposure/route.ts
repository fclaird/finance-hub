import { NextResponse } from "next/server";

import { getUnderlyingExposureRollup } from "@/lib/analytics/optionsExposure";

export async function GET() {
  return NextResponse.json({ ok: true, exposure: getUnderlyingExposureRollup() });
}

