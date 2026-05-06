PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Institution connections (Schwab, Plaid, file import, etc.)
CREATE TABLE IF NOT EXISTS institution_connections (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL, -- 'schwab' | 'plaid' | 'file'
  display_name TEXT NOT NULL,
  status TEXT NOT NULL, -- 'active' | 'error' | 'disabled'
  last_sync_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES institution_connections(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS securities (
  id TEXT PRIMARY KEY,
  symbol TEXT,
  name TEXT,
  security_type TEXT NOT NULL, -- 'equity' | 'fund' | 'cash' | 'option' | 'other'
  cusip TEXT,
  isin TEXT,
  underlying_security_id TEXT REFERENCES securities(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS holding_snapshots (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  as_of TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES holding_snapshots(id) ON DELETE CASCADE,
  security_id TEXT NOT NULL REFERENCES securities(id),
  quantity REAL NOT NULL,
  price REAL, -- per-unit price, if known
  market_value REAL, -- if known
  metadata_json TEXT, -- connector-specific details
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS option_greeks (
  id TEXT PRIMARY KEY,
  position_id TEXT NOT NULL UNIQUE REFERENCES positions(id) ON DELETE CASCADE,
  delta REAL,
  gamma REAL,
  theta REAL,
  vega REAL,
  iv REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS target_allocations (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL, -- 'global' | 'account'
  account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  asset_class TEXT NOT NULL,
  target_weight REAL NOT NULL, -- 0..1
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL, -- 'drift' | 'concentration' | 'change'
  config_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alert_events (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  occurred_at TEXT NOT NULL,
  severity TEXT NOT NULL, -- 'info' | 'warning' | 'critical'
  title TEXT NOT NULL,
  details_json TEXT,
  acknowledged_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cached market data (benchmarks, underlying prices, etc.)
CREATE TABLE IF NOT EXISTS price_points (
  provider TEXT NOT NULL, -- 'schwab'
  symbol TEXT NOT NULL,
  date TEXT NOT NULL, -- ISO date (YYYY-MM-DD)
  close REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider, symbol, date)
);

-- Cashflows (dividends, interest, etc.)
CREATE TABLE IF NOT EXISTS cashflows (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  security_id TEXT REFERENCES securities(id),
  type TEXT NOT NULL, -- 'dividend_actual' | 'dividend_projected'
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  ex_date TEXT,
  pay_date TEXT NOT NULL, -- ISO date or datetime
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

