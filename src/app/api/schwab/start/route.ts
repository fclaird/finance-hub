import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { buildSchwabAuthorizeUrl, newState } from "@/lib/schwab/oauth";

const STATE_COOKIE = "schwab_oauth_state";

export async function GET() {
  const state = newState();
  const jar = await cookies();
  jar.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 10 * 60,
  });

  return NextResponse.redirect(buildSchwabAuthorizeUrl(state));
}

