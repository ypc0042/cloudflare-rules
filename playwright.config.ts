import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: 'http://127.0.0.1:8787', locale: 'zh-CN', trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm build && pnpm exec wrangler dev --local --port 8787 --ip 127.0.0.1',
    url: 'http://127.0.0.1:8787/health',
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      ...process.env,
    },
  },
});
