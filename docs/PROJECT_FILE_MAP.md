# Cloudflare Rules — 项目文件职责地图

> 生成自二改前勘察。路径相对于仓库根目录 `clone/Private-rules-main/`（本地目录名；项目产品名为 Cloudflare Rules）。  
> 目标：Cloudflare Workers + D1 私有规则控制台（本轮改造后**仅保留 Cloudflare**，见文末「改造删除清单」）。

---

## 1. 项目定位

Cloudflare Rules 是自托管规则控制台：聚合自定义规则、远程订阅、GeoSite、GeoIP，去重后按客户端格式输出 YAML / LIST / TXT / JSON 订阅。

**本轮目标运行时（改造后）**

| 能力 | Cloudflare Workers |
| --- | --- |
| 入口 | `src/worker.ts` |
| 数据库 | D1（binding: `DB`） |
| 静态资源 | Workers Assets（`ASSETS`） |
| 定时同步 | Cron Trigger `*/5 * * * *` |
| 配置 | `wrangler.toml` + Secrets |

**历史双运行时（改造前，Node/Docker 已计划删除）**：Node + SQLite + Docker Compose。

---

## 2. 主协作链路

```
浏览器 /admin
  → React (src/frontend)
  → fetch /api/* （session cookie 或 Bearer API Key）
  → Hono createApp() (src/server/app.ts)
  → lib/auth · lib/db · lib/sync · lib/formatters · lib/links
  → DatabasePort → D1 adapter
  → 订阅：GET /rules/:file | GET /sub/:token/:file
```

| 场景 | 关键文件 |
| --- | --- |
| 登录 | `frontend/pages/LoginPage.tsx` → `/api/auth/login` → `lib/auth.ts` |
| 后台数据 | `hooks/use-domain-admin.ts` → `/api/categories` 等 → `lib/db.ts` |
| 上游同步 | `lib/sync.ts` + `lib/geosite.ts` + `lib/github-mirror.ts`；cron 在 `worker.ts` |
| 订阅输出 | `lib/formatters/index.ts` + `lib/links.ts` + `app.ts` 订阅路由 |
| 规则解析 | `lib/parser.ts` + `lib/rule-types.ts` |

---

## 3. 根目录配置

| 文件 | 职责 |
| --- | --- |
| `README.md` | 功能说明、部署、本地开发 |
| `package.json` | 脚本、依赖、版本 |
| `pnpm-lock.yaml` | 依赖锁定 |
| `pnpm-workspace.yaml` | workspace / native 构建允许列表 |
| `tsconfig.json` | TS 严格配置、路径别名 |
| `vite.config.ts` | Vite + React + `@cloudflare/vite-plugin` |
| `vitest.config.ts` | Vitest（node 环境） |
| `playwright.config.ts` | E2E（改造前用 Node start；改造后改 wrangler dev） |
| `wrangler.toml` | Worker 名、main、assets、cron、D1 |
| `index.html` | 前端 HTML 入口 |
| `Dockerfile` | ~~Node 镜像~~（删除） |
| `docker-compose.yml` | ~~Compose 部署~~（删除） |
| `.env.example` | ~~Docker 环境变量~~（删除） |
| `.dev.vars.example` | 本地 Cloudflare Secrets 模板 |
| `.gitignore` / `.dockerignore` | 忽略规则 |
| `LICENSE` | MIT |

---

## 4. scripts /

| 文件 | 职责 |
| --- | --- |
| `prepare-cloudflare-deploy.mjs` | build 后给 Vite 插件生成的 `dist/*/wrangler.json` 补 `keep_vars=true`。**不得硬编码错误目录名** |

---

## 5. src/application/ports/

| 文件 | 职责 |
| --- | --- |
| `assets.ts` | 静态资源 `fetch` 接口 |
| `database.ts` | `prepare` / `batch` / `ping` 数据库端口 |

---

## 6. src/infrastructure/

| 文件 | 职责 |
| --- | --- |
| `database/d1/adapter.ts` | D1 → DatabasePort |
| `database/sqlite/*` | ~~SQLite~~（删除） |
| `assets/node.ts` | ~~Node 静态文件~~（删除） |
| `scheduler/node.ts` | ~~Node 定时器~~（删除） |
| `config/types.ts` | AppConfig / BASE_URL 规范化 |
| `config/cloudflare.ts` | CF bindings → AppConfig |
| `config/node.ts` | ~~Node env 解析~~（删除） |

---

## 7. 入口与 HTTP

| 文件 | 职责 |
| --- | --- |
| `src/worker.ts` | CF `fetch` + `scheduled`；组装 Env；`ensureDatabase`；`syncRuleSources` |
| `src/runtimes/node.ts` | ~~Node 服务入口~~（删除） |
| `src/server/app.ts` | **全部** HTTP 路由：鉴权、API、订阅、后台 SPA、健康检查 |
| `src/types.ts` | `Env`、`AppVariables` |
| `src/types/domain-rules.ts` | 规则/分类/来源/设置/备份领域类型 |
| `src/version.ts` | `APP_VERSION` ← package.json |

---

## 8. src/lib/ 业务核心

| 文件 | 职责 |
| --- | --- |
| `auth.ts` | 密码登录、session HMAC cookie、API Key、RULE_TOKEN、安全文件名 |
| `db.ts` | 建表兜底、CRUD、设置、备份恢复、来源、去重查询、overview 1000 预览 |
| `parser.ts` | 单条/批量规则解析与校验 |
| `rule-types.ts` | 类型枚举与中文展示 |
| `formatters/index.ts` | yaml/list/txt/json/qx 等格式化与 `resolveFile` |
| `links.ts` | 各客户端订阅 URL |
| `sync.ts` | 上游同步、间隔、精简写库 |
| `geosite.ts` | GeoSite/GeoIP 索引搜索与加载 |
| `github-mirror.ts` | GitHub URL 镜像改写 |
| `rule-compactor.ts` | 上游规则保守/激进精简 |
| `response.ts` | json / error / textFile |
| `slug.ts` | slug、分类名校验、随机 id |

---

## 9. 前端 src/frontend/

| 文件 | 职责 |
| --- | --- |
| `main.tsx` | React 入口、路由 login vs admin |
| `pages/LoginPage.tsx` | 登录页 |
| `hooks/use-domain-admin.ts` | API 客户端与全局状态 |
| `components/domain-admin.tsx` | 后台壳：导航/主题/同步/退出 |
| `components/dashboard-panel.tsx` | 概览 |
| `components/rules-panel.tsx` | 规则库（最复杂） |
| `components/links-panel.tsx` | 订阅中心 |
| `components/settings-panel.tsx` | 设置/备份/API Key |
| `components/about-panel.tsx` | 关于 |
| `components/category-icon.tsx` | 分类图标 |
| `components/icon-picker.tsx` | 图标包选择 |
| `components/sort-toolbar.tsx` | 分类排序 |
| `components/ui-icon.tsx` | SVG 图标 |
| `components/link-sheet.tsx` | 备用客户端订阅弹层（当前可能未被引用） |
| `lib/clipboard.ts` | 剪贴板 |
| `lib/links.ts` | HTTPS 优先 |
| `i18n.tsx` | 简中/繁中/英文 DOM 翻译 |
| `styles/app.css` | CSS 入口 |
| `styles/globals.css` | 变量与基础样式 |
| `styles/admin.css` | 早期后台布局 |
| `styles/admin-interactions.css` | 交互/弹层 |
| `styles/admin-extras.css` | API Key、规则管理等增强 |
| `styles/neko-ui.css` | 主视觉系统（大量页面样式） |
| `assets/cloudflare-rules-avatar.png` | 品牌图 |

---

## 10. migrations/

| 文件 | 职责 |
| --- | --- |
| `0001_init.sql` | categories / rules / settings / sessions |
| `0002_sources_and_access.sql` | 访问开关、source_id、category_sources |
| `0003_geosite_sources.sql` | source_type、geosite_name |
| `0004_geoip_sources.sql` | geoip_name、图标包名 |
| `0005_api_keys.sql` | api_keys |
| `0006_runtime_baseline.sql` | settings 默认值、GeoIP URL 修正 |
| `0007_source_user_agent.sql` | user_agent |
| `0008_source_rule_optimization.sql` | 精简模式与 last_original_count |
| `0009_rule_optimization_levels.sql` | balanced → aggressive |
| `0010_github_mirror_setting.sql` | githubMirrorUrl |

正式 schema：`wrangler d1 migrations apply DB`。运行时 `ensureDatabase` 为冷启动兜底。

---

## 11. tests/

| 文件 | 职责 |
| --- | --- |
| `unit/config.test.ts` | 配置解析（改造后对齐 CF/保留项） |
| `unit/github-mirror.test.ts` | 镜像改写 |
| `unit/i18n.test.ts` | UI 翻译 |
| `unit/rules.test.ts` | 解析、格式化、精简、链接 |
| `unit/scheduler.test.ts` | ~~NodeScheduler~~ → 改造为 `isSourceDue` 等 |
| `unit/version.test.ts` | 版本号（去 Docker 断言） |
| `contract/database.test.ts` | DB 契约（改造后仅 D1） |
| `integration/api.test.ts` | HTTP API / 订阅策略 |
| `integration/app.test.ts` | health / 未知 API 404 |
| `integration/cross-runtime.test.ts` | ~~D1 vs SQLite~~（删除） |
| `e2e/auth.spec.ts` | 登录 E2E |

---

## 12. CI / docs

| 文件 | 职责 |
| --- | --- |
| `.github/workflows/ci.yml` | lint/test/build/wrangler dry-run |
| `.github/workflows/docker-publish.yml` | ~~Docker Hub~~（删除） |
| `docs/wiki/Docker-Compose-Deployment.md` | ~~Docker 教程~~（删除） |
| `docs/dockerhub/README.md` | ~~Hub 文案~~（删除） |
| `docs/PROJECT_FILE_MAP.md` | 本文件 |
| `docs/DEPLOY.md` | 部署清单、踩坑记录、迁移修复命令 |

---

## 13. 问题排查入口

完整部署踩坑与修复命令见 **[DEPLOY.md](./DEPLOY.md)**。

| 问题类型 | 优先检查 |
| --- | --- |
| 登录 / 401 /「尚未配置登录密钥」 | `lib/auth.ts`：需 **ADMIN_PASSWORD + SESSION_SECRET**；Dashboard Secrets；改完后重新部署；`/api/auth/me` |
| 页面白屏 | `frontend/main.tsx`、Assets、`app.ts` 静态回退 |
| API 错误 | `use-domain-admin.ts`、`server/app.ts`、`lib/db.ts` |
| 规则解析 | `parser.ts`、`rule-types.ts` |
| 同步失败 | `sync.ts`、`geosite.ts`、`github-mirror.ts`、category_sources |
| 订阅 404 | `app.ts` 订阅路由、访问策略、`RULE_TOKEN` |
| 格式不对 | `formatters/index.ts`、`links.ts` |
| D1 未连接 | Bindings 是否有 **`DB`**；`d1Ready` |
| D1 迁移失败 / 重复列 | `migrations/`、`d1_migrations` 表（不是 `_migrations`）；见 DEPLOY.md §7 |
| **部署 `ERR_PNPM_NOTHING_TO_DEPLOY`** | Deploy 须 **`pnpm run deploy`**，禁止裸 `pnpm deploy` |
| **CF 构建 ENOENT** | `prepare-cloudflare-deploy.mjs` 路径 vs 实际 `dist/*/wrangler.json` |
| **名称非法** | Worker 名仅 `a-z0-9-`，禁止 `_` |

---

## 14. Cloudflare 命名与产物（构建踩坑）

| 项 | 正确做法 |
| --- | --- |
| Worker `name` | `cloudflare-rules`（连字符 OK） |
| 非法名 | `cloudflare_rules`（下划线） |
| Vite 插件产物目录 | 本仓库固定为 `dist/worker/`（`viteEnvironment.name = worker`）；默认映射会变成非法的 `cloudflare_rules` |
| 客户端静态 | `dist/client/` |
| prepare 脚本 | 扫描 `dist/*/wrangler.json`，勿写死下划线目录 |
| Build / Deploy | Build=`pnpm build`；Deploy=`pnpm run deploy` 或 `npx wrangler deploy --keep-vars` |
| D1 binding | 必须为 **`DB`**；`database_name` 可与 Dashboard 显示名一致（如 `cloudflare-rules-d`） |

---

## 15. Cloudflare-only 改造删除清单

删除：`src/runtimes/node.ts`、`infrastructure/database/sqlite/**`、`infrastructure/assets/node.ts`、`infrastructure/scheduler/node.ts`、`infrastructure/config/node.ts`、`Dockerfile`、`docker-compose.yml`、`.env.example`、Docker 文档与 `docker-publish` workflow；依赖中去掉 `better-sqlite3`、`@hono/node-server` 等。

保留：Worker、Hono app、`src/lib/*`、D1 adapter、前端、migrations、`wrangler.toml`。

产品名已统一为 **Cloudflare Rules** / 包名 **`cloudflare-rules`**（原 Private Rules 二改）。
