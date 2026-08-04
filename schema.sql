-- Watercooler AI fund - Cloudflare D1 schema
-- Apply with:  wrangler d1 execute watercooler --file=./schema.sql --remote

CREATE TABLE IF NOT EXISTS funds (
  code        TEXT PRIMARY KEY,   -- WTR-AG / WTR-MD / WTR-LO
  name        TEXT NOT NULL,
  risk        TEXT NOT NULL,      -- Aggressive / Balanced / Defensive
  description TEXT
);

CREATE TABLE IF NOT EXISTS holdings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  fund_code     TEXT NOT NULL,
  ticker        TEXT NOT NULL,
  company       TEXT,
  weight        REAL NOT NULL DEFAULT 0,   -- target weight %
  cost_basis    REAL NOT NULL DEFAULT 0,   -- price when the position was first opened
  shares        REAL NOT NULL DEFAULT 0,
  current_price REAL NOT NULL DEFAULT 0,
  action        TEXT,                       -- hold / add / trim / open / close
  reason        TEXT,                       -- one-line thesis
  updated_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_holdings_fund ON holdings(fund_code);

CREATE TABLE IF NOT EXISTS briefs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  brief_date      TEXT NOT NULL,
  market_overview TEXT,
  market          TEXT,
  moves           TEXT,
  sentiment       TEXT,
  news            TEXT,
  coming_up       TEXT,
  why             TEXT,
  created_at      TEXT
);

CREATE TABLE IF NOT EXISTS runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT,
  status     TEXT,   -- ok / error
  model      TEXT,
  note       TEXT
);

-- Seed the three house funds
INSERT OR IGNORE INTO funds (code, name, risk, description) VALUES
  ('WTR-AG', 'Whitewater', 'Aggressive', 'The highest-risk fund. Backs bold, fast-growing companies for the biggest upside, and cops the swings that come with it.'),
  ('WTR-MD', 'Tidewater', 'Balanced', 'The middle-ground fund. A solid core of quality companies with enough spread to keep growing through the noise.'),
  ('WTR-LO', 'Stillwater', 'Defensive', 'The lowest-risk fund. Steady, reliable earners and broad market cover for a calm, slow-and-steady ride.');

-- Seed starter holdings (mirrors the site's defaults). The first AI run overwrites these.
INSERT INTO holdings (fund_code, ticker, company, weight, cost_basis, shares, current_price, action, reason) VALUES
  ('WTR-AG', 'RKLB', 'Rocket Lab', 28, 24.2, 90, 27.6, 'hold', 'Launch, space systems and long-duration infrastructure growth.'),
  ('WTR-AG', 'NVDA', 'NVIDIA', 25, 132.5, 12, 146.1, 'hold', 'Core compute layer for accelerated AI workloads.'),
  ('WTR-AG', 'PLTR', 'Palantir', 20, 92.8, 35, 98.4, 'hold', 'Operational AI deployment with strong government and enterprise positioning.'),
  ('WTR-AG', 'TSLA', 'Tesla', 14, 301.4, 7, 285.9, 'hold', 'High-variance autonomy, energy and manufacturing optionality.'),
  ('WTR-MD', 'MSFT', 'Microsoft', 24, 446.2, 8, 462.8, 'hold', 'Cloud distribution, enterprise software and AI monetisation.'),
  ('WTR-MD', 'GOOGL', 'Alphabet', 20, 184.7, 14, 191.3, 'hold', 'Search cash flows funding a broad AI and infrastructure portfolio.'),
  ('WTR-MD', 'AMZN', 'Amazon', 20, 207.4, 11, 214.2, 'hold', 'AWS, logistics scale and operating leverage.'),
  ('WTR-MD', 'V', 'Visa', 15, 330.5, 9, 338.1, 'hold', 'Global payment rails with resilient economics.'),
  ('WTR-LO', 'VOO', 'Vanguard S&P 500 ETF', 38, 552.1, 10, 563.4, 'hold', 'Low-cost US large-cap core exposure.'),
  ('WTR-LO', 'BRK.B', 'Berkshire Hathaway', 20, 472.2, 8, 479.5, 'hold', 'Diversified quality assets and disciplined capital allocation.'),
  ('WTR-LO', 'COST', 'Costco', 15, 940.3, 3, 956.7, 'hold', 'Recurring membership economics and resilient consumer loyalty.'),
  ('WTR-LO', 'BND', 'Vanguard Total Bond Market ETF', 15, 73.1, 20, 73.6, 'hold', 'Broad fixed-income ballast.');
