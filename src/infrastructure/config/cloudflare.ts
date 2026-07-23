import { normalizeBaseUrl, type AppConfig } from './types';
export type CloudflareConfigBindings = { ADMIN_PASSWORD?: string; SESSION_SECRET?: string; RULE_TOKEN?: string; BASE_URL?: string };
export function parseCloudflareConfig(bindings: CloudflareConfigBindings): AppConfig {
  return {
    adminPassword: bindings.ADMIN_PASSWORD?.trim() ?? '', sessionSecret: bindings.SESSION_SECRET?.trim() ?? '', ruleToken: bindings.RULE_TOKEN?.trim() ?? '',
    baseUrl: normalizeBaseUrl(bindings.BASE_URL), databasePath: '', host: '', port: 0, nodeEnv: 'production',
    scheduler: { enabled: true, intervalSeconds: 300 }, trustProxy: false, logLevel: 'info',
  };
}
