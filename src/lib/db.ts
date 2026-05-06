import fs from "node:fs";

import Database from "better-sqlite3";

import { ensureDirSync } from "@/lib/fs";
import { getAppDataDir, getDbPath } from "@/lib/paths";

let _db: Database.Database | null = null;

function readSchemaSql(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  return fs.readFileSync(schemaPath, "utf-8");
}

export function getDb(): Database.Database {
  if (_db) return _db;
  ensureDirSync(getAppDataDir());
  const dbPath = getDbPath();
  _db = new Database(dbPath);
  _db.pragma("foreign_keys = ON");
  migrate(_db);
  return _db;
}

function migrate(db: Database.Database) {
  const schema = readSchemaSql();
  db.exec(schema);
  // In Phase 1 we keep migrations as a single schema file; we can add proper migration files later.
  const name = "0001_init";
  const exists = db
    .prepare("SELECT 1 FROM schema_migrations WHERE name = ? LIMIT 1")
    .get(name);
  if (!exists) {
    db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(name);
  }
}

