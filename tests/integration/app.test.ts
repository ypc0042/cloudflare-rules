import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app';
import type { Env } from '../../src/types';

describe('shared Hono application', () => {
  it('reports runtime and database health without leaking configuration', async () => {
    const env = { DB: { ping: async () => true }, RUNTIME: 'cloudflare', APP_VERSION: '1.0.0' } as Env;
    const response = await createApp().request('/health', {}, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, database: 'ok', runtime: 'cloudflare', version: '1.0.0' });
  });
  it('does not let the SPA fallback cover unknown API routes', async () => {
    const env = { DB: { ping: async () => true }, ASSETS: { fetch: async () => new Response('<html>spa</html>') } } as Env;
    const response = await createApp().request('/api/missing', {}, env);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('<html>');
  });
});
