# Cloudflare Rules

**操作简单、维护方便的私有自托管规则控制台（Cloudflare Workers）**

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-16858A.svg)](./LICENSE)

---

## 这是什么

Cloudflare Rules 是私有自托管规则控制台，**仅支持 Cloudflare Workers + D1** 部署。它把自定义规则、远程订阅、GeoSite 与 GeoIP 数据源集中到同一个后台，自动去重，并按客户端需要生成 YAML、LIST、TXT 与 JSON 订阅。

规则与会话保存在你自己的 Cloudflare D1 数据库中。每条规则可独立选择私密链接、公开链接或禁止访问。

文件职责地图见 [docs/PROJECT_FILE_MAP.md](./docs/PROJECT_FILE_MAP.md)。

## 部署到 Cloudflare

### 1. 命名要求（重要）

Cloudflare Worker / Workers Builds **项目名称**只能包含：

- 小写字母 `a-z`
- 数字 `0-9`
- 连字符 `-`

**不要**使用下划线（例如 `cloudflare_rules` 非法）。本仓库 `wrangler.toml` 中的名称为：

```toml
name = "cloudflare-rules"
```

本仓库在 `vite.config.ts` 中设置 `viteEnvironment: { name: 'worker' }`，构建产物为：

```text
dist/worker/wrangler.json   # Worker 打包 + 部署配置（name 仍为 cloudflare-rules）
dist/client/                # 管理后台静态资源
```

说明：`@cloudflare/vite-plugin` 默认会把 Worker 名里的 `-` 转成 Vite 环境名的 `_`（`cloudflare-rules` → 目录 `cloudflare_rules`）。  
**下划线目录名不是合法 Worker 名称**。若 Dashboard / Builds 项目名填了 `cloudflare_rules` 会直接报错。  
因此我们用环境名 `worker` 与 Worker 名 `cloudflare-rules` 解耦；部署时始终以 `wrangler.toml` / 生成配置里的 `"name": "cloudflare-rules"` 为准。

### 2. Fork 并导入

Fork 本仓库，在 Cloudflare Dashboard：**Workers & Pages → Create application → Import a repository**。

| 构建设置 | 值 |
| --- | --- |
| Production branch | `main` |
| Build command | `pnpm build` |
| Deploy command | `pnpm deploy` |
| Root directory | 留空 |

`wrangler.toml` 声明静态资源、Cron 与 D1 binding `DB`。首次部署后在 **Settings → Bindings** 确认 `DB` 已连接。

首次使用或新增 migration 后：

```bash
pnpm db:migrate:remote
```

Cron 每 5 分钟扫描一次；真正同步间隔仍由每条数据源在数据库中的配置决定。

### 3. 配置密钥

在 **Settings → Variables and Secrets** 中添加：

| Secret | 用途 | 必需 |
| --- | --- | --- |
| `ADMIN_PASSWORD` | 登录管理后台 | 是 |
| `SESSION_SECRET` | 签名登录会话，建议至少 32 个随机字符 | 是 |
| `RULE_TOKEN` | 生成私密订阅地址 | 使用私密访问时 |

部署完成后访问：

```text
https://<your-worker-domain>/admin/login
```

自定义域名后可在后台设置站点基础 URL，或设置 `BASE_URL`。

## 本地开发

需要 Node.js 与 pnpm，以及用于 D1 本地迁移的 Wrangler。

```bash
pnpm install
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars 填写 ADMIN_PASSWORD / SESSION_SECRET / RULE_TOKEN
pnpm db:migrate:local
pnpm dev
```

打开 `http://localhost:5173/admin/login`。

生产构建检查：

```bash
pnpm build
pnpm exec wrangler deploy --dry-run --keep-vars
```

## 使用路径

1. 在“规则”中从零构建、远程订阅或 Geo 数据库
2. 配置图标、同步间隔与自定义规则
3. 同步上游后在预览中检查结果
4. 在“订阅”中设置访问策略并复制链接
5. 在“设置”中备份 / 恢复 JSON

## 订阅格式

| 后缀 | 适用范围 |
| --- | --- |
| `.yaml` | Mihomo、Clash、OpenClash、Stash |
| `.list` | Loon、Surge、Shadowrocket、Egern 等 |
| `.txt` | 纯文本 |
| `.json` | 结构化数据 |

```text
/rules/emby.yaml
/sub/<RULE_TOKEN>/emby.yaml
```

## 安全说明

- 后台接口要求登录会话或 API Key
- Token 订阅仅隐藏路径，不等同于加密
- 不要提交 `.dev.vars`、密码或生产数据

## 技术栈

- Cloudflare Workers、Hono、D1
- React 19、TypeScript、Vite
- Cloudflare Cron Triggers

## 许可证

[MIT](./LICENSE)
