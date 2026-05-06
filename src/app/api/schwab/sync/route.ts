import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { logError } from "@/lib/log";
import { schwabFetch } from "@/lib/schwab/client";

type SchwabAccount = {
  securitiesAccount: {
    accountId: string;
    type?: string;
    accountNumber?: string;
    positions?: Array<{
      instrument: {
        assetType?: string;
        symbol?: string;
        description?: string;
        underlyingSymbol?: string;
      };
      longQuantity?: number;
      shortQuantity?: number;
      averagePrice?: number;
      marketValue?: number;
      currentDayCost?: number;
      currentDayProfitLoss?: number;
    }>;
  };
};

export async function POST() {
  try {
    const db = getDb();

    // Fetch accounts with positions included (per Schwab docs: fields=positions).
    const accounts = await schwabFetch<SchwabAccount[]>("/accounts?fields=positions");

    const nowIso = new Date().toISOString();

    const upsertConn = db.prepare(`
    INSERT INTO institution_connections (id, type, display_name, status, last_sync_at, updated_at)
    VALUES (@id, 'schwab', 'Schwab', 'active', @now, @now)
    ON CONFLICT(id) DO UPDATE SET last_sync_at = excluded.last_sync_at, updated_at = excluded.updated_at, status = 'active'
  `);
    const connId = "schwab_default";
    upsertConn.run({ id: connId, now: nowIso });

  const upsertAccount = db.prepare(`
    INSERT INTO accounts (id, connection_id, name, type, currency, updated_at)
    VALUES (@id, @connection_id, @name, @type, 'USD', @now)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, updated_at = excluded.updated_at
  `);

  const insertSecurity = db.prepare(`
    INSERT INTO securities (id, symbol, name, security_type, underlying_security_id, updated_at)
    VALUES (@id, @symbol, @name, @security_type, @underlying_security_id, @now)
    ON CONFLICT(id) DO UPDATE SET symbol = excluded.symbol, name = excluded.name, updated_at = excluded.updated_at
  `);

  const insertSnapshot = db.prepare(`
    INSERT INTO holding_snapshots (id, account_id, as_of)
    VALUES (@id, @account_id, @as_of)
  `);

  const insertPosition = db.prepare(`
    INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value, metadata_json)
    VALUES (@id, @snapshot_id, @security_id, @quantity, @price, @market_value, @metadata_json)
  `);

    const tx = db.transaction(() => {
    for (const a of accounts) {
      const sa = a.securitiesAccount;
      const accountId = `schwab_${sa.accountId}`;
      upsertAccount.run({
        id: accountId,
        connection_id: connId,
        name: sa.accountNumber ? `Schwab ${sa.accountNumber}` : `Schwab ${sa.accountId}`,
        type: sa.type ?? "brokerage",
        now: nowIso,
      });

      const snapshotId = newId("snap");
      insertSnapshot.run({ id: snapshotId, account_id: accountId, as_of: nowIso });

      for (const p of sa.positions ?? []) {
        const symbol = p.instrument.symbol ?? p.instrument.underlyingSymbol ?? "UNKNOWN";
        const securityId = `sec_${symbol}`;
        const assetType = (p.instrument.assetType ?? "OTHER").toUpperCase();
        const securityType =
          assetType === "OPTION" ? "option" : assetType === "EQUITY" ? "equity" : "other";

        let underlyingSecurityId: string | null = null;
        if (securityType === "option" && p.instrument.underlyingSymbol) {
          underlyingSecurityId = `sec_${p.instrument.underlyingSymbol}`;
          insertSecurity.run({
            id: underlyingSecurityId,
            symbol: p.instrument.underlyingSymbol,
            name: p.instrument.underlyingSymbol,
            security_type: "equity",
            underlying_security_id: null,
            now: nowIso,
          });
        }

        insertSecurity.run({
          id: securityId,
          symbol,
          name: p.instrument.description ?? symbol,
          security_type: securityType,
          underlying_security_id: underlyingSecurityId,
          now: nowIso,
        });

        const qty = (p.longQuantity ?? 0) - (p.shortQuantity ?? 0);
        insertPosition.run({
          id: newId("pos"),
          snapshot_id: snapshotId,
          security_id: securityId,
          quantity: qty,
          price: p.averagePrice ?? null,
          market_value: p.marketValue ?? null,
          metadata_json: JSON.stringify(p),
        });
      }
    }
  });

    tx();

    return NextResponse.json({ ok: true, accounts: accounts.length });
  } catch (e) {
    logError("schwab_sync_failed", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

