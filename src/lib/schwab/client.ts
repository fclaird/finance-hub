import { getSecretsPassphrase } from "@/lib/env";
import { SCHWAB_MARKETDATA_API_BASE, SCHWAB_TRADER_API_BASE } from "@/lib/schwab/config";
import { refreshToken } from "@/lib/schwab/oauth";
import { getSchwabToken, setSchwabToken, type SchwabToken } from "@/lib/schwab/token";

const REFRESH_SKEW_MS = 60_000;

function isExpired(token: SchwabToken) {
  const expiresAt = token.obtained_at + token.expires_in * 1000;
  return Date.now() >= expiresAt - REFRESH_SKEW_MS;
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
  const url = new URL(path, SCHWAB_TRADER_API_BASE);
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
    throw new Error(`Schwab API error: ${resp.status} ${resp.statusText} ${text}`);
  }
  return (await resp.json()) as T;
}

export async function schwabMarketFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getValidToken();
  const url = new URL(path, SCHWAB_MARKETDATA_API_BASE);
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
    throw new Error(`Schwab Market Data API error: ${resp.status} ${resp.statusText} ${text}`);
  }
  return (await resp.json()) as T;
}

