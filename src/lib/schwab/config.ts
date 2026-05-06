export type SchwabConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function getSchwabConfig(): SchwabConfig {
  const clientId = process.env.SCHWAB_CLIENT_ID;
  const clientSecret = process.env.SCHWAB_CLIENT_SECRET;
  const redirectUri = process.env.SCHWAB_REDIRECT_URI;

  if (!clientId) throw new Error("Missing env var: SCHWAB_CLIENT_ID");
  if (!clientSecret) throw new Error("Missing env var: SCHWAB_CLIENT_SECRET");
  if (!redirectUri) throw new Error("Missing env var: SCHWAB_REDIRECT_URI");

  return { clientId, clientSecret, redirectUri };
}

export const SCHWAB_OAUTH_AUTHORIZE_URL = "https://api.schwabapi.com/v1/oauth/authorize";
export const SCHWAB_OAUTH_TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token";
export const SCHWAB_TRADER_API_BASE = "https://api.schwabapi.com/trader/v1";
export const SCHWAB_MARKETDATA_API_BASE = "https://api.schwabapi.com/marketdata/v1";

