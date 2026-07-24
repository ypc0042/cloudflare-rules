/**
 * 安全执行 D1 迁移：避免 ensureDatabase 已建好列/表后，
 * wrangler 再跑 ALTER 报 duplicate column 把整批迁移卡住。
 *
 * 用法：
 *   node scripts/d1-migrate-safe.mjs --remote
 *   node scripts/d1-migrate-safe.mjs --local
 */
import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const remote = process.argv.includes('--remote');
const locationFlag = remote ? '--remote' : '--local';

function run(args, { allowFail = false } = {}) {
  // Windows 上用一条 shell 命令，避免 npx/wrangler 参数被拆坏
  const quoted = args.map((arg) => (/\s/.test(arg) || /["']/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg));
  const command = `npx wrangler ${quoted.join(' ')}`;
  const result = spawnSync(command, {
    cwd: projectRoot,
    encoding: 'utf8',
    shell: true,
    env: process.env,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const combined = `${stdout}\n${stderr}`;
  if (result.status !== 0 && !allowFail) {
    const error = new Error(combined.trim() || `wrangler ${args.join(' ')} failed`);
    throw error;
  }
  return { status: result.status ?? 1, stdout, stderr, combined };
}

function executeSql(sql) {
  return run(['d1', 'execute', 'DB', locationFlag, '--command', sql], { allowFail: true });
}

function parseJsonPayload(text) {
  // wrangler 会在 JSON 前后打印 banner；取第一个以 [ 开头的完整 JSON 值
  const start = text.indexOf('[');
  if (start < 0) return null;
  const slice = text.slice(start);
  // 尝试从长到短找可解析的数组
  for (let end = slice.length; end > 1; end -= 1) {
    if (slice[end - 1] !== ']') continue;
    try {
      return JSON.parse(slice.slice(0, end));
    } catch {
      /* continue */
    }
  }
  return null;
}

function columnNames(pragmaResult) {
  const payload = parseJsonPayload(pragmaResult.combined);
  const rows = payload?.[0]?.results ?? [];
  return new Set(rows.map((row) => row.name));
}

function tableNames(listResult) {
  const payload = parseJsonPayload(listResult.combined);
  if (!payload) {
    console.warn('Warning: could not parse table list JSON from wrangler output.');
    return new Set();
  }
  const rows = payload?.[0]?.results ?? [];
  return new Set(rows.map((row) => row.name));
}

function migrationNames(listResult) {
  const payload = parseJsonPayload(listResult.combined);
  const rows = payload?.[0]?.results ?? [];
  return new Set(rows.map((row) => row.name));
}

/** 根据当前库结构判断某条迁移是否“已经等价完成” */
function migrationSatisfied(name, tables, categoryCols, ruleCols, sourceCols) {
  switch (name) {
    case '0001_init.sql':
      return tables.has('categories') && tables.has('rules') && tables.has('settings') && tables.has('sessions');
    case '0002_sources_and_access.sql':
      return categoryCols.has('public_links_enabled')
        && categoryCols.has('token_links_enabled')
        && ruleCols.has('source_id')
        && tables.has('category_sources');
    case '0003_geosite_sources.sql':
      return sourceCols.has('source_type') && sourceCols.has('geosite_name');
    case '0004_geoip_sources.sql':
      return sourceCols.has('geoip_name');
    case '0005_api_keys.sql':
      return tables.has('api_keys');
    case '0006_runtime_baseline.sql':
    case '0009_rule_optimization_levels.sql':
    case '0010_github_mirror_setting.sql':
      return tables.has('settings') && tables.has('category_sources');
    case '0007_source_user_agent.sql':
      return sourceCols.has('user_agent');
    case '0008_source_rule_optimization.sql':
      return sourceCols.has('rule_optimization') && sourceCols.has('last_original_count');
    case '0011_subscription_bundles.sql':
      return tables.has('subscription_bundles');
    default:
      return false;
  }
}

function isBenignMigrationError(text) {
  return /duplicate column name/i.test(text)
    || /duplicate column/i.test(text)
    || /already exists/i.test(text)
    || /duplicate key/i.test(text);
}

async function main() {
  const migrationsDir = path.join(projectRoot, 'migrations');
  const files = (await readdir(migrationsDir))
    .filter((name) => /^\d+.*\.sql$/i.test(name))
    .sort();

  console.log(`D1 safe migrate (${remote ? 'remote' : 'local'})`);
  console.log(`Found ${files.length} migration file(s).`);

  const tablesRes = executeSql("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;");
  if (tablesRes.status !== 0) {
    console.error(tablesRes.combined);
    process.exit(tablesRes.status ?? 1);
  }
  const tables = tableNames(tablesRes);
  console.log(`Detected tables: ${[...tables].filter((name) => !name.startsWith('_') && name !== 'sqlite_sequence').join(', ') || '(none)'}`);

  // 真·空库（连 categories 都没有）才直接 apply
  if (!tables.has('categories')) {
    console.log('No categories table → wrangler d1 migrations apply (fresh DB)');
    const apply = run(['d1', 'migrations', 'apply', 'DB', locationFlag], { allowFail: true });
    process.stdout.write(apply.combined);
    process.exit(apply.status === 0 ? 0 : apply.status);
  }

  const categoryCols = columnNames(executeSql('PRAGMA table_info(categories);'));
  const ruleCols = tables.has('rules') ? columnNames(executeSql('PRAGMA table_info(rules);')) : new Set();
  const sourceCols = tables.has('category_sources') ? columnNames(executeSql('PRAGMA table_info(category_sources);')) : new Set();

  if (!tables.has('d1_migrations')) {
    console.log('d1_migrations missing → bootstrap via wrangler apply');
    run(['d1', 'migrations', 'apply', 'DB', locationFlag], { allowFail: true });
  }

  const applied = migrationNames(executeSql('SELECT name FROM d1_migrations;'));
  console.log(`Already recorded in d1_migrations: ${applied.size}`);

  const toMark = files.filter((name) => !applied.has(name) && migrationSatisfied(name, tables, categoryCols, ruleCols, sourceCols));
  if (toMark.length) {
    console.log(`Marking ${toMark.length} already-satisfied migration(s):`);
    for (const name of toMark) {
      console.log(`  · ${name}`);
      const mark = executeSql(`INSERT OR IGNORE INTO d1_migrations (name) VALUES ('${name.replace(/'/g, "''")}');`);
      if (mark.status !== 0) {
        console.error(mark.combined);
        process.exit(mark.status ?? 1);
      }
    }
  } else {
    console.log('No satisfied-but-untracked migrations to mark.');
  }

  console.log('Running wrangler d1 migrations apply …');
  let apply = run(['d1', 'migrations', 'apply', 'DB', locationFlag], { allowFail: true });
  process.stdout.write(apply.combined);

  if (apply.status !== 0 && isBenignMigrationError(apply.combined)) {
    console.log('Detected benign schema conflict; re-syncing tracker and retrying once …');
    const tables2 = tableNames(executeSql("SELECT name FROM sqlite_master WHERE type='table';"));
    const categoryCols2 = tables2.has('categories') ? columnNames(executeSql('PRAGMA table_info(categories);')) : new Set();
    const ruleCols2 = tables2.has('rules') ? columnNames(executeSql('PRAGMA table_info(rules);')) : new Set();
    const sourceCols2 = tables2.has('category_sources') ? columnNames(executeSql('PRAGMA table_info(category_sources);')) : new Set();
    const applied2 = migrationNames(executeSql('SELECT name FROM d1_migrations;'));
    for (const name of files) {
      if (applied2.has(name)) continue;
      if (!migrationSatisfied(name, tables2, categoryCols2, ruleCols2, sourceCols2)) continue;
      console.log(`  · mark ${name}`);
      executeSql(`INSERT OR IGNORE INTO d1_migrations (name) VALUES ('${name.replace(/'/g, "''")}');`);
    }
    apply = run(['d1', 'migrations', 'apply', 'DB', locationFlag], { allowFail: true });
    process.stdout.write(apply.combined);
  }

  if (apply.status !== 0) {
    console.error('\nMigration still failed. See docs/DEPLOY.md');
    process.exit(apply.status ?? 1);
  }

  console.log('\n✅ D1 migrations are up to date.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
