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
  nickname TEXT,
  schwab_account_hash TEXT,
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
  option_type TEXT,
  expiration_date TEXT,
  strike_price REAL,
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

-- Security taxonomy / fundamentals caching (sector, industry, etc.)
CREATE TABLE IF NOT EXISTS security_taxonomy (
  symbol TEXT PRIMARY KEY,
  sector TEXT,
  industry TEXT,
  market_cap REAL, -- numeric market cap when available
  market_cap_bucket TEXT, -- 'mega' | 'large' | 'mid' | 'small' | 'micro' | 'unknown'
  revenue_geo_bucket TEXT, -- 'US' | 'Intl' | 'Mixed' | 'unknown'
  source TEXT, -- 'schwab' | 'manual' | etc.
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

-- Account equity/value time series (best-available).
-- For Schwab this is populated from point-in-time account balances on each sync.
CREATE TABLE IF NOT EXISTS account_value_points (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  as_of TEXT NOT NULL, -- ISO datetime
  equity_value REAL NOT NULL, -- account equity / liquidation value proxy
  cash_value REAL, -- if available
  source TEXT NOT NULL, -- 'schwab_balances' | 'manual' | etc.
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, as_of)
);

-- Weekly (or thinned monthly for old periods) portfolio totals + SPY/QQQ closes on the same calendar date.
-- Buckets match Performance UI: combined | retirement | brokerage. Depth is limited by sync history (no broker NAV time machine).
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id TEXT PRIMARY KEY,
  snapshot_date TEXT NOT NULL, -- ISO YYYY-MM-DD (typically week-ending Friday)
  bucket TEXT NOT NULL DEFAULT 'combined', -- 'combined' | 'retirement' | 'brokerage'
  total_value REAL NOT NULL,
  account_balances_json TEXT, -- optional JSON map of account_id -> value for debugging
  spy_close REAL,
  qqq_close REAL,
  source TEXT NOT NULL, -- 'backfill_holdings' | 'weekly_job' | 'cron_weekly' | etc.
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(snapshot_date, bucket)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_date ON portfolio_snapshots(snapshot_date);

-- Cached OHLCV candles for terminal visualizations + volume anomaly detection.
-- interval: '1d' | '5m' etc. ts_ms: candle start time in epoch ms.
CREATE TABLE IF NOT EXISTS ohlcv_points (
  provider TEXT NOT NULL, -- 'schwab'
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  ts_ms INTEGER NOT NULL,
  open REAL,
  high REAL,
  low REAL,
  close REAL,
  volume REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider, symbol, interval, ts_ms)
);

CREATE INDEX IF NOT EXISTS idx_ohlcv_points_symbol_interval_ts ON ohlcv_points(symbol, interval, ts_ms);

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

-- Upcoming / recent earnings + trade-opportunity metrics (IV vs “normal”, dollar liquidity).
-- IV fields are intended for Schwab (or other broker) enrichment; calendar often comes from Finnhub.
CREATE TABLE IF NOT EXISTS earnings_events (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL COLLATE NOCASE,
  security_id TEXT REFERENCES securities(id) ON DELETE SET NULL,
  earnings_date TEXT NOT NULL, -- YYYY-MM-DD
  fiscal_period_end TEXT,
  time_of_day TEXT, -- 'bmo' | 'amc' | 'dmh' | ''
  source TEXT NOT NULL, -- 'finnhub' | 'demo' | 'schwab' | 'manual'
  raw_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(symbol, earnings_date)
);

CREATE INDEX IF NOT EXISTS idx_earnings_events_date ON earnings_events(earnings_date);
CREATE INDEX IF NOT EXISTS idx_earnings_events_symbol ON earnings_events(symbol);

-- Terminal X digest cache (server-side; populated by cron or manual refresh).
CREATE TABLE IF NOT EXISTS x_digest_cache (
  id TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS x_symbol_cache (
  symbol TEXT PRIMARY KEY COLLATE NOCASE,
  generated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

-- Schwab (and future brokers) transaction history for strategy views.
-- One row per API activity; `raw_json` holds full payload including all legs.
CREATE TABLE IF NOT EXISTS broker_transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  external_activity_id TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  transaction_type TEXT,
  description TEXT,
  net_amount REAL,
  raw_json TEXT NOT NULL,
  symbol TEXT,
  underlying_symbol TEXT,
  asset_type TEXT,
  instruction TEXT,
  position_effect TEXT,
  quantity REAL,
  price REAL,
  option_expiration TEXT,
  option_right TEXT,
  option_strike REAL,
  leg_count INTEGER NOT NULL DEFAULT 1,
  strategy_category TEXT,
  classified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, external_activity_id)
);

CREATE INDEX IF NOT EXISTS idx_broker_tx_account_date ON broker_transactions(account_id, trade_date);
CREATE INDEX IF NOT EXISTS idx_broker_tx_category ON broker_transactions(strategy_category, trade_date);

CREATE TABLE IF NOT EXISTS earnings_opp_metrics (
  id TEXT PRIMARY KEY,
  earnings_event_id TEXT NOT NULL UNIQUE REFERENCES earnings_events(id) ON DELETE CASCADE,
  as_of TEXT NOT NULL,
  iv_current REAL,
  iv_52w_high REAL,
  iv_52w_low REAL,
  iv_rank_pct REAL,
  hist_vol_30d REAL,
  avg_share_volume_20d REAL,
  avg_share_volume_5d REAL,
  volume_ratio REAL,
  session_volume REAL,
  iv_over_hist_vol REAL,
  relative_volume_index REAL,
  avg_dollar_volume_20d REAL,
  dollar_liquidity_score REAL,
  opportunity_score REAL,
  metrics_source TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

