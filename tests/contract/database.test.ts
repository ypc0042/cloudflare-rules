import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { D1DatabaseAdapter } from '../../src/infrastructure/database/d1/adapter';
import { addRule, createCategory, deleteCategory, getBackupData, getRulesData, getRulesOverview, importRulesData, insertRule, listRules, saveSettings, updateCategory } from '../../src/lib/db';
import { syncRuleSources } from '../../src/lib/sync';
import type { Env } from '../../src/types';
import type { DatabasePort } from '../../src/application/ports/database';

const migrations = resolve(process.cwd(), 'migrations');

async function setupD1(): Promise<{ database: DatabasePort; close: () => Promise<void> }> {
  const miniflare = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok") } }', d1Databases: ['DB'] });
  const binding = await miniflare.getD1Database('DB');
  for (const file of (await readdir(migrations)).filter((value) => /^\d+.*\.sql$/.test(value)).sort()) {
    const sql = await readFile(join(migrations, file), 'utf8');
    for (const statement of sql.split(';').map((value) => value.trim()).filter(Boolean)) await binding.prepare(statement).run();
  }
  return { database: new D1DatabaseAdapter(binding), close: async () => miniflare.dispose() };
}

describe('d1 database contract', () => {
  let env: Env;
  let database: DatabasePort;
  let close: () => Promise<void> = async () => {};

  beforeAll(async () => {
    const ready = await setupD1();
    database = ready.database;
    env = { DB: ready.database, ASSETS: { fetch: async () => new Response() }, ADMIN_PASSWORD: 'pw', SESSION_SECRET: '0123456789abcdef0123456789abcdef', RULE_TOKEN: 'token', RUNTIME: 'cloudflare' };
    close = ready.close;
  });
  afterAll(async () => close());

  it('supports CRUD, uniqueness, access fields, backup and restore', async () => {
    let data = await createCategory(env, { name: 'd1-rules', tokenLinksEnabled: true, publicLinksEnabled: false });
    const category = data.categories[0];
    data = await addRule(env, category.id, { value: 'example.com' });
    expect(data.categories[0].rules[0].value).toBe('example.com');
    data = await updateCategory(env, category.id, { tokenLinksEnabled: false, publicLinksEnabled: true });
    expect(data.categories[0]).toMatchObject({ tokenLinksEnabled: false, publicLinksEnabled: true });
    await expect(createCategory(env, { name: 'd1-rules' })).rejects.toThrow();
    const backup = await getRulesData(env);
    await deleteCategory(env, category.id);
    expect((await getRulesData(env)).categories).toHaveLength(0);
    const restored = await importRulesData(env, backup);
    expect(restored.categories[0].rules[0].value).toBe('example.com');
    expect(restored.meta?.ruleTokenConfigured).toBe(true);
  });

  it('keeps custom rules and source configuration in compact backups', async () => {
    let data = await createCategory(env, { name: 'd1-compact-backup', sourceUrls: ['https://example.com/rules.list'], geositeNames: ['telegram'], geoipNames: ['telegram'], syncIntervalMinutes: 360, userAgent: 'Clash', ruleOptimization: 'conservative' });
    const category = data.categories.find((item) => item.name === 'd1-compact-backup')!;
    data = await addRule(env, category.id, { value: 'custom.example' });
    const source = data.categories.find((item) => item.id === category.id)!.sources!.find((item) => item.sourceType === 'url')!;
    const timestamp = new Date().toISOString();
    await insertRule(env, category.id, { id: 'd1-mirrored-rule', categoryId: category.id, value: 'upstream.example', type: 'DOMAIN-SUFFIX', enabled: true, sourceId: source.id, createdAt: timestamp, updatedAt: timestamp }, 1, source.id);

    const full = await getRulesData(env);
    const backup = await getBackupData(env);
    const backedUpCategory = backup.categories.find((item) => item.id === category.id)!;
    expect(backedUpCategory.rules.map((rule) => rule.value)).toEqual(['custom.example']);
    expect(JSON.stringify(backup).length).toBeLessThan(JSON.stringify(full).length);
  });

  it('keeps the admin overview to 1000 mirrored rules and loads larger sets on demand', { timeout: 120_000 }, async () => {
    const data = await createCategory(env, { name: 'd1-large-preview', sourceUrls: ['https://example.com/large.list'] });
    const category = data.categories.find((item) => item.name === 'd1-large-preview')!;
    const source = category.sources![0];
    const timestamp = new Date().toISOString();
    const insertSql = 'INSERT INTO rules (id, category_id, value, type, display_type, note, enabled, sort_order, source_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    const statements = Array.from({ length: 1005 }, (_, index) => env.DB.prepare(insertSql).bind(
      `d1-large-${index}`, category.id, `speed-${index}.example`, 'DOMAIN-SUFFIX', '', '', 1, index, source.id, timestamp, timestamp,
    ));
    for (let offset = 0; offset < statements.length; offset += 100) await env.DB.batch(statements.slice(offset, offset + 100));

    const overviewCategory = (await getRulesOverview(env)).categories.find((item) => item.id === category.id)!;
    expect(overviewCategory.ruleCount).toBe(1005);
    expect(overviewCategory.rules).toHaveLength(1000);
    expect(await listRules(env, { categoryId: category.id, source: 'upstream' })).toHaveLength(1000);
    expect(await listRules(env, { query: 'speed', limit: 0 })).toHaveLength(1005);
  });

  it('persists and applies the GitHub rewrite setting during sync', async () => {
    await saveSettings(env, { githubMirrorUrl: 'https://fastly.jsdelivr.net/' });
    expect((await getRulesData(env)).settings.githubMirrorUrl).toBe('https://fastly.jsdelivr.net');
    const rawUrl = 'https://raw.githubusercontent.com/ddgksf2013/Filter/refs/heads/master/AppleIntelligence.list';
    const data = await createCategory(env, { name: 'd1-github-mirror', sourceUrls: [rawUrl] });
    const category = data.categories.find((item) => item.name === 'd1-github-mirror')!;
    const originalFetch = globalThis.fetch;
    let requestedUrl = '';
    globalThis.fetch = async (input) => {
      requestedUrl = String(input);
      return new Response('DOMAIN-SUFFIX,example.com', { status: 200 });
    };
    try {
      await expect(syncRuleSources(env, category.id)).resolves.toEqual([expect.objectContaining({ ok: true, count: 1 })]);
    } finally {
      globalThis.fetch = originalFetch;
      await saveSettings(env, { githubMirrorUrl: '' });
    }
    expect(requestedUrl).toBe('https://fastly.jsdelivr.net/gh/ddgksf2013/Filter@master/AppleIntelligence.list');
  });
});
