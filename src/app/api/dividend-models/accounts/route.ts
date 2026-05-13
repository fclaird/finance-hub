import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { notPosterityWhereSql } from "@/lib/posterity";

/**
 * Schwab brokerage accounts (for linking a dividend model portfolio slice).
 */
export async function GET() {
  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT
        a.id AS id,
        a.name AS name,
        a.type AS type,
        (SELECT MAX(hs.as_of) FROM holding_snapshots hs WHERE hs.account_id = a.id) AS lastSnapshotAsOf
      FROM accounts a
      WHERE a.id LIKE 'schwab_%'
        AND ${notPosterityWhereSql("a")}
      ORDER BY a.name ASC
    `,
    )
    .all() as Array<{ id: string; name: string; type: string; lastSnapshotAsOf: string | null }>;

  return NextResponse.json({ ok: true, accounts: rows });
}
