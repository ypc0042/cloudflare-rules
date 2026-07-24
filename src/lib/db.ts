import type { BackupRuleSource, BundleFormat, BundleKind, DomainRule, RuleCategory, RuleOptimizationMode, RuleSettings, RuleSource, RulesBackupData, RulesData, SubscriptionBundle } from '../types/domain-rules';
import { UPSTREAM_RULE_PREVIEW_LIMIT } from '../types/domain-rules';
import type { Env } from '../types';
import { normalizeGithubMirrorUrl, sourceNameFromSubscriptionUrl } from './github-mirror';
import { parseRuleInput } from './parser';
import { id, slugify, validateCategoryName } from './slug';

type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  description: string | null;
  note: string | null;
  sort_order: number | null;
  enabled: number | null;
  created_at: string;
  updated_at: string;
  public_links_enabled: number | null;
  token_links_enabled: number | null;
};

type RuleRow = {
  id: string;
  category_id: string;
  value: string;
  type: DomainRule['type'];
  display_type: string | null;
  note: string | null;
  enabled: number | null;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
  source_id: string | null;
  source_name?: string | null;
  source_type?: 'url' | 'geosite' | 'geoip' | null;
  category_name?: string | null;
  category_description?: string | null;
};

type RuleCountRow = {
  category_id: string;
  rule_count: number;
  enabled_rule_count: number;
  manual_rule_count: number;
  url_rule_count: number;
  geo_rule_count: number;
};

type SourceRow = {
  id: string; category_id: string; name: string; url: string; enabled: number | null;
  last_synced_at: string | null; last_status: RuleSource['lastStatus'] | null;
  last_count: number | null; last_error: string | null;
  last_original_count: number | null;
  sync_interval_minutes: number | null;
  user_agent: string | null;
  source_type: 'url' | 'geosite' | 'geoip' | null;
  geosite_name: string | null;
  geoip_name: string | null;
  rule_optimization: RuleOptimizationMode | 'balanced' | null;
  consecutive_failures: number | null;
  skip_auto_sync_on: string | null;
};

const defaultSettings: RuleSettings = {
  baseUrl: '',
  policyName: '',
  githubMirrorUrl: '',
  publicLinksEnabled: true,
  tokenLinksEnabled: true,
  customIconPackUrls: [],
  customIconPackNames: {},
};

const readyDatabases = new WeakMap<object, Promise<void>>();

/**
 * Allows a newly deployed Worker to start with an empty D1 database. The
 * statements are idempotent and the promise is reused for the lifetime of a
 * Worker isolate, so ordinary requests do not repeatedly initialise schema.
 */
export function ensureDatabase(env: Env) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      icon TEXT, description TEXT, note TEXT, sort_order INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS rules (
      id TEXT PRIMARY KEY, category_id TEXT NOT NULL, value TEXT NOT NULL,
      type TEXT NOT NULL, display_type TEXT, note TEXT, enabled INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    )`,
    'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)',
    'CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, expires_at TEXT NOT NULL, created_at TEXT NOT NULL)',
    `CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY, note TEXT NOT NULL DEFAULT '', key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT
    )`,
    'CREATE INDEX IF NOT EXISTS idx_rules_category_id ON rules(category_id)',
    'CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug)',
    'CREATE INDEX IF NOT EXISTS idx_rules_enabled ON rules(enabled)',
    'CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)',
    `CREATE TABLE IF NOT EXISTS category_sources (
      id TEXT PRIMARY KEY, category_id TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL,
      enabled INTEGER DEFAULT 1, last_synced_at TEXT, last_status TEXT DEFAULT 'pending',
      last_count INTEGER DEFAULT 0, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      sync_interval_minutes INTEGER DEFAULT 60,
      user_agent TEXT DEFAULT 'clash-verge/v2.5.1',
      source_type TEXT DEFAULT 'url', geosite_name TEXT, geoip_name TEXT,
      rule_optimization TEXT DEFAULT 'none', last_original_count INTEGER DEFAULT 0,
      consecutive_failures INTEGER DEFAULT 0,
      skip_auto_sync_on TEXT,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    )`,
    `INSERT OR IGNORE INTO settings (key, value) VALUES
      ('baseUrl', ''), ('policyName', ''), ('githubMirrorUrl', ''), ('publicLinksEnabled', 'true'), ('tokenLinksEnabled', 'true'), ('customIconPackUrls', '[]'), ('customIconPackNames', '{}')`,
    `CREATE TABLE IF NOT EXISTS subscription_bundles (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      format TEXT NOT NULL DEFAULT 'yaml', kind TEXT NOT NULL DEFAULT 'rules',
      category_ids TEXT NOT NULL DEFAULT '[]',
      public_links_enabled INTEGER DEFAULT 0, token_links_enabled INTEGER DEFAULT 1,
      note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_subscription_bundles_name ON subscription_bundles(name)',
  ];

  let databaseReady = readyDatabases.get(env.DB as object);
  if (!databaseReady) {
    databaseReady = (async () => {
    await env.DB.batch(statements.map((statement) => env.DB.prepare(statement)));
    await env.DB.prepare(`INSERT OR IGNORE INTO api_keys (id, note, key_hash, key_prefix, created_at)
      SELECT 'key_legacy', '迁移的 API Key', value, 'prk_legacy…', COALESCE((SELECT value FROM settings WHERE key = 'apiKeyCreatedAt'), ?)
      FROM settings WHERE key = 'apiKeyHash' AND value <> ''`).bind(now()).run();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM settings WHERE key = 'apiKeyHash'"),
      env.DB.prepare("DELETE FROM settings WHERE key = 'apiKeyCreatedAt'"),
    ]);
    const [categoryColumns, ruleColumns, sourceColumns] = await Promise.all([
      env.DB.prepare('PRAGMA table_info(categories)').all<{ name: string }>(),
      env.DB.prepare('PRAGMA table_info(rules)').all<{ name: string }>(),
      env.DB.prepare('PRAGMA table_info(category_sources)').all<{ name: string }>(),
    ]);
    const categoryNames = new Set((categoryColumns.results ?? []).map((column) => column.name));
    const ruleNames = new Set((ruleColumns.results ?? []).map((column) => column.name));
    const sourceNames = new Set((sourceColumns.results ?? []).map((column) => column.name));
    const alters: string[] = [];
    if (!categoryNames.has('public_links_enabled')) alters.push('ALTER TABLE categories ADD COLUMN public_links_enabled INTEGER DEFAULT 0');
    if (!categoryNames.has('token_links_enabled')) alters.push('ALTER TABLE categories ADD COLUMN token_links_enabled INTEGER DEFAULT 1');
    if (!ruleNames.has('source_id')) alters.push('ALTER TABLE rules ADD COLUMN source_id TEXT');
    if (!sourceNames.has('sync_interval_minutes')) alters.push('ALTER TABLE category_sources ADD COLUMN sync_interval_minutes INTEGER DEFAULT 60');
    if (!sourceNames.has('user_agent')) alters.push("ALTER TABLE category_sources ADD COLUMN user_agent TEXT DEFAULT 'clash-verge/v2.5.1'");
    if (!sourceNames.has('source_type')) alters.push("ALTER TABLE category_sources ADD COLUMN source_type TEXT DEFAULT 'url'");
    if (!sourceNames.has('geosite_name')) alters.push('ALTER TABLE category_sources ADD COLUMN geosite_name TEXT');
    if (!sourceNames.has('geoip_name')) alters.push('ALTER TABLE category_sources ADD COLUMN geoip_name TEXT');
    if (!sourceNames.has('rule_optimization')) alters.push("ALTER TABLE category_sources ADD COLUMN rule_optimization TEXT DEFAULT 'none'");
    if (!sourceNames.has('last_original_count')) alters.push('ALTER TABLE category_sources ADD COLUMN last_original_count INTEGER DEFAULT 0');
    if (!sourceNames.has('consecutive_failures')) alters.push('ALTER TABLE category_sources ADD COLUMN consecutive_failures INTEGER DEFAULT 0');
    if (!sourceNames.has('skip_auto_sync_on')) alters.push('ALTER TABLE category_sources ADD COLUMN skip_auto_sync_on TEXT');
    try {
      const bundleColumns = await env.DB.prepare('PRAGMA table_info(subscription_bundles)').all<{ name: string }>();
      const bundleNames = new Set((bundleColumns.results ?? []).map((column) => column.name));
      if (bundleNames.size && !bundleNames.has('kind')) alters.push("ALTER TABLE subscription_bundles ADD COLUMN kind TEXT NOT NULL DEFAULT 'rules'");
    } catch {
      /* table may not exist yet */
    }
    for (const statement of alters) await env.DB.prepare(statement).run();
    await env.DB.prepare("UPDATE category_sources SET url = 'https://raw.githubusercontent.com/Loyalsoldier/geoip/release/text/' || geoip_name || '.txt' WHERE source_type = 'geoip' AND geoip_name IS NOT NULL AND url NOT LIKE '%/text/%.txt'").run();
    await env.DB.batch([
      env.DB.prepare('DROP INDEX IF EXISTS idx_rules_unique_value'),
      env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_rules_unique_source_value ON rules(category_id, IFNULL(source_id, ''), type, value)"),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_sources_category ON category_sources(category_id)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_rules_source ON rules(source_id)'),
      env.DB.prepare('UPDATE categories SET public_links_enabled = 0 WHERE token_links_enabled = 1 AND public_links_enabled = 1'),
    ]);
    // 防止「ensureDatabase 已建好结构，但 d1_migrations 未记录」导致 wrangler 重复 ALTER 失败。
    // 表结构由 wrangler 官方字段对齐；仅在表已存在或成功创建后写入已满足的迁移名。
    await reconcileD1MigrationRecords(env);
    })();
    readyDatabases.set(env.DB as object, databaseReady);
  }
  return databaseReady;
}

/**
 * 当运行时 schema 已由 ensureDatabase 拉齐时，把对应迁移文件名写入 d1_migrations，
 * 避免之后 `wrangler d1 migrations apply` 再执行会炸的 ADD COLUMN。
 */
async function reconcileD1MigrationRecords(env: Env) {
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS d1_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`,
    ).run();
  } catch {
    // 若官方表结构不同导致创建失败，尝试直接插入（表可能已存在）
  }

  const known: string[] = [
    '0001_init.sql',
    '0002_sources_and_access.sql',
    '0003_geosite_sources.sql',
    '0004_geoip_sources.sql',
    '0005_api_keys.sql',
    '0006_runtime_baseline.sql',
    '0007_source_user_agent.sql',
    '0008_source_rule_optimization.sql',
    '0009_rule_optimization_levels.sql',
    '0010_github_mirror_setting.sql',
    '0011_subscription_bundles.sql',
    '0012_bundle_kind.sql',
    '0013_source_failure_backoff.sql',
  ];

  try {
    const [categoryColumns, ruleColumns, sourceColumns, tables, bundleColumns] = await Promise.all([
      env.DB.prepare('PRAGMA table_info(categories)').all<{ name: string }>(),
      env.DB.prepare('PRAGMA table_info(rules)').all<{ name: string }>(),
      env.DB.prepare('PRAGMA table_info(category_sources)').all<{ name: string }>(),
      env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{ name: string }>(),
      env.DB.prepare('PRAGMA table_info(subscription_bundles)').all<{ name: string }>().catch(() => ({ results: [] as { name: string }[] })),
    ]);
    const categoryNames = new Set((categoryColumns.results ?? []).map((column) => column.name));
    const ruleNames = new Set((ruleColumns.results ?? []).map((column) => column.name));
    const sourceNames = new Set((sourceColumns.results ?? []).map((column) => column.name));
    const tableNames = new Set((tables.results ?? []).map((row) => row.name));
    const bundleNames = new Set((bundleColumns.results ?? []).map((column) => column.name));

    const satisfied = (name: string) => {
      switch (name) {
        case '0001_init.sql':
          return tableNames.has('categories') && tableNames.has('rules');
        case '0002_sources_and_access.sql':
          return categoryNames.has('public_links_enabled') && categoryNames.has('token_links_enabled') && ruleNames.has('source_id') && tableNames.has('category_sources');
        case '0003_geosite_sources.sql':
          return sourceNames.has('source_type') && sourceNames.has('geosite_name');
        case '0004_geoip_sources.sql':
          return sourceNames.has('geoip_name');
        case '0005_api_keys.sql':
          return tableNames.has('api_keys');
        case '0006_runtime_baseline.sql':
        case '0009_rule_optimization_levels.sql':
        case '0010_github_mirror_setting.sql':
          return tableNames.has('settings');
        case '0007_source_user_agent.sql':
          return sourceNames.has('user_agent');
        case '0008_source_rule_optimization.sql':
          return sourceNames.has('rule_optimization') && sourceNames.has('last_original_count');
        case '0011_subscription_bundles.sql':
          return tableNames.has('subscription_bundles');
        case '0012_bundle_kind.sql':
          return tableNames.has('subscription_bundles') && bundleNames.has('kind');
        case '0013_source_failure_backoff.sql':
          return sourceNames.has('consecutive_failures') && sourceNames.has('skip_auto_sync_on');
        default:
          return false;
      }
    };

    for (const name of known) {
      if (!satisfied(name)) continue;
      await env.DB.prepare('INSERT OR IGNORE INTO d1_migrations (name) VALUES (?)').bind(name).run();
    }
  } catch {
    // 迁移表不可用时忽略；用户仍可用 pnpm db:migrate:remote（安全脚本）
  }
}

export function now() {
  return new Date().toISOString();
}

export function sourceNameFromUrl(value: string, fallback = '') {
  return sourceNameFromSubscriptionUrl(value, fallback);
}

function sourceFromRow(row: SourceRow): RuleSource {
  const name = (row.source_type ?? 'url') === 'url' ? sourceNameFromUrl(row.url, row.name) : row.name;
  return { id: row.id, categoryId: row.category_id, name, url: row.url, enabled: row.enabled !== 0,
    lastSyncedAt: row.last_synced_at ?? undefined, lastStatus: row.last_status ?? 'pending',
    lastCount: row.last_count ?? 0, lastOriginalCount: row.last_original_count ?? row.last_count ?? 0, lastError: row.last_error ?? undefined, consecutiveFailures: row.consecutive_failures ?? 0, skipAutoSyncOn: row.skip_auto_sync_on ?? undefined, syncIntervalMinutes: row.sync_interval_minutes ?? 60,
    userAgent: row.user_agent ?? 'clash-verge/v2.5.1',
    sourceType: row.source_type ?? 'url', geositeName: row.geosite_name ?? undefined, geoipName: row.geoip_name ?? undefined,
    ruleOptimization: row.rule_optimization === 'balanced' ? 'aggressive' : row.rule_optimization ?? 'none' };
}

function categoryFromRow(row: CategoryRow, rules: DomainRule[], sources: RuleSource[], counts?: RuleCountRow): RuleCategory {
  const uniqueRules = new Map<string, DomainRule>();
  for (const rule of rules) {
    const key = `${rule.type}:${rule.value}`.toLowerCase();
    const existing = uniqueRules.get(key);
    if (!existing || (!rule.sourceId && existing.sourceId)) uniqueRules.set(key, rule);
  }
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    icon: row.icon ?? undefined,
    description: row.description ?? undefined,
    note: row.note ?? undefined,
    enabled: row.enabled !== 0,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rules: [...uniqueRules.values()],
    publicLinksEnabled: row.public_links_enabled !== 0,
    tokenLinksEnabled: row.token_links_enabled !== 0,
    sources,
    lastSyncedAt: sources.reduce<string | undefined>((latest, source) => !latest || (source.lastSyncedAt ?? '') > latest ? source.lastSyncedAt : latest, undefined),
    syncIntervalMinutes: sources[0]?.syncIntervalMinutes ?? 60,
    ruleCount: counts?.rule_count ?? uniqueRules.size,
    enabledRuleCount: counts?.enabled_rule_count ?? [...uniqueRules.values()].filter((rule) => rule.enabled).length,
    manualRuleCount: counts?.manual_rule_count ?? [...uniqueRules.values()].filter((rule) => !rule.sourceId).length,
    urlRuleCount: counts?.url_rule_count ?? [...uniqueRules.values()].filter((rule) => rule.sourceType === 'url').length,
    geoRuleCount: counts?.geo_rule_count ?? [...uniqueRules.values()].filter((rule) => rule.sourceId && rule.sourceType !== 'url').length,
  };
}

function ruleFromRow(row: RuleRow): DomainRule {
  return {
    id: row.id,
    categoryId: row.category_id,
    value: row.value,
    type: row.type,
    displayType: row.display_type ?? undefined,
    note: row.note ?? undefined,
    enabled: row.enabled !== 0,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceId: row.source_id ?? undefined,
    sourceName: row.source_name ?? undefined,
    sourceType: row.source_type ?? undefined,
  };
}

const deduplicatedRuleCte = `WITH ranked_rules AS (
  SELECT r.*, s.name AS source_name, COALESCE(s.source_type, 'url') AS source_type,
    c.name AS category_name, c.description AS category_description,
    ROW_NUMBER() OVER (
      PARTITION BY r.category_id, LOWER(r.type), LOWER(r.value)
      ORDER BY CASE WHEN r.source_id IS NULL THEN 0 ELSE 1 END, r.sort_order ASC, r.created_at ASC
    ) AS duplicate_rank
  FROM rules r
  LEFT JOIN category_sources s ON s.id = r.source_id
  LEFT JOIN categories c ON c.id = r.category_id
)`;

async function getRuleCounts(env: Env) {
  const rows = await env.DB.prepare(`${deduplicatedRuleCte}
    SELECT category_id,
      COUNT(*) AS rule_count,
      SUM(CASE WHEN enabled <> 0 THEN 1 ELSE 0 END) AS enabled_rule_count,
      SUM(CASE WHEN source_id IS NULL THEN 1 ELSE 0 END) AS manual_rule_count,
      SUM(CASE WHEN source_id IS NOT NULL AND source_type = 'url' THEN 1 ELSE 0 END) AS url_rule_count,
      SUM(CASE WHEN source_id IS NOT NULL AND source_type <> 'url' THEN 1 ELSE 0 END) AS geo_rule_count
    FROM ranked_rules WHERE duplicate_rank = 1 GROUP BY category_id`).all<RuleCountRow>();
  return new Map((rows.results ?? []).map((row) => [row.category_id, row]));
}

export async function getSettings(env: Env): Promise<RuleSettings> {
  const rows = await env.DB.prepare('SELECT key, value FROM settings').all<{ key: string; value: string | null }>();
  const settings = { ...defaultSettings };
  for (const row of rows.results ?? []) {
    if (row.key === 'baseUrl') settings.baseUrl = row.value ?? '';
    if (row.key === 'policyName') settings.policyName = row.value ?? '';
    if (row.key === 'githubMirrorUrl') settings.githubMirrorUrl = row.value ?? '';
    if (row.key === 'publicLinksEnabled') settings.publicLinksEnabled = row.value !== 'false';
    if (row.key === 'tokenLinksEnabled') settings.tokenLinksEnabled = row.value !== 'false';
    if (row.key === 'customIconPackUrls') {
      try { settings.customIconPackUrls = JSON.parse(row.value || '[]') as string[]; } catch { settings.customIconPackUrls = []; }
    }
    if (row.key === 'customIconPackNames') {
      try { settings.customIconPackNames = JSON.parse(row.value || '{}') as Record<string, string>; } catch { settings.customIconPackNames = {}; }
    }
  }
  return settings;
}

export async function saveSettings(env: Env, input: Partial<RuleSettings>) {
  const current = await getSettings(env);
  const next: RuleSettings = {
    baseUrl: input.baseUrl ?? current.baseUrl,
    policyName: input.policyName ?? current.policyName,
    githubMirrorUrl: input.githubMirrorUrl === undefined ? current.githubMirrorUrl : normalizeGithubMirrorUrl(input.githubMirrorUrl),
    publicLinksEnabled: input.publicLinksEnabled ?? current.publicLinksEnabled,
    tokenLinksEnabled: input.tokenLinksEnabled ?? current.tokenLinksEnabled,
    customIconPackUrls: input.customIconPackUrls ?? current.customIconPackUrls,
    customIconPackNames: input.customIconPackNames ?? current.customIconPackNames,
  };
  await env.DB.batch(
    Object.entries(next).map(([key, value]) =>
      env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, typeof value === 'object' ? JSON.stringify(value) : String(value)),
    ),
  );
  return next;
}

export async function getRulesData(env: Env): Promise<RulesData> {
  const [categoryRows, ruleRows, sourceRows, settings, apiKeyRow] = await Promise.all([
    env.DB.prepare('SELECT * FROM categories ORDER BY sort_order ASC, created_at ASC').all<CategoryRow>(),
    env.DB.prepare('SELECT * FROM rules ORDER BY sort_order ASC, created_at ASC').all<RuleRow>(),
    env.DB.prepare('SELECT * FROM category_sources ORDER BY created_at ASC').all<SourceRow>(),
    getSettings(env),
    env.DB.prepare('SELECT id FROM api_keys LIMIT 1').first<{ id: string }>(),
  ]);

  const rulesByCategory = new Map<string, DomainRule[]>();
  for (const row of ruleRows.results ?? []) {
    const list = rulesByCategory.get(row.category_id) ?? [];
    list.push(ruleFromRow(row));
    rulesByCategory.set(row.category_id, list);
  }

  const sources = (sourceRows.results ?? []).map(sourceFromRow);
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  for (const list of rulesByCategory.values()) for (const rule of list) if (rule.sourceId) {
    const source = sourceById.get(rule.sourceId);
    rule.sourceName = source?.name;
    rule.sourceType = source?.sourceType ?? 'url';
  }
  const categories = (categoryRows.results ?? []).map((row) => categoryFromRow(row, rulesByCategory.get(row.id) ?? [], sources.filter((source) => source.categoryId === row.id)));
  const updatedAt = categories.reduce((latest, category) => (category.updatedAt > latest ? category.updatedAt : latest), '');

  return {
    version: 1,
    settings,
    meta: {
      d1Ready: true,
      adminPasswordConfigured: Boolean(env.ADMIN_PASSWORD),
      ruleTokenConfigured: Boolean(env.RULE_TOKEN),
      sessionSecretConfigured: Boolean(env.SESSION_SECRET),
      apiKeyConfigured: Boolean(apiKeyRow?.id),
    },
    categories,
    updatedAt: updatedAt || now(),
    lastSyncedAt: sources.reduce<string | undefined>((latest, source) => !latest || (source.lastSyncedAt ?? '') > latest ? source.lastSyncedAt : latest, undefined),
  };
}

/**
 * Lightweight payload for the admin UI. Custom rules stay editable, while
 * mirrored upstream rules are capped per category until the user explicitly
 * expands a list or starts a server-side search.
 */
export async function getRulesOverview(env: Env, upstreamPreviewLimit = UPSTREAM_RULE_PREVIEW_LIMIT): Promise<RulesData> {
  const [categoryRows, manualRuleRows, upstreamRuleRows, sourceRows, settings, apiKeyRow, countsByCategory] = await Promise.all([
    env.DB.prepare('SELECT * FROM categories ORDER BY sort_order ASC, created_at ASC').all<CategoryRow>(),
    env.DB.prepare('SELECT * FROM rules WHERE source_id IS NULL ORDER BY sort_order ASC, created_at ASC').all<RuleRow>(),
    env.DB.prepare(`SELECT id, category_id, value, type, display_type, note, enabled, sort_order, created_at, updated_at, source_id
      FROM (
        SELECT r.*, ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY sort_order ASC, created_at ASC) AS preview_row
        FROM rules r WHERE source_id IS NOT NULL
      ) WHERE preview_row <= ? ORDER BY category_id, sort_order ASC, created_at ASC`).bind(upstreamPreviewLimit).all<RuleRow>(),
    env.DB.prepare('SELECT * FROM category_sources ORDER BY created_at ASC').all<SourceRow>(),
    getSettings(env),
    env.DB.prepare('SELECT id FROM api_keys LIMIT 1').first<{ id: string }>(),
    getRuleCounts(env),
  ]);

  const sources = (sourceRows.results ?? []).map(sourceFromRow);
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const rulesByCategory = new Map<string, DomainRule[]>();
  for (const row of [...(manualRuleRows.results ?? []), ...(upstreamRuleRows.results ?? [])]) {
    const rule = ruleFromRow(row);
    const source = rule.sourceId ? sourceById.get(rule.sourceId) : undefined;
    if (source) {
      rule.sourceName = source.name;
      rule.sourceType = source.sourceType ?? 'url';
    }
    const list = rulesByCategory.get(row.category_id) ?? [];
    list.push(rule);
    rulesByCategory.set(row.category_id, list);
  }

  const categories = (categoryRows.results ?? []).map((row) => categoryFromRow(
    row,
    rulesByCategory.get(row.id) ?? [],
    sources.filter((source) => source.categoryId === row.id),
    countsByCategory.get(row.id),
  ));
  const updatedAt = categories.reduce((latest, category) => category.updatedAt > latest ? category.updatedAt : latest, '');
  return {
    version: 1,
    settings,
    meta: {
      d1Ready: true,
      adminPasswordConfigured: Boolean(env.ADMIN_PASSWORD),
      ruleTokenConfigured: Boolean(env.RULE_TOKEN),
      sessionSecretConfigured: Boolean(env.SESSION_SECRET),
      apiKeyConfigured: Boolean(apiKeyRow?.id),
    },
    categories,
    updatedAt: updatedAt || now(),
    lastSyncedAt: sources.reduce<string | undefined>((latest, source) => !latest || (source.lastSyncedAt ?? '') > latest ? source.lastSyncedAt : latest, undefined),
  };
}

export type RuleSourceFilter = 'manual' | 'upstream' | 'url' | 'geo';

export async function listRules(env: Env, options: {
  categoryId?: string;
  query?: string;
  source?: RuleSourceFilter;
  limit?: number;
} = {}) {
  const conditions = ['duplicate_rank = 1'];
  const bindings: unknown[] = [];
  if (options.categoryId) {
    conditions.push('category_id = ?');
    bindings.push(options.categoryId);
  }
  if (options.source === 'manual') conditions.push('source_id IS NULL');
  if (options.source === 'upstream') conditions.push('source_id IS NOT NULL');
  if (options.source === 'url') conditions.push("source_id IS NOT NULL AND source_type = 'url'");
  if (options.source === 'geo') conditions.push("source_id IS NOT NULL AND source_type <> 'url'");
  const query = options.query?.trim();
  if (query) {
    conditions.push(`(LOWER(value) LIKE LOWER(?) OR LOWER(COALESCE(note, '')) LIKE LOWER(?)
      OR LOWER(type) LIKE LOWER(?) OR LOWER(COALESCE(display_type, '')) LIKE LOWER(?)
      OR LOWER(COALESCE(source_name, '')) LIKE LOWER(?) OR LOWER(COALESCE(category_name, '')) LIKE LOWER(?)
      OR LOWER(COALESCE(category_description, '')) LIKE LOWER(?))`);
    const pattern = `%${query}%`;
    bindings.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern);
  }
  const limit = options.limit === undefined ? UPSTREAM_RULE_PREVIEW_LIMIT : Math.max(0, Math.min(options.limit, 100_000));
  const statement = env.DB.prepare(`${deduplicatedRuleCte}
    SELECT id, category_id, value, type, display_type, note, enabled, sort_order, created_at, updated_at,
      source_id, source_name, source_type
    FROM ranked_rules WHERE ${conditions.join(' AND ')}
    ORDER BY category_id, sort_order ASC, created_at ASC${limit ? ' LIMIT ?' : ''}`);
  if (limit) bindings.push(limit);
  const rows = await statement.bind(...bindings).all<RuleRow>();
  return (rows.results ?? []).map(ruleFromRow);
}

export async function getBackupData(env: Env): Promise<RulesBackupData> {
  const data = await getRulesData(env);
  const { meta: _meta, lastSyncedAt: _lastSyncedAt, categories, ...backup } = data;
  return {
    ...backup,
    categories: categories.map((category) => {
      const { lastSyncedAt: _categoryLastSyncedAt, syncIntervalMinutes: _syncIntervalMinutes, sources, rules, ...categoryBackup } = category;
      return {
        ...categoryBackup,
        rules: rules.filter((rule) => !rule.sourceId),
        sources: sources?.map((source): BackupRuleSource => {
          const common = { sourceType: source.sourceType ?? 'url', enabled: source.enabled, syncIntervalMinutes: source.syncIntervalMinutes };
          if (common.sourceType === 'geosite') return { ...common, geositeName: source.geositeName };
          if (common.sourceType === 'geoip') return { ...common, geoipName: source.geoipName };
          return { ...common, url: source.url, userAgent: source.userAgent, ruleOptimization: source.ruleOptimization ?? 'none' };
        }),
      };
    }),
  };
}

type CategoryInput = Partial<RuleCategory> & { sourceUrls?: string[]; geositeNames?: string[]; geoipNames?: string[]; syncIntervalMinutes?: number; userAgent?: string; ruleOptimization?: RuleOptimizationMode };

const DEFAULT_USER_AGENT = 'clash-verge/v2.5.1';

export function normalizeUserAgent(value?: string | null) {
  const normalized = value?.trim() || DEFAULT_USER_AGENT;
  if (normalized.length > 256 || /[\r\n\0]/.test(normalized)) throw new Error('User-Agent 格式不正确');
  return normalized;
}

export async function createCategory(env: Env, input: CategoryInput) {
  const timestamp = now();
  const name = input.name?.trim() ?? '';
  const nameError = validateCategoryName(name);
  if (nameError) throw new Error(nameError);
  const categoryId = id('cat');
  const slug = slugify(input.slug?.trim() || name);
  const sortOrder = input.sortOrder ?? Date.now();
  const hasUpstream = Boolean(input.sourceUrls?.length || input.geositeNames?.length || input.geoipNames?.length);
  const tokenAccess = input.tokenLinksEnabled ?? !hasUpstream;
  const publicAccess = !tokenAccess && (input.publicLinksEnabled ?? hasUpstream);

  await env.DB.prepare(
    'INSERT INTO categories (id, name, slug, icon, description, note, sort_order, enabled, public_links_enabled, token_links_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      categoryId,
      name,
      slug,
      input.icon?.trim() || name.slice(0, 2).toUpperCase(),
      input.description?.trim() || '',
      input.note?.trim() || '',
      sortOrder,
      input.enabled === false ? 0 : 1,
      publicAccess ? 1 : 0,
      tokenAccess ? 1 : 0,
      timestamp,
      timestamp,
    )
    .run();
  if (input.sourceUrls?.length || input.geositeNames?.length || input.geoipNames?.length) await replaceCategorySources(env, categoryId, input.sourceUrls ?? [], input.syncIntervalMinutes ?? 60, input.geositeNames ?? [], input.geoipNames ?? [], input.userAgent, input.ruleOptimization);
  return getRulesOverview(env);
}

export async function updateCategory(env: Env, categoryId: string, input: CategoryInput) {
  const current = await env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(categoryId).first<CategoryRow>();
  if (!current) throw new Error('分类不存在。');
  const name = input.name?.trim() || current.name;
  const nameError = validateCategoryName(name);
  if (nameError) throw new Error(nameError);
  const timestamp = now();
  let tokenAccess = input.tokenLinksEnabled === undefined ? current.token_links_enabled !== 0 : input.tokenLinksEnabled;
  let publicAccess = input.publicLinksEnabled === undefined ? current.public_links_enabled !== 0 : input.publicLinksEnabled;
  if (tokenAccess) publicAccess = false;
  await env.DB.prepare(
    'UPDATE categories SET name = ?, slug = ?, icon = ?, description = ?, note = ?, sort_order = ?, enabled = ?, public_links_enabled = ?, token_links_enabled = ?, updated_at = ? WHERE id = ?',
  )
    .bind(
      name,
      (input.slug?.trim() || name !== current.name) ? slugify(input.slug?.trim() || name) : current.slug,
      input.icon ?? current.icon,
      input.description ?? current.description,
      input.note ?? current.note,
      input.sortOrder ?? current.sort_order ?? 0,
      input.enabled === undefined ? current.enabled ?? 1 : input.enabled ? 1 : 0,
      publicAccess ? 1 : 0,
      tokenAccess ? 1 : 0,
      timestamp,
      categoryId,
    )
    .run();
  if (input.sourceUrls || input.geositeNames || input.geoipNames) {
    const existingSource = await env.DB.prepare('SELECT sync_interval_minutes, user_agent, rule_optimization FROM category_sources WHERE category_id = ? LIMIT 1').bind(categoryId).first<{ sync_interval_minutes: number | null; user_agent: string | null; rule_optimization: RuleOptimizationMode | 'balanced' | null }>();
    const existingOptimization = existingSource?.rule_optimization === 'balanced' ? 'aggressive' : existingSource?.rule_optimization;
    await replaceCategorySources(env, categoryId, input.sourceUrls ?? [], input.syncIntervalMinutes ?? existingSource?.sync_interval_minutes ?? 60, input.geositeNames ?? [], input.geoipNames ?? [], input.userAgent ?? existingSource?.user_agent, input.ruleOptimization ?? existingOptimization ?? 'none');
  }
  return getRulesOverview(env);
}

export async function replaceCategorySources(env: Env, categoryId: string, sourceUrls: string[], syncIntervalMinutes = 60, geositeNames: string[] = [], geoipNames: string[] = [], userAgent?: string | null, ruleOptimization: RuleOptimizationMode = 'none') {
  const normalizedUserAgent = normalizeUserAgent(userAgent);
  const normalizedRuleOptimization: RuleOptimizationMode = ruleOptimization === 'conservative' || ruleOptimization === 'aggressive' ? ruleOptimization : 'none';
  const urls = [...new Set(sourceUrls.map((url) => url.trim()).filter((url) => /^https?:\/\//i.test(url)))];
  const geosites = [...new Set(geositeNames.map((name) => name.trim().toLowerCase()).filter((name) => /^[a-z0-9_!@.-]+$/i.test(name)))];
  const geositeUrls = geosites.map((name) => `https://raw.githubusercontent.com/v2fly/domain-list-community/master/data/${encodeURIComponent(name)}`);
  const geoips = [...new Set(geoipNames.map((name) => name.trim().toLowerCase()).filter((name) => /^[a-z0-9_!-]+$/i.test(name)))];
  const geoipUrls = geoips.map((name) => `https://raw.githubusercontent.com/Loyalsoldier/geoip/release/text/${encodeURIComponent(name)}.txt`);
  const desiredUrls = [...urls, ...geositeUrls, ...geoipUrls];
  const existing = await env.DB.prepare('SELECT * FROM category_sources WHERE category_id = ?').bind(categoryId).all<SourceRow>();
  const existingByUrl = new Map((existing.results ?? []).map((source) => [source.url, source]));
  const removedSourceIds = (existing.results ?? []).filter((source) => !desiredUrls.includes(source.url)).map((source) => source.id);
  const timestamp = now();
  await env.DB.batch([
    ...removedSourceIds.map((sourceId) => env.DB.prepare('DELETE FROM rules WHERE source_id = ?').bind(sourceId)),
    ...urls.filter((url) => !existingByUrl.has(url)).map((url, index) => env.DB.prepare(
      "INSERT INTO category_sources (id, category_id, name, url, enabled, last_status, sync_interval_minutes, user_agent, source_type, rule_optimization, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, 'url', ?, ?, ?)",
    ).bind(id('src'), categoryId, sourceNameFromUrl(url, `来源 ${index + 1}`), url, 'pending', syncIntervalMinutes, normalizedUserAgent, normalizedRuleOptimization, timestamp, timestamp)),
    ...geosites.filter((name) => !existingByUrl.has(`https://raw.githubusercontent.com/v2fly/domain-list-community/master/data/${encodeURIComponent(name)}`)).map((name) => env.DB.prepare(
      "INSERT INTO category_sources (id, category_id, name, url, enabled, last_status, sync_interval_minutes, source_type, geosite_name, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, 'geosite', ?, ?, ?)",
    ).bind(id('src'), categoryId, `GeoSite · ${name}`, `https://raw.githubusercontent.com/v2fly/domain-list-community/master/data/${encodeURIComponent(name)}`, 'pending', syncIntervalMinutes, name, timestamp, timestamp)),
    ...geoips.filter((name) => !existingByUrl.has(`https://raw.githubusercontent.com/Loyalsoldier/geoip/release/text/${encodeURIComponent(name)}.txt`)).map((name) => env.DB.prepare(
      "INSERT INTO category_sources (id, category_id, name, url, enabled, last_status, sync_interval_minutes, source_type, geoip_name, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, 'geoip', ?, ?, ?)",
    ).bind(id('src'), categoryId, `GeoIP · ${name}`, `https://raw.githubusercontent.com/Loyalsoldier/geoip/release/text/${encodeURIComponent(name)}.txt`, 'pending', syncIntervalMinutes, name, timestamp, timestamp)),
    ...desiredUrls.filter((url) => existingByUrl.has(url)).map((url) => env.DB.prepare("UPDATE category_sources SET sync_interval_minutes = ?, user_agent = CASE WHEN source_type = 'url' THEN ? ELSE user_agent END, rule_optimization = CASE WHEN source_type = 'url' THEN ? ELSE 'none' END, updated_at = ? WHERE category_id = ? AND url = ?").bind(syncIntervalMinutes, normalizedUserAgent, normalizedRuleOptimization, timestamp, categoryId, url)),
    env.DB.prepare(desiredUrls.length
      ? `DELETE FROM category_sources WHERE category_id = ? AND url NOT IN (${desiredUrls.map(() => '?').join(',')})`
      : 'DELETE FROM category_sources WHERE category_id = ?').bind(categoryId, ...desiredUrls),
  ]);
}

export async function deleteCategory(env: Env, categoryId: string) {
  await env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(categoryId).run();
  return getRulesOverview(env);
}

export async function addRule(env: Env, categoryId: string, input: { value: string; type?: DomainRule['type']; note?: string }) {
  const category = await env.DB.prepare('SELECT id FROM categories WHERE id = ?').bind(categoryId).first();
  if (!category) throw new Error('分类不存在。');
  const rule = parseRuleInput(input.value, input.type, input.note);
  await insertRule(env, categoryId, rule, Date.now());
  await touchCategory(env, categoryId);
  return getRulesOverview(env);
}

export async function updateRule(env: Env, categoryId: string, ruleId: string, input: Partial<DomainRule>) {
  const current = await env.DB.prepare('SELECT * FROM rules WHERE id = ? AND category_id = ?').bind(ruleId, categoryId).first<RuleRow>();
  if (!current) throw new Error('规则不存在。');
  if (current.source_id) throw new Error('上游规则为只读，请修改来源或等待下次同步。');
  const timestamp = now();
  await env.DB.prepare(
    'UPDATE rules SET value = ?, type = ?, display_type = ?, note = ?, enabled = ?, sort_order = ?, updated_at = ? WHERE id = ? AND category_id = ?',
  )
    .bind(
      input.value ?? current.value,
      input.type ?? current.type,
      input.displayType ?? current.display_type,
      input.note ?? current.note,
      input.enabled === undefined ? current.enabled ?? 1 : input.enabled ? 1 : 0,
      input.sortOrder ?? current.sort_order ?? 0,
      timestamp,
      ruleId,
      categoryId,
    )
    .run();
  await touchCategory(env, categoryId);
  return getRulesOverview(env);
}

export async function deleteRule(env: Env, categoryId: string, ruleId: string) {
  const current = await env.DB.prepare('SELECT source_id FROM rules WHERE id = ? AND category_id = ?').bind(ruleId, categoryId).first<{ source_id: string | null }>();
  if (!current) throw new Error('规则不存在。');
  if (current.source_id) throw new Error('上游规则为只读，不能单独删除。');
  await env.DB.prepare('DELETE FROM rules WHERE id = ? AND category_id = ?').bind(ruleId, categoryId).run();
  await touchCategory(env, categoryId);
  return getRulesOverview(env);
}

export async function batchUpdateRules(env: Env, categoryId: string, ruleIds: string[], action: 'enable' | 'disable' | 'delete') {
  const ids = [...new Set(ruleIds)].filter(Boolean).slice(0, 1000);
  if (!ids.length) throw new Error('请选择至少一条规则。');
  const placeholders = ids.map(() => '?').join(',');
  if (action === 'delete') {
    await env.DB.prepare(`DELETE FROM rules WHERE category_id = ? AND source_id IS NULL AND id IN (${placeholders})`)
      .bind(categoryId, ...ids).run();
  } else {
    await env.DB.prepare(`UPDATE rules SET enabled = ?, updated_at = ? WHERE category_id = ? AND source_id IS NULL AND id IN (${placeholders})`)
      .bind(action === 'enable' ? 1 : 0, now(), categoryId, ...ids).run();
  }
  await touchCategory(env, categoryId);
  return getRulesOverview(env);
}

export async function insertRule(env: Env, categoryId: string, rule: DomainRule, sortOrder = 0, sourceId?: string) {
  await env.DB.prepare(
    'INSERT OR IGNORE INTO rules (id, category_id, value, type, display_type, note, enabled, sort_order, source_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      rule.id,
      categoryId,
      rule.value,
      rule.type,
      rule.displayType ?? '',
      rule.note ?? '',
      rule.enabled ? 1 : 0,
      rule.sortOrder ?? sortOrder,
      sourceId ?? rule.sourceId ?? null,
      rule.createdAt,
      rule.updatedAt,
    )
    .run();
}

export async function importRulesData(env: Env, data: RulesData | RulesBackupData) {
  const timestamp = now();
  await saveSettings(env, data.settings);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM rules'),
    env.DB.prepare('DELETE FROM category_sources'),
    env.DB.prepare('DELETE FROM categories'),
  ]);
  for (const [index, category] of data.categories.entries()) {
    const categoryId = category.id || id('cat');
    await env.DB.prepare(
      'INSERT OR REPLACE INTO categories (id, name, slug, icon, description, note, sort_order, enabled, public_links_enabled, token_links_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        categoryId,
        category.name,
        category.slug || slugify(category.name),
        category.icon ?? category.name.slice(0, 2).toUpperCase(),
        category.description ?? '',
        category.note ?? '',
        category.sortOrder ?? index,
        category.enabled === false ? 0 : 1,
        category.tokenLinksEnabled === false && category.publicLinksEnabled !== false ? 1 : 0,
        category.tokenLinksEnabled === false ? 0 : 1,
        category.createdAt ?? timestamp,
        category.updatedAt ?? timestamp,
      )
      .run();
    for (const [sourceIndex, source] of (category.sources ?? []).entries()) {
      const sourceType = source.sourceType ?? 'url';
      const sourceUrl = source.url || (sourceType === 'geosite' && source.geositeName
        ? `https://raw.githubusercontent.com/v2fly/domain-list-community/master/data/${encodeURIComponent(source.geositeName)}`
        : sourceType === 'geoip' && source.geoipName
          ? `https://raw.githubusercontent.com/Loyalsoldier/geoip/release/text/${encodeURIComponent(source.geoipName)}.txt`
          : '');
      const sourceName = source.name || (sourceType === 'geosite' && source.geositeName
        ? `GeoSite · ${source.geositeName}`
        : sourceType === 'geoip' && source.geoipName
          ? `GeoIP · ${source.geoipName}`
          : sourceNameFromUrl(sourceUrl, `来源 ${sourceIndex + 1}`));
      await env.DB.prepare(
        'INSERT INTO category_sources (id, category_id, name, url, enabled, last_synced_at, last_status, last_count, last_original_count, last_error, sync_interval_minutes, user_agent, source_type, geosite_name, geoip_name, rule_optimization, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        source.id || id('src'), categoryId, sourceName, sourceUrl,
        source.enabled === false ? 0 : 1, source.lastSyncedAt ?? null, source.lastStatus ?? 'pending',
        source.lastCount ?? 0, source.lastOriginalCount ?? source.lastCount ?? 0, source.lastError ?? null, source.syncIntervalMinutes ?? category.syncIntervalMinutes ?? 60,
        normalizeUserAgent(source.userAgent), sourceType, source.geositeName ?? null, source.geoipName ?? null, sourceType === 'url' ? source.ruleOptimization ?? 'none' : 'none', category.createdAt ?? timestamp, category.updatedAt ?? timestamp,
      ).run();
    }
    for (const [ruleIndex, rule] of category.rules.entries()) {
      await insertRule(env, categoryId, { ...rule, id: rule.id || id('rule') }, rule.sortOrder ?? ruleIndex);
    }
  }
  return getRulesOverview(env);
}

async function touchCategory(env: Env, categoryId: string) {
  await env.DB.prepare('UPDATE categories SET updated_at = ? WHERE id = ?').bind(now(), categoryId).run();
}

type BundleRow = {
  id: string;
  name: string;
  slug: string;
  format: string;
  kind: string | null;
  category_ids: string;
  public_links_enabled: number | null;
  token_links_enabled: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

const BUNDLE_FORMATS: BundleFormat[] = ['yaml', 'list', 'txt', 'json'];

function parseCategoryIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map((item) => String(item ?? '').trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

function normalizeBundleFormat(value?: string | null): BundleFormat {
  const format = (value ?? 'yaml').toLowerCase() as BundleFormat;
  return BUNDLE_FORMATS.includes(format) ? format : 'yaml';
}

function normalizeBundleKind(value?: string | null): BundleKind {
  return value === 'profile' ? 'profile' : 'rules';
}

/** 名称去重：默认规则 → 默认规则1 … 默认规则9 → 默认规则10 … */
export async function allocateUniqueBundleName(env: Env, preferred?: string) {
  const base = preferred?.trim() || '默认规则';
  const rows = await env.DB.prepare('SELECT name FROM subscription_bundles').all<{ name: string }>();
  const existing = new Set((rows.results ?? []).map((row) => row.name));
  if (!existing.has(base)) return base;
  let n = 1;
  while (existing.has(`${base}${n}`)) n += 1;
  return `${base}${n}`;
}

async function allocateUniqueBundleSlug(env: Env, preferred: string, excludeId?: string) {
  const root = slugify(preferred) || 'bundle';
  let candidate = root;
  let n = 1;
  for (;;) {
    const row = await env.DB.prepare('SELECT id FROM subscription_bundles WHERE slug = ?').bind(candidate).first<{ id: string }>();
    if (!row || row.id === excludeId) return candidate;
    n += 1;
    candidate = `${root}-${n}`;
  }
}

async function enrichBundle(env: Env, row: BundleRow): Promise<SubscriptionBundle> {
  const categoryIds = parseCategoryIds(row.category_ids);
  let categoryNames: string[] = [];
  let lastSyncedAt: string | undefined;
  if (categoryIds.length) {
    const placeholders = categoryIds.map(() => '?').join(',');
    const nameRows = await env.DB.prepare(`SELECT id, name FROM categories WHERE id IN (${placeholders})`).bind(...categoryIds).all<{ id: string; name: string }>();
    const nameMap = new Map((nameRows.results ?? []).map((item) => [item.id, item.name]));
    categoryNames = categoryIds.map((id) => nameMap.get(id) ?? id);
    const syncRow = await env.DB.prepare(
      `SELECT MAX(last_synced_at) AS last_synced_at FROM category_sources WHERE category_id IN (${placeholders}) AND last_status = 'success'`,
    ).bind(...categoryIds).first<{ last_synced_at: string | null }>();
    lastSyncedAt = syncRow?.last_synced_at ?? undefined;
  }
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    kind: normalizeBundleKind(row.kind),
    format: normalizeBundleFormat(row.format),
    categoryIds,
    categoryNames,
    publicLinksEnabled: row.public_links_enabled === 1,
    tokenLinksEnabled: row.token_links_enabled !== 0,
    note: row.note ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSyncedAt,
  };
}

export async function listSubscriptionBundles(env: Env): Promise<SubscriptionBundle[]> {
  const rows = await env.DB.prepare('SELECT * FROM subscription_bundles ORDER BY updated_at DESC').all<BundleRow>();
  return Promise.all((rows.results ?? []).map((row) => enrichBundle(env, row)));
}

export async function getSubscriptionBundleBySlug(env: Env, slug: string): Promise<SubscriptionBundle | null> {
  const row = await env.DB.prepare('SELECT * FROM subscription_bundles WHERE slug = ?').bind(slug).first<BundleRow>();
  return row ? enrichBundle(env, row) : null;
}

export async function getSubscriptionBundle(env: Env, bundleId: string): Promise<SubscriptionBundle | null> {
  const row = await env.DB.prepare('SELECT * FROM subscription_bundles WHERE id = ?').bind(bundleId).first<BundleRow>();
  return row ? enrichBundle(env, row) : null;
}

export type BundleInput = {
  name?: string;
  kind?: BundleKind | string;
  categoryIds?: string[];
  format?: BundleFormat | string;
  tokenLinksEnabled?: boolean;
  publicLinksEnabled?: boolean;
  note?: string;
};

export async function createSubscriptionBundle(env: Env, input: BundleInput) {
  const categoryIds = [...new Set((input.categoryIds ?? []).map((item) => item.trim()).filter(Boolean))];
  if (!categoryIds.length) throw new Error('请至少选择一个规则分类。');
  for (const categoryId of categoryIds) {
    const exists = await env.DB.prepare('SELECT id FROM categories WHERE id = ?').bind(categoryId).first();
    if (!exists) throw new Error('所选分类不存在或已被删除。');
  }
  const name = await allocateUniqueBundleName(env, input.name);
  const slug = await allocateUniqueBundleSlug(env, name);
  const kind = normalizeBundleKind(input.kind);
  const format = kind === 'profile' ? 'yaml' : normalizeBundleFormat(input.format);
  const tokenAccess = input.tokenLinksEnabled !== false;
  const publicAccess = !tokenAccess && input.publicLinksEnabled === true;
  const timestamp = now();
  const bundleId = id('bun');
  await env.DB.prepare(
    `INSERT INTO subscription_bundles (id, name, slug, format, kind, category_ids, public_links_enabled, token_links_enabled, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    bundleId,
    name,
    slug,
    format,
    kind,
    JSON.stringify(categoryIds),
    publicAccess ? 1 : 0,
    tokenAccess ? 1 : 0,
    input.note?.trim() || '',
    timestamp,
    timestamp,
  ).run();
  return getSubscriptionBundle(env, bundleId);
}

export async function updateSubscriptionBundle(env: Env, bundleId: string, input: BundleInput) {
  const existing = await env.DB.prepare('SELECT * FROM subscription_bundles WHERE id = ?').bind(bundleId).first<BundleRow>();
  if (!existing) throw new Error('订阅不存在。');
  let name = existing.name;
  if (input.name !== undefined) {
    const preferred = input.name.trim() || '默认规则';
    if (preferred !== existing.name) name = await allocateUniqueBundleName(env, preferred);
  }
  let categoryIds = parseCategoryIds(existing.category_ids);
  if (input.categoryIds) {
    categoryIds = [...new Set(input.categoryIds.map((item) => item.trim()).filter(Boolean))];
    if (!categoryIds.length) throw new Error('请至少选择一个规则分类。');
    for (const categoryId of categoryIds) {
      const exists = await env.DB.prepare('SELECT id FROM categories WHERE id = ?').bind(categoryId).first();
      if (!exists) throw new Error('所选分类不存在或已被删除。');
    }
  }
  const kind = input.kind !== undefined ? normalizeBundleKind(input.kind) : normalizeBundleKind(existing.kind);
  const format = kind === 'profile' ? 'yaml' : (input.format !== undefined ? normalizeBundleFormat(input.format) : normalizeBundleFormat(existing.format));
  let tokenAccess = existing.token_links_enabled !== 0;
  let publicAccess = existing.public_links_enabled === 1;
  if (input.tokenLinksEnabled !== undefined || input.publicLinksEnabled !== undefined) {
    tokenAccess = input.tokenLinksEnabled !== false;
    publicAccess = !tokenAccess && input.publicLinksEnabled === true;
  }
  const note = input.note !== undefined ? input.note.trim() : (existing.note ?? '');
  const slug = name !== existing.name ? await allocateUniqueBundleSlug(env, name, bundleId) : existing.slug;
  const timestamp = now();
  await env.DB.prepare(
    `UPDATE subscription_bundles SET name = ?, slug = ?, format = ?, kind = ?, category_ids = ?, public_links_enabled = ?, token_links_enabled = ?, note = ?, updated_at = ? WHERE id = ?`,
  ).bind(name, slug, format, kind, JSON.stringify(categoryIds), publicAccess ? 1 : 0, tokenAccess ? 1 : 0, note, timestamp, bundleId).run();
  return getSubscriptionBundle(env, bundleId);
}

export async function deleteSubscriptionBundle(env: Env, bundleId: string) {
  await env.DB.prepare('DELETE FROM subscription_bundles WHERE id = ?').bind(bundleId).run();
}

/** 按打包订阅合并多个分类的启用规则（跨分类去重） */
export async function buildMergedCategoryForBundle(env: Env, bundle: SubscriptionBundle): Promise<RuleCategory | null> {
  if (!bundle.categoryIds.length) return null;
  const placeholders = bundle.categoryIds.map(() => '?').join(',');
  const categoryRows = await env.DB.prepare(
    `SELECT * FROM categories WHERE id IN (${placeholders}) AND enabled = 1`,
  ).bind(...bundle.categoryIds).all<CategoryRow>();
  const categories = categoryRows.results ?? [];
  if (!categories.length) return null;
  const rules = await listRules(env, { limit: 100_000 });
  const allowed = new Set(bundle.categoryIds);
  const seen = new Set<string>();
  const mergedRules: DomainRule[] = [];
  for (const rule of rules) {
    if (!rule.categoryId || !allowed.has(rule.categoryId) || !rule.enabled) continue;
    const key = `${rule.type}:${rule.value}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    mergedRules.push(rule);
  }
  const latest = categories.reduce((max, row) => (row.updated_at > max ? row.updated_at : max), categories[0].updated_at);
  return {
    id: bundle.id,
    name: bundle.name,
    slug: bundle.slug,
    description: bundle.categoryNames?.join(' · ') || '',
    note: bundle.note,
    enabled: true,
    rules: mergedRules,
    updatedAt: latest,
    publicLinksEnabled: bundle.publicLinksEnabled,
    tokenLinksEnabled: bundle.tokenLinksEnabled,
  };
}
