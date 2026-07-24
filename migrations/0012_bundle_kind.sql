-- rules = 规则集（payload/list）；profile = 完整 Clash 模板
ALTER TABLE subscription_bundles ADD COLUMN kind TEXT NOT NULL DEFAULT 'rules';

UPDATE subscription_bundles SET kind = 'rules' WHERE kind IS NULL OR TRIM(kind) = '';
