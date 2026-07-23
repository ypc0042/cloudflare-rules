import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { D1DatabaseAdapter } from '../../src/infrastructure/database/d1/adapter';
import { addRule, createCategory } from '../../src/lib/db';
import { createApp } from '../../src/server/app';
import type { Env } from '../../src/types';

describe('HTTP API behavior', () => {
  let miniflare: Miniflare;
  let env: Env;
  let cookie = '';
  const app = createApp();
  const migrations = resolve(process.cwd(), 'migrations');

  beforeAll(async () => {
    miniflare = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok") } }', d1Databases: ['DB'] });
    const binding = await miniflare.getD1Database('DB');
    for (const file of (await readdir(migrations)).filter((value) => /^\d+.*\.sql$/.test(value)).sort()) {
      const sql = await readFile(join(migrations, file), 'utf8');
      for (const statement of sql.split(';').map((value) => value.trim()).filter(Boolean)) await binding.prepare(statement).run();
    }
    env = {
      DB: new D1DatabaseAdapter(binding),
      ASSETS: { fetch: async () => new Response('<html>admin</html>', { headers: { 'content-type': 'text/html' } }) },
      ADMIN_PASSWORD: 'correct-password',
      SESSION_SECRET: '0123456789abcdef0123456789abcdef',
      RULE_TOKEN: 'private-token',
      RUNTIME: 'cloudflare',
    };
    let data = await createCategory(env, { name: 'public-rule', tokenLinksEnabled: false, publicLinksEnabled: true });
    await addRule(env, data.categories[0].id, { value: 'public.example' });
    data = await createCategory(env, { name: 'private-rule', tokenLinksEnabled: true, publicLinksEnabled: false });
    await addRule(env, data.categories.find((item) => item.name === 'private-rule')!.id, { value: 'private.example' });
    data = await createCategory(env, { name: 'disabled-rule', tokenLinksEnabled: false, publicLinksEnabled: false });
    await addRule(env, data.categories.find((item) => item.name === 'disabled-rule')!.id, { value: 'disabled.example' });
  });

  afterAll(async () => { await miniflare.dispose(); });

  const request = (path: string, init: RequestInit = {}) => app.request(path, { ...init, headers: { ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) } }, env);

  it('handles failed login, session login, authenticated API, and logout', async () => {
    expect((await request('/api/categories')).status).toBe(401);
    expect((await request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'wrong' }) })).status).toBe(401);
    const login = await request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-password' }) });
    expect(login.status).toBe(200);
    cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
    expect(cookie).toContain('cloudflare_rules_session=');
    expect((await request('/api/categories')).status).toBe(200);
    expect((await request('/admin')).status).toBe(200);
    expect((await request('/api/auth/logout', { method: 'POST' })).status).toBe(200);
    cookie = '';
    expect((await request('/api/categories')).status).toBe(401);
  });

  it('preserves public, token, disabled, missing, and four-format subscription behavior', async () => {
    for (const extension of ['yaml', 'list', 'txt', 'json']) {
      const response = await request(`/rules/public-rule.${extension}`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('public.example');
    }
    expect((await request('/rules/private-rule.yaml')).status).toBe(404);
    expect((await request('/sub/wrong/private-rule.yaml')).status).toBe(404);
    expect((await request('/sub/private-token/private-rule.yaml')).status).toBe(200);
    expect((await request('/rules/disabled-rule.yaml')).status).toBe(404);
    expect((await request('/sub/private-token/disabled-rule.yaml')).status).toBe(404);
    expect((await request('/rules/missing.yaml')).status).toBe(404);
  });
});
