-- 上游拉取失败计数 + 当日放弃自动重试的日期（YYYY-MM-DD，Asia/Shanghai 语义由应用写入）
ALTER TABLE category_sources ADD COLUMN consecutive_failures INTEGER DEFAULT 0;
ALTER TABLE category_sources ADD COLUMN skip_auto_sync_on TEXT;
