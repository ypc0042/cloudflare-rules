# Cloudflare Rules — 部署说明与踩坑记录

本文记录本项目从「Cloudflare-only 二改」到「成功上线」过程中遇到的真实问题与正确做法。  
配套总览见 [README.md](../README.md)、文件地图见 [PROJECT_FILE_MAP.md](./PROJECT_FILE_MAP.md)。

---

## 推荐上线清单

| 步骤 | 动作 | 完成标准 |
| --- | --- | --- |
| 1 | GitHub 仓库代码为最新 | 含 `pnpm run deploy` 说明、Vite `worker` 环境名 |
| 2 | Workers Builds 项目名 `cloudflare-rules` | 仅 `a-z0-9-` |
| 3 | Build = `pnpm build`，Deploy = `pnpm run deploy` | 构建日志出现 `dist/worker` + Prepared deploy config |
| 4 | D1 建库 + Binding **`DB`** | Settings → Bindings 可见 `DB → D1` |
| 5 | Secrets：`ADMIN_PASSWORD` + `SESSION_SECRET`（+ `RULE_TOKEN`） | `/api/auth/me` 对应字段为 `true` |
| 6 | `pnpm db:migrate:remote` | `No migrations to apply!` 或全部 ✅ |
| 7 | `/admin/login` 可登录 | 设置页数据库「已连接」 |

---

## 踩坑汇总（我们实际遇到的）

### 1. Worker 名称含下划线报错

| | |
| --- | --- |
| **现象** | Dashboard / Builds 提示名称只能包含小写字母、数字和连字符 |
| **原因** | Cloudflare **Worker 名**禁止 `_`。`@cloudflare/vite-plugin` 默认把 `private-rules` / `cloudflare-rules` 转成环境目录 `*_rules`（下划线）。若把该字符串当成 Worker 名会失败。 |
| **正确做法** | `wrangler.toml`：`name = "cloudflare-rules"`；`vite.config.ts`：`viteEnvironment: { name: 'worker' }` → 产物 `dist/worker/`；Dashboard 项目名用连字符。 |
| **相关文件** | `wrangler.toml`、`vite.config.ts`、`scripts/prepare-cloudflare-deploy.mjs` |

### 2. 部署命令写了 `pnpm deploy`

| | |
| --- | --- |
| **现象** | 构建成功，部署失败：`ERR_PNPM_NOTHING_TO_DEPLOY No project was selected for deployment` |
| **原因** | 裸命令 `pnpm deploy` 是 **pnpm 自带 monorepo 发布**，**不会**执行 `package.json` 的 `"deploy"` 脚本，也就不会跑 `wrangler deploy`。 |
| **正确做法** | Deploy command 填 **`pnpm run deploy`** 或 **`npx wrangler deploy --keep-vars`**。 |
| **相关文件** | `package.json` → `"deploy": "wrangler deploy --keep-vars"` |

### 3. 只配了密码，登录提示「服务端尚未配置登录密钥」

| | |
| --- | --- |
| **现象** | `/admin/login` 提交后 503：`服务端尚未配置登录密钥。` |
| **原因** | `authConfigured` 要求 **`ADMIN_PASSWORD` 与 `SESSION_SECRET` 同时存在**（见 `src/lib/auth.ts`）。只配密码不够。Secrets 改完后若未重新部署，线上也可能读不到。 |
| **正确做法** | 两个都加为 **Secret**；改完后重新 Deploy；用 `/api/auth/me` 检查 `passwordConfigured` / `sessionSecretConfigured`。 |
| **相关文件** | `src/lib/auth.ts`、`src/server/app.ts`（login 路由） |

### 4. PowerShell 随机串在 cmd 里报错

| | |
| --- | --- |
| **现象** | `'-join' 不是内部或外部命令` 或「文件名、目录名或卷标语法不正确」 |
| **原因** | 命令是 **PowerShell** 语法，在 **cmd**（提示符 `C:\Users\...>` 且无 `PS`）中无效。 |
| **正确做法** | 打开 Windows PowerShell（提示符 `PS C:\...>`），或：`powershell -NoProfile -Command "..."`。 |

### 5. D1 库名 `cloudflare-rules-db`「不可用」

| | |
| --- | --- |
| **现象** | 创建 D1 时某名字灰掉 / 不可用，稍短名字（如 `cloudflare-rules-d`）可以 |
| **原因** | 多为**账号内名称已占用**（历史建库、半截失败残留），不是 `-db` 后缀非法。 |
| **正确做法** | 换名即可（如 `cloudflare-rules-d`）；Worker 代码只认 Binding 名 **`DB`**，不认库显示名。把 `wrangler.toml` 的 `database_name` 改成与 Dashboard 一致更方便本机 wrangler。 |

### 6. 不会绑定 D1

| | |
| --- | --- |
| **正确路径** | Worker → **Settings → Bindings → Add → D1** → Variable name = **`DB`** → 选择数据库 |
| **注意** | Binding 必须是 `DB`（与 `wrangler.toml` / 代码 `env.DB` 一致）。 |

### 7. 迁移：`duplicate column name: public_links_enabled`

| | |
| --- | --- |
| **现象** | `0001` ✅ 后，`0002` 失败：`duplicate column name: public_links_enabled`；`migrations list` 仍显示 0002–0010 待应用 |
| **原因** | 库结构已部分/全部存在（列已加过），但 **`d1_migrations` 只记了 0001**。再次执行 `ALTER TABLE ... ADD COLUMN` 必炸。表名是 **`d1_migrations`**，不是 `_migrations`。 |
| **正确做法（结构已齐时）** | 核对 `PRAGMA table_info` / 表列表后，将剩余迁移名插入 `d1_migrations`，避免重复执行：见下方「修复命令」。 |
| **正确做法（全新空库）** | `pnpm db:migrate:remote` 一次跑完 0001–0010 即可。 |

#### 查看迁移状态

```bash
npx wrangler d1 execute DB --remote --command="SELECT * FROM d1_migrations ORDER BY id;"
npx wrangler d1 migrations list DB --remote
```

#### 结构已完整、仅记录缺失时（示例）

确认表/列已齐全后：

```bash
npx wrangler d1 execute DB --remote --command="INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0002_sources_and_access.sql'), ('0003_geosite_sources.sql'), ('0004_geoip_sources.sql'), ('0005_api_keys.sql'), ('0006_runtime_baseline.sql'), ('0007_source_user_agent.sql'), ('0008_source_rule_optimization.sql'), ('0009_rule_optimization_levels.sql'), ('0010_github_mirror_setting.sql');"
npx wrangler d1 migrations list DB --remote
# 期望：No migrations to apply!
```

**空库请勿**只插记录不执行 SQL，否则缺表。

### 8. better-sqlite3 / Docker 安装失败（历史）

原仓库含 Node + SQLite + Docker 路径时，Cloudflare Builds 会编译 `better-sqlite3` 失败。  
本仓库已 **Cloudflare-only**，依赖仅 `hono` + Workers 相关 devDependencies，构建日志应约 **133 packages**，无 native sqlite 编译。

---

## 自检接口

```text
GET /api/auth/me
```

| 字段 | 含义 |
| --- | --- |
| `passwordConfigured` | 是否读到 `ADMIN_PASSWORD` |
| `sessionSecretConfigured` | 是否读到 `SESSION_SECRET` |
| `ruleTokenConfigured` | 是否读到 `RULE_TOKEN` |
| `d1Ready` | 是否存在 Binding `DB` |
| `authenticated` | 当前是否已登录 |

---

## 常用命令

```bash
# 登录 Cloudflare
npx wrangler login

# 远程迁移
pnpm db:migrate:remote

# 远程执行 SQL
npx wrangler d1 execute DB --remote --command="SELECT name FROM sqlite_master WHERE type='table';"

# 本地构建 + 干跑部署
pnpm build
pnpm exec wrangler deploy --dry-run --keep-vars
```

---

## 相关源码索引

| 主题 | 位置 |
| --- | --- |
| Worker 名 / D1 | `wrangler.toml` |
| Vite 环境名 | `vite.config.ts` |
| 构建后修正 wrangler.json | `scripts/prepare-cloudflare-deploy.mjs` |
| 登录与密钥校验 | `src/lib/auth.ts`、`src/server/app.ts` |
| 迁移 SQL | `migrations/*.sql` |
| 配置解析 | `src/infrastructure/config/cloudflare.ts` |
