import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";

export async function POST() {
  const db = getDb();

  const now = new Date();
  const snapshots = [
    new Date(now.getTime() - 14 * 24 * 3600 * 1000),
    new Date(now.getTime() - 7 * 24 * 3600 * 1000),
    now,
  ];

  const connId = "demo_connection";
  const upsertConn = db.prepare(`
    INSERT INTO institution_connections (id, type, display_name, status, last_sync_at, updated_at)
    VALUES (@id, 'file', 'Demo Data', 'active', @now, @now)
    ON CONFLICT(id) DO UPDATE SET last_sync_at = excluded.last_sync_at, updated_at = excluded.updated_at, status = 'active'
  `);

  const upsertAccount = db.prepare(`
    INSERT INTO accounts (id, connection_id, name, type, currency, updated_at)
    VALUES (@id, @connection_id, @name, @type, 'USD', @now)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, updated_at = excluded.updated_at
  `);

  const upsertSecurity = db.prepare(`
    INSERT INTO securities (id, symbol, name, security_type, underlying_security_id, updated_at)
    VALUES (@id, @symbol, @name, @security_type, @underlying_security_id, @now)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, security_type = excluded.security_type, underlying_security_id = excluded.underlying_security_id, updated_at = excluded.updated_at
  `);

  const insertSnapshot = db.prepare(`
    INSERT INTO holding_snapshots (id, account_id, as_of)
    VALUES (@id, @account_id, @as_of)
  `);

  const insertPosition = db.prepare(`
    INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value, metadata_json)
    VALUES (@id, @snapshot_id, @security_id, @quantity, @price, @market_value, @metadata_json)
  `);

  const upsertGreek = db.prepare(`
    INSERT INTO option_greeks (id, position_id, delta, gamma, theta, vega, iv, updated_at)
    VALUES (@id, @position_id, @delta, NULL, NULL, NULL, NULL, datetime('now'))
    ON CONFLICT(position_id) DO UPDATE SET
      delta = excluded.delta,
      updated_at = excluded.updated_at
  `);

  const tx = db.transaction(() => {
    // clear prior demo data (optional)
    db.prepare("DELETE FROM option_greeks WHERE position_id IN (SELECT id FROM positions WHERE metadata_json LIKE '%\"demo\":true%')").run();
    db.prepare("DELETE FROM positions WHERE metadata_json LIKE '%\"demo\":true%'").run();
    db.prepare("DELETE FROM holding_snapshots WHERE account_id LIKE 'demo_%'").run();
    db.prepare("DELETE FROM accounts WHERE id LIKE 'demo_%'").run();
    db.prepare("DELETE FROM institution_connections WHERE id = ?").run(connId);

    upsertConn.run({ id: connId, now: now.toISOString() });

    const brokerageId = "demo_brokerage";
    const iraId = "demo_ira";

    upsertAccount.run({
      id: brokerageId,
      connection_id: connId,
      name: "Demo Brokerage",
      type: "brokerage",
      now: now.toISOString(),
    });
    upsertAccount.run({
      id: iraId,
      connection_id: connId,
      name: "Demo IRA",
      type: "ira",
      now: now.toISOString(),
    });

    const secAapl = "sec_AAPL";
    const secSpy = "sec_SPY";
    const secQqq = "sec_QQQ";
    const secBnd = "sec_BND";
    const secCash = "sec_CASH";
    const secAaplCall = "sec_AAPL_2026-06-19_C_220";
    const secAaplPut = "sec_AAPL_2026-06-19_P_190";
    const secTsla = "sec_TSLA";
    const secPltr = "sec_PLTR";
    const secRklb = "sec_RKLB";
    const secNbis = "sec_NBIS";
    const secTslaCall = "sec_TSLA_2026-06-19_C_260";
    const secPltrCall = "sec_PLTR_2026-06-19_C_35";
    const secRklbCall = "sec_RKLB_2026-06-19_C_8";
    const secNbisCall = "sec_NBIS_2026-06-19_C_18";

    upsertSecurity.run({ id: secAapl, symbol: "AAPL", name: "Apple Inc.", security_type: "equity", underlying_security_id: null, now: now.toISOString() });
    upsertSecurity.run({ id: secSpy, symbol: "SPY", name: "SPDR S&P 500 ETF Trust", security_type: "fund", underlying_security_id: null, now: now.toISOString() });
    upsertSecurity.run({ id: secQqq, symbol: "QQQ", name: "Invesco QQQ Trust", security_type: "fund", underlying_security_id: null, now: now.toISOString() });
    upsertSecurity.run({ id: secBnd, symbol: "BND", name: "Vanguard Total Bond Market ETF", security_type: "fund", underlying_security_id: null, now: now.toISOString() });
    upsertSecurity.run({ id: secCash, symbol: "CASH", name: "Cash", security_type: "cash", underlying_security_id: null, now: now.toISOString() });
    upsertSecurity.run({ id: secTsla, symbol: "TSLA", name: "Tesla, Inc.", security_type: "equity", underlying_security_id: null, now: now.toISOString() });
    upsertSecurity.run({ id: secPltr, symbol: "PLTR", name: "Palantir Technologies Inc.", security_type: "equity", underlying_security_id: null, now: now.toISOString() });
    upsertSecurity.run({ id: secRklb, symbol: "RKLB", name: "Rocket Lab USA, Inc.", security_type: "equity", underlying_security_id: null, now: now.toISOString() });
    upsertSecurity.run({ id: secNbis, symbol: "NBIS", name: "Nebius Group N.V.", security_type: "equity", underlying_security_id: null, now: now.toISOString() });

    upsertSecurity.run({ id: secAaplCall, symbol: "AAPL   260619C00220000", name: "AAPL 2026-06-19 C 220", security_type: "option", underlying_security_id: secAapl, now: now.toISOString() });
    upsertSecurity.run({ id: secAaplPut, symbol: "AAPL   260619P00190000", name: "AAPL 2026-06-19 P 190", security_type: "option", underlying_security_id: secAapl, now: now.toISOString() });
    // Covered calls (short 1 call per 100 shares)
    upsertSecurity.run({ id: secTslaCall, symbol: "TSLA   260619C00260000", name: "TSLA 2026-06-19 C 260", security_type: "option", underlying_security_id: secTsla, now: now.toISOString() });
    upsertSecurity.run({ id: secPltrCall, symbol: "PLTR   260619C00035000", name: "PLTR 2026-06-19 C 35", security_type: "option", underlying_security_id: secPltr, now: now.toISOString() });
    upsertSecurity.run({ id: secRklbCall, symbol: "RKLB   260619C00008000", name: "RKLB 2026-06-19 C 8", security_type: "option", underlying_security_id: secRklb, now: now.toISOString() });
    upsertSecurity.run({ id: secNbisCall, symbol: "NBIS   260619C00018000", name: "NBIS 2026-06-19 C 18", security_type: "option", underlying_security_id: secNbis, now: now.toISOString() });

    // dividend cashflows (demo)
    db.prepare("DELETE FROM cashflows WHERE account_id LIKE 'demo_%'").run();
    const insertCashflow = db.prepare(`
      INSERT INTO cashflows (id, account_id, security_id, type, amount, currency, ex_date, pay_date)
      VALUES (@id, @account_id, @security_id, @type, @amount, 'USD', @ex_date, @pay_date)
    `);

    for (let i = 0; i < snapshots.length; i++) {
      const asOf = snapshots[i]!.toISOString();
      const snap1 = newId("snap");
      const snap2 = newId("snap");
      insertSnapshot.run({ id: snap1, account_id: brokerageId, as_of: asOf });
      insertSnapshot.run({ id: snap2, account_id: iraId, as_of: asOf });

      // Simple drifting values over time
      const aaplPx = 185 + i * 8;
      const spyPx = 520 + i * 10;
      const qqqPx = 445 + i * 9;
      const bndPx = 72 - i * 0.5;
      const tslaPx = 240 + i * 12;
      const pltrPx = 23 + i * 2.2;
      const rklbPx = 5.2 + i * 0.7;
      const nbisPx = 14 + i * 1.5;

      // Brokerage holdings
      insertPosition.run({
        id: newId("pos"),
        snapshot_id: snap1,
        security_id: secAapl,
        quantity: 120,
        price: aaplPx,
        market_value: 120 * aaplPx,
        metadata_json: JSON.stringify({ demo: true }),
      });
      insertPosition.run({
        id: newId("pos"),
        snapshot_id: snap1,
        security_id: secSpy,
        quantity: 60,
        price: spyPx,
        market_value: 60 * spyPx,
        metadata_json: JSON.stringify({ demo: true }),
      });
      insertPosition.run({
        id: newId("pos"),
        snapshot_id: snap1,
        security_id: secQqq,
        quantity: 25,
        price: qqqPx,
        market_value: 25 * qqqPx,
        metadata_json: JSON.stringify({ demo: true }),
      });
      insertPosition.run({
        id: newId("pos"),
        snapshot_id: snap1,
        security_id: secCash,
        quantity: 1,
        price: 15000,
        market_value: 15000,
        metadata_json: JSON.stringify({ demo: true }),
      });

      // Single-name equity positions
      insertPosition.run({
        id: newId("pos"),
        snapshot_id: snap1,
        security_id: secTsla,
        quantity: 100,
        price: tslaPx,
        market_value: 100 * tslaPx,
        metadata_json: JSON.stringify({ demo: true }),
      });
      insertPosition.run({
        id: newId("pos"),
        snapshot_id: snap1,
        security_id: secPltr,
        quantity: 300,
        price: pltrPx,
        market_value: 300 * pltrPx,
        metadata_json: JSON.stringify({ demo: true }),
      });
      insertPosition.run({
        id: newId("pos"),
        snapshot_id: snap1,
        security_id: secRklb,
        quantity: 1200,
        price: rklbPx,
        market_value: 1200 * rklbPx,
        metadata_json: JSON.stringify({ demo: true }),
      });
      insertPosition.run({
        id: newId("pos"),
        snapshot_id: snap1,
        security_id: secNbis,
        quantity: 500,
        price: nbisPx,
        market_value: 500 * nbisPx,
        metadata_json: JSON.stringify({ demo: true }),
      });

      // Options (AAPL call/put) + covered calls on TSLA/PLTR/RKLB/NBIS. Deltas vary a bit.
      const callPosId = newId("pos");
      insertPosition.run({
        id: callPosId,
        snapshot_id: snap1,
        security_id: secAaplCall,
        quantity: 1,
        price: 18 + i * 1.2,
        market_value: (18 + i * 1.2) * 100,
        metadata_json: JSON.stringify({ demo: true }),
      });
      upsertGreek.run({ id: newId("greek"), position_id: callPosId, delta: 0.55 + i * 0.03 });

      const putPosId = newId("pos");
      insertPosition.run({
        id: putPosId,
        snapshot_id: snap1,
        security_id: secAaplPut,
        quantity: -1,
        price: 9 + i * 0.7,
        market_value: (9 + i * 0.7) * 100,
        metadata_json: JSON.stringify({ demo: true }),
      });
      upsertGreek.run({ id: newId("greek"), position_id: putPosId, delta: -0.35 - i * 0.02 });

      const tslaCcPosId = newId("pos");
      insertPosition.run({
        id: tslaCcPosId,
        snapshot_id: snap1,
        security_id: secTslaCall,
        quantity: -1,
        price: 22 + i * 1.6,
        market_value: (22 + i * 1.6) * 100,
        metadata_json: JSON.stringify({ demo: true }),
      });
      upsertGreek.run({ id: newId("greek"), position_id: tslaCcPosId, delta: -0.42 - i * 0.02 });

      const pltrCcPosId = newId("pos");
      insertPosition.run({
        id: pltrCcPosId,
        snapshot_id: snap1,
        security_id: secPltrCall,
        quantity: -3,
        price: 3.2 + i * 0.4,
        market_value: (3.2 + i * 0.4) * 100 * 3,
        metadata_json: JSON.stringify({ demo: true }),
      });
      upsertGreek.run({ id: newId("greek"), position_id: pltrCcPosId, delta: -0.28 - i * 0.01 });

      const rklbCcPosId = newId("pos");
      insertPosition.run({
        id: rklbCcPosId,
        snapshot_id: snap1,
        security_id: secRklbCall,
        quantity: -12,
        price: 0.65 + i * 0.08,
        market_value: (0.65 + i * 0.08) * 100 * 12,
        metadata_json: JSON.stringify({ demo: true }),
      });
      upsertGreek.run({ id: newId("greek"), position_id: rklbCcPosId, delta: -0.22 - i * 0.01 });

      const nbisCcPosId = newId("pos");
      insertPosition.run({
        id: nbisCcPosId,
        snapshot_id: snap1,
        security_id: secNbisCall,
        quantity: -5,
        price: 1.45 + i * 0.15,
        market_value: (1.45 + i * 0.15) * 100 * 5,
        metadata_json: JSON.stringify({ demo: true }),
      });
      upsertGreek.run({ id: newId("greek"), position_id: nbisCcPosId, delta: -0.30 - i * 0.015 });

      // IRA holdings
      insertPosition.run({
        id: newId("pos"),
        snapshot_id: snap2,
        security_id: secBnd,
        quantity: 400,
        price: bndPx,
        market_value: 400 * bndPx,
        metadata_json: JSON.stringify({ demo: true }),
      });
      insertPosition.run({
        id: newId("pos"),
        snapshot_id: snap2,
        security_id: secSpy,
        quantity: 35,
        price: spyPx,
        market_value: 35 * spyPx,
        metadata_json: JSON.stringify({ demo: true }),
      });
      insertPosition.run({
        id: newId("pos"),
        snapshot_id: snap2,
        security_id: secQqq,
        quantity: 18,
        price: qqqPx,
        market_value: 18 * qqqPx,
        metadata_json: JSON.stringify({ demo: true }),
      });
    }

    // Seed dividends: last month actual + next month expected + projected next-year totals (monthly)
    const today = new Date(now.toISOString().slice(0, 10) + "T00:00:00Z");
    const prevMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 15));
    const nextMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 15));

    const add = (params: { accountId: string; securityId: string; type: "dividend_actual" | "dividend_projected"; amount: number; pay: Date }) => {
      insertCashflow.run({
        id: newId("cf"),
        account_id: params.accountId,
        security_id: params.securityId,
        type: params.type,
        amount: params.amount,
        ex_date: null,
        pay_date: params.pay.toISOString().slice(0, 10),
      });
    };

    // Previous month actuals
    add({ accountId: brokerageId, securityId: secSpy, type: "dividend_actual", amount: 60 * 1.55, pay: prevMonth });
    add({ accountId: brokerageId, securityId: secQqq, type: "dividend_actual", amount: 25 * 0.65, pay: prevMonth });
    add({ accountId: iraId, securityId: secSpy, type: "dividend_actual", amount: 35 * 1.55, pay: prevMonth });
    add({ accountId: iraId, securityId: secBnd, type: "dividend_actual", amount: 400 * 0.23, pay: prevMonth });

    // Next month expected
    add({ accountId: brokerageId, securityId: secSpy, type: "dividend_projected", amount: 60 * 1.58, pay: nextMonth });
    add({ accountId: brokerageId, securityId: secQqq, type: "dividend_projected", amount: 25 * 0.67, pay: nextMonth });
    add({ accountId: iraId, securityId: secSpy, type: "dividend_projected", amount: 35 * 1.58, pay: nextMonth });
    add({ accountId: iraId, securityId: secBnd, type: "dividend_projected", amount: 400 * 0.24, pay: nextMonth });

    // Next 12 months projection
    for (let m = 1; m <= 12; m++) {
      const pay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + m, 15));
      add({ accountId: brokerageId, securityId: secSpy, type: "dividend_projected", amount: 60 * 1.58, pay });
      add({ accountId: brokerageId, securityId: secQqq, type: "dividend_projected", amount: 25 * 0.67, pay });
      add({ accountId: iraId, securityId: secSpy, type: "dividend_projected", amount: 35 * 1.58, pay });
      add({ accountId: iraId, securityId: secBnd, type: "dividend_projected", amount: 400 * 0.24, pay });
    }
  });

  tx();

  return NextResponse.json({ ok: true });
}

