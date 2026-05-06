import { loadSecrets, saveSecrets } from "@/lib/secrets";

export type SchwabToken = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  obtained_at: number; // epoch ms
};

type TokenBag = {
  schwab?: SchwabToken;
};

export function getSchwabToken(passphrase: string): SchwabToken | null {
  const secrets = loadSecrets(passphrase);
  const tokens = (secrets.tokens ?? {}) as TokenBag;
  return tokens.schwab ?? null;
}

export function setSchwabToken(passphrase: string, token: SchwabToken) {
  const secrets = loadSecrets(passphrase);
  const tokens = (secrets.tokens ?? {}) as TokenBag;
  tokens.schwab = token;
  saveSecrets(passphrase, { ...secrets, tokens });
}

