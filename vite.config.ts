import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Worker 对外名称在 wrangler.toml: name = "cloudflare-rules"（仅 a-z 0-9 -）
// Vite 插件默认把连字符转成下划线得到环境名；环境名只用于 dist/ 目录。
// 因此显式指定合法 JS 标识符环境名 "worker"，输出到 dist/worker/，与 Worker 名解耦。
export default defineConfig({
  plugins: [
    react(),
    cloudflare({
      configPath: './wrangler.toml',
      viteEnvironment: { name: 'worker' },
    }),
  ],
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  server: {
    cors: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
