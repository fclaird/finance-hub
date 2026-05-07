import { getSecretsPassphrase } from "@/lib/env";
import { SCHWAB_MARKETDATA_API_BASE, SCHWAB_TRADER_API_BASE } from "@/lib/schwab/config";
import { refreshToken } from "@/lib/schwab/oauth";
import { getSchwabToken, setSchwabToken, type SchwabToken } from "@/lib/schwab/token";

const REFRESH_SKEW_MS = 60_000;

function isExpired(token: SchwabToken) {
  const expiresAt = token.obtained_at + token.expires_in * 1000;
  return Date.now() >= expiresAt - REFRESH_SKEW_MS;
}

function joinBaseAndPath(base: string, path: string): URL {
  const u = new URL(base);
  const basePath = u.pathname.replace(/\/+$/, "");
  const rel = path.replace(/^\/+/, "");
  const qIdx = rel.indexOf("?");
  const p = qIdx >= 0 ? rel.slice(0, qIdx) : rel;
  const q = qIdx >= 0 ? rel.slice(qIdx) : "";
  u.pathname = `${basePath}/${p}`;
  u.search = q;
  return u;
}

async function getValidToken(): Promise<SchwabToken> {
  const passphrase = getSecretsPassphrase();
  const token = getSchwabToken(passphrase);
  if (!token) throw new Error("Schwab is not connected yet.");

  if (!isExpired(token)) return token;
  const refreshed = await refreshToken(token.refresh_token);
  const next: SchwabToken = { ...refreshed, obtained_at: Date.now() };
  setSchwabToken(passphrase, next);
  return next;
}

export async function schwabFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const token = await getValidToken();
  const url = joinBaseAndPath(SCHWAB_TRADER_API_BASE, path);
  const resp = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token.access_token}`,
      Accept: "application/json",
    },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Schwab API error (${url.toString()}): ${resp.status} ${resp.statusText} ${text}`);
  }
  return (await resp.json()) as T;
}

export async function schwabMarketFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getValidToken();
  const url = joinBaseAndPath(SCHWAB_MARKETDATA_API_BASE, path);
  const resp = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token.access_token}`,
      Accept: "application/json",
    },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Schwab Market Data API error (${url.toString()}): ${resp.status} ${resp.statusText} ${text}`);
  }
  return (await resp.json()) as T;
}

