import { D1DatabaseAdapter } from './infrastructure/database/d1/adapter';
import { createApp } from './server/app';
import { ensureDatabase } from './lib/db';
import { syncRuleSources } from './lib/sync';
import type { Env } from './types';
import { APP_VERSION } from './version';

type CloudflareBindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_PASSWORD?: string;
  RULE_TOKEN?: string;
  SESSION_SECRET?: string;
};

function dependencies(bindings: CloudflareBindings): Env {
  return {
    DB: new D1DatabaseAdapter(bindings.DB),
    ASSETS: { fetch: (request) => bindings.ASSETS.fetch(request) },
    ADMIN_PASSWORD: bindings.ADMIN_PASSWORD,
    RULE_TOKEN: bindings.RULE_TOKEN,
    SESSION_SECRET: bindings.SESSION_SECRET,
    RUNTIME: 'cloudflare',
    APP_VERSION,
    TRUST_PROXY: false,
  };
}

const app = createApp();

export default {
  async fetch(request: Request, bindings: CloudflareBindings, context: ExecutionContext) {
    const env = dependencies(bindings);
    await ensureDatabase(env);
    return app.fetch(request, env, context);
  },
  scheduled(_controller: ScheduledController, bindings: CloudflareBindings, context: ExecutionContext) {
    const env = dependencies(bindings);
    context.waitUntil(ensureDatabase(env).then(() => syncRuleSources(env, undefined, false)).then(() => undefined));
  },
};
