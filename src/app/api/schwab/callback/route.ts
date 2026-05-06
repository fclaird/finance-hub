import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getSecretsPassphrase } from "@/lib/env";
import { exchangeCodeForToken } from "@/lib/schwab/oauth";
import { setSchwabToken } from "@/lib/schwab/token";

const STATE_COOKIE = "schwab_oauth_state";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.json({ ok: false, error }, { status: 400 });
  }
  if (!code || !state) {
    return NextResponse.json({ ok: false, error: "Missing code/state" }, { status: 400 });
  }

  const jar = await cookies();
  const expectedState = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);
  if (!expectedState || expectedState !== state) {
    return NextResponse.json({ ok: false, error: "Invalid state" }, { status: 400 });
  }

  const token = await exchangeCodeForToken(code);
  setSchwabToken(getSecretsPassphrase(), { ...token, obtained_at: Date.now() });

  // For now, bounce back to home. We'll add a proper Connections page next.
  return NextResponse.redirect(new URL("/", url));
}

