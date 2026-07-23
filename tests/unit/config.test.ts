import { describe, expect, it } from 'vitest';
import { parseCloudflareConfig } from '../../src/infrastructure/config/cloudflare';
import { normalizeBaseUrl } from '../../src/infrastructure/config/types';

describe('cloudflare configuration', () => {
  it('parses bindings and normalizes BASE_URL', () => {
    const config = parseCloudflareConfig({
      ADMIN_PASSWORD: 'password',
      SESSION_SECRET: '0123456789abcdef0123456789abcdef',
      RULE_TOKEN: 'token',
      BASE_URL: 'https://example.com///',
    });
    expect(config.adminPassword).toBe('password');
    expect(config.ruleToken).toBe('token');
    expect(config.baseUrl).toBe('https://example.com');
    expect(config.trustProxy).toBe(false);
    expect(config.scheduler.intervalSeconds).toBe(300);
  });

  it('normalizes empty base URL', () => {
    expect(normalizeBaseUrl(undefined)).toBe('');
    expect(normalizeBaseUrl('https://rules.example.com/path/')).toBe('https://rules.example.com/path');
  });
});
