CREATE TABLE IF NOT EXISTS funds (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  risk TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS holdings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fund_code TEXT NOT NULL,
  ticker TEXT NOT NULL,
  company TEXT,
  weight REAL NOT NULL DEFAULT 0,
  cost_basis REAL NOT NULL DEFAULT 0,
  shares REAL NOT NULL DEFAULT 0,
  current_price REAL NOT NULL DEFAULT 0,
  action TEXT,
  reason TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_holdings_fund ON holdings(fund_code);

CREATE TABLE IF NOT EXISTS briefs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brief_date TEXT NOT NULL,
  market_overview TEXT,
  market TEXT,
  moves TEXT,
  sentiment TEXT,
  news TEXT,
  coming_up TEXT,
  why TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT,
  status TEXT,
  model TEXT,
  note TEXT
);

INSERT OR IGNORE INTO funds (code, name, risk, description) VALUES
  ('WTR-AG', 'Whitewater', 'Aggressive', 'High-risk, high-velocity alpha generation from market chaos.'),
  ('WTR-MD', 'Deepwater', 'Balanced', 'Medium-risk, current-driven institutional growth.'),
  ('WTR-LO', 'Stillwater', 'Defensive', 'Low-risk, high-certainty capital preservation.');

-- No seed holdings: the portfolio is built entirely by the AI on the first /api/run.
