CREATE TABLE IF NOT EXISTS subscription_bundles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  format TEXT NOT NULL DEFAULT 'yaml',
  category_ids TEXT NOT NULL DEFAULT '[]',
  public_links_enabled INTEGER DEFAULT 0,
  token_links_enabled INTEGER DEFAULT 1,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_subscription_bundles_name ON subscription_bundles(name);
