import crypto from "node:crypto";

import { SCHWAB_OAUTH_AUTHORIZE_URL, SCHWAB_OAUTH_TOKEN_URL, getSchwabConfig } from "@/lib/schwab/config";
import type { SchwabToken } from "@/lib/schwab/token";

export function buildSchwabAuthorizeUrl(state: string): string {
  const { clientId, redirectUri } = getSchwabConfig();
  const url = new URL(SCHWAB_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

export function newState(): string {
  return crypto.randomBytes(16).toString("hex");
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf-8").toString("base64")}`;
}

export async function exchangeCodeForToken(code: string): Promise<Omit<SchwabToken, "obtained_at">> {
  const { clientId, clientSecret, redirectUri } = getSchwabConfig();
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", redirectUri);

  const resp = await fetch(SCHWAB_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Schwab token exchange failed: ${resp.status} ${resp.statusText} ${text}`);
  }
  return (await resp.json()) as Omit<SchwabToken, "obtained_at">;
}

export async function refreshToken(refresh_token: string): Promise<Omit<SchwabToken, "obtained_at">> {
  const { clientId, clientSecret } = getSchwabConfig();
  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", refresh_token);

  const resp = await fetch(SCHWAB_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Schwab token refresh failed: ${resp.status} ${resp.statusText} ${text}`);
  }
  return (await resp.json()) as Omit<SchwabToken, "obtained_at">;
}

