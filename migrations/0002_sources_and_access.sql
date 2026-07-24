-- 历史迁移：访问策略列 + 数据源表
-- 注意：SQLite/D1 的 ALTER TABLE ADD COLUMN 不可重复执行。
-- 若运行时 ensureDatabase 已加过这些列，请用 `pnpm db:migrate:remote`（安全脚本）
-- 它会先根据 PRAGMA 补记 d1_migrations，再执行 wrangler apply。
-- 全新空库可直接 apply 本文件。

ALTER TABLE categories ADD COLUMN public_links_enabled INTEGER DEFAULT 0;
ALTER TABLE categories ADD COLUMN token_links_enabled INTEGER DEFAULT 1;
ALTER TABLE rules ADD COLUMN source_id TEXT;

UPDATE categories SET public_links_enabled = 0 WHERE token_links_enabled = 1 AND public_links_enabled = 1;

CREATE TABLE IF NOT EXISTS category_sources (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  last_synced_at TEXT,
  last_status TEXT DEFAULT 'pending',
  last_count INTEGER DEFAULT 0,
  last_error TEXT,
  sync_interval_minutes INTEGER DEFAULT 60,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

DROP INDEX IF EXISTS idx_rules_unique_value;
CREATE UNIQUE INDEX IF NOT EXISTS idx_rules_unique_source_value ON rules(category_id, IFNULL(source_id, ''), type, value);
CREATE INDEX IF NOT EXISTS idx_sources_category ON category_sources(category_id);
CREATE INDEX IF NOT EXISTS idx_rules_source ON rules(source_id);
