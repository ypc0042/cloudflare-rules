# Cloudflare Rules

**操作简单、维护方便的私有自托管规则控制台（仅 Cloudflare Workers + D1）**

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-16858A.svg)](./LICENSE)

---

## 这是什么

Cloudflare Rules 把自定义规则、远程订阅、GeoSite / GeoIP 数据源集中在同一个后台，自动去重，并按客户端需要导出订阅。

| 能力 | 说明 |
| --- | --- |
| **规则集** | 单条规则直接复制；也可合并多条规则为一个规则文件（YAML / LIST / TXT / JSON） |
| **订阅集** | 完整 Clash / Mihomo **配置模板**（策略组 + 分流 + 预留机场订阅位；内置 DIRECT / REJECT） |
| **数据** | 保存在你自己的 **Cloudflare D1** |
| **访问** | 每条规则 / 打包项可设：私密链接 / 公开链接 / 禁止访问 |
| **图标** | 内置多套 [Qure](https://github.com/Koolson/Qure) 分包；支持自定义图标包；规则名可自动匹配图标 |

- **不支持** Docker / 自建 Node（本仓库为 Cloudflare-only）

相关文档：

| 文档 | 内容 |
| --- | --- |
| [docs/DEPLOY.md](./docs/DEPLOY.md) | 部署踩坑与排错 |
| [docs/PROJECT_FILE_MAP.md](./docs/PROJECT_FILE_MAP.md) | 文件职责 |
| [docs/SUBSCRIPTION_PLAN.md](./docs/SUBSCRIPTION_PLAN.md) | 规则集 / 订阅集设计说明 |

---


> **项目来源**  
> 本项目由 [Cyclince/Private_rules](https://github.com/Cyclince/Private-rules) **二改**而来。  
> 在原作者工作基础上，调整为 **仅 Cloudflare Workers + D1**，并增加规则集/订阅集、部署与同步等方面的改动。  
> 感谢原作者的开源贡献。

---

## 部署前准备

1. **GitHub** 账号（放代码）  
2. **Cloudflare** 账号（免费即可）  
3. （仅本地开发需要）Node.js 20+ 与 pnpm  
4. 约 15～30 分钟，按顺序做完下面清单  

> **命名铁律**  
> Worker / 项目名只能：`a-z`、`0-9`、连字符 `-`，**禁止下划线 `_`**。  
> 本项目默认：`cloudflare-rules`。

---

## 上线清单（做完才算真正上线）

| 顺序 | 你要做的事 | 怎样算成功 |
| --- | --- | --- |
| ① | 代码在 GitHub | 有 `package.json`、`wrangler.toml` |
| ② | Cloudflare 用 Git 构建部署 | 有 `workers.dev` 域名 |
| ③ | 创建 D1 | D1 列表能看到库 |
| ④ | 绑定 D1，**Variable name 必须是 `DB`** | Settings → Bindings 有 `DB` |
| ⑤ | Secrets：`ADMIN_PASSWORD` + `SESSION_SECRET`（建议加 `RULE_TOKEN`） | `/api/auth/me` 对应字段为 `true` |
| ⑥ | 打开一次 `/admin/login` 并登录 | 能进后台；设置里数据库「已连接」 |

> **不需要在本机执行 `pnpm db:migrate:remote`。**  
> 表结构由 Worker 内 `ensureDatabase` 在**第一次请求**时自动创建/补齐（含规则、订阅集、失败退避等全部列）。  
> 本机迁移脚本仅留给开发者维护 `migrations/` 账本时使用，**Fork 上线可完全忽略。**

---

## 第一步：代码放到 GitHub

项目根目录应包含：

```text
package.json
wrangler.toml
vite.config.ts
src/
migrations/
```

推送到你的仓库（示例名 `cloudflare-rules`）。不要提交 `.dev.vars`、真实密码。

---

## 第二步：Cloudflare 用 Git 部署

**Workers & Pages → 导入仓库**，建议填写：

| 设置 | 值 |
| --- | --- |
| 项目 / Worker 名 | `cloudflare-rules`（**不要** `cloudflare_rules`） |
| 生产分支 | `main` |
| **Build command** | `pnpm build` |
| **Deploy command** | **`pnpm run deploy`**（必须带 `run`） |
| Root directory | 留空 |

### 大坑：`pnpm deploy` ≠ 本项目脚本

裸写 `pnpm deploy` 会触发 pnpm 自带 monorepo 发布，报：

`ERR_PNPM_NOTHING_TO_DEPLOY`

请写：

```text
pnpm run deploy
```

或：

```text
npx wrangler deploy --keep-vars
```

构建成功后应看到 `dist/worker/`、`dist/client/`，以及 `Prepared Cloudflare deploy config ... name=cloudflare-rules`。

访问域名示例：

```text
https://cloudflare-rules.<你的子域>.workers.dev
```

此时可能还不能登录——先做 D1 与 Secrets。

---

## 第三步：创建 D1

Dashboard → **D1** → Create database。

- 名称示例：`cloudflare-rules-d`（若某名「不可用」，多半是账号内重名，**换名即可**）  
- 绑定只认 Variable 名 **`DB`**，不认库显示名必须和 Worker 同名  

---

## 第四步：绑定 D1（必须）

Worker **`cloudflare-rules` → Settings → Bindings → Add → D1**：

| 字段 | 值 |
| --- | --- |
| Variable name | **`DB`**（全大写） |
| D1 database | 你刚建的库 |

保存；如需则重新部署一次。

`wrangler.toml` 中对应：

```toml
[[d1_databases]]
binding = "DB"
database_name = "cloudflare-rules-d"
# database_id = "从 Dashboard 复制"   # 本机 wrangler 时建议填
```

---

## 第五步：配置 Secrets

**Settings → Variables and Secrets**，类型选 **Secret**：

| 名称 | 必需 | 作用 |
| --- | --- | --- |
| `ADMIN_PASSWORD` | **是** | 后台登录密码 |
| `SESSION_SECRET` | **是** | 会话签名；**只配密码不够** |
| `RULE_TOKEN` | 强烈建议 | 私密订阅路径 |
| `BASE_URL` | 可选 | 自定义域名后的站点前缀 |

登录逻辑：`ADMIN_PASSWORD` 与 `SESSION_SECRET` **同时存在** 才允许登录，否则提示「服务端尚未配置登录密钥」。

### 生成随机串（Windows）

- 用 **PowerShell**（提示符带 `PS`），不要用 cmd 跑 `-join`：

```powershell
-join ((48..57 + 65..90 + 97..122) | Get-Random -Count 40 | ForEach-Object { [char]$_ })
```

- 或在 cmd：

```bat
powershell -NoProfile -Command "[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')"
```

改完 Secrets 后请 **重新部署** 一次。

### 自检

```text
https://你的域名/api/auth/me
```

期望字段为 `true`：`passwordConfigured`、`sessionSecretConfigured`、`d1Ready`（以及建议 `ruleTokenConfigured`）。

---

## 第六步：数据库（自动建表，无需本机操作）

**Fork / 首次上线不需要在电脑上跑任何迁移命令。**

只要已经：

1. 创建 D1 并绑定为 **`DB`**
2. 配置好 Secrets 并完成部署

然后用浏览器打开：

```text
https://你的域名/admin
```

或登录页 `/admin/login`。

Worker 会执行 **`ensureDatabase`**：

- 自动 `CREATE TABLE IF NOT EXISTS …`
- 自动补齐后续版本新增的列（幂等，可重复执行）
- 尽量同步官方 `d1_migrations` 记录，避免以后有人再跑 wrangler 时撞 `duplicate column`

打开后台能进、**设置 → 服务状态**里数据库为「已连接」，即表示表已就绪。

### 开发者可选：本机迁移脚本

仅当你在改 `migrations/*.sql`、或排查「结构与 wrangler 账本不一致」时才需要：

```bash
pnpm db:migrate:remote   # 安全脚本，推荐
pnpm db:migrate:local    # 本地 D1
```

普通使用者、Fork 部署：**跳过本节即可。**


## 第七步：登录与日常使用

```text
https://你的域名/admin/login
```

用 `ADMIN_PASSWORD` 登录。

### 建议顺序

1. **设置 → 服务状态**：数据库 / 密钥应为已配置  
2. **规则**：建分类；手写规则或挂远程 / GeoSite / GeoIP 源；输入名称可**自动匹配** Qure 等图标包中的图标（可手动更换）  
3. **订阅**（见下）  
4. **设置**：备份 / 恢复 JSON  

### 订阅中心：规则集 vs 订阅集

| | **规则集** | **订阅集** |
| --- | --- | --- |
| 是什么 | 只有规则（payload / list…） | **完整 Clash 配置模板** |
| 单条规则 | 列表自动出现，**无需新建**即可复制 | — |
| 合并 | 可「新建合并规则集」多选分类 | 「新建订阅集」时多选分类 |
| 节点 | 无 | **不强制**；模板内预留 `proxy-providers.url` 自填 |
| 内置 | — | **DIRECT** / **REJECT**；地区组靠 filter 吃你之后导入的节点 |
| 策略组 | — | 手动/自动/地区 + 按所选规则分组（带 emoji 前缀） |

链接形态示例：

```text
# 单条 / 合并规则集
/rules/分类slug.yaml
/sub/<RULE_TOKEN>/分类slug.yaml
/sub/<RULE_TOKEN>/bundle-xxx.yaml

# 订阅集（完整模板）
/sub/<RULE_TOKEN>/profile-xxx.yaml
/rules/profile-xxx.yaml
```

| 规则集后缀 | 常见客户端 |
| --- | --- |
| `.yaml` | Mihomo、Clash、OpenClash、Stash（rule-provider） |
| `.list` | Loon、Surge、Shadowrocket 等 |
| `.txt` | 纯文本 |
| `.json` | 结构化数据 |


### 订阅集地区分组说明

- 地区组**只根据节点名称**匹配（不看真实前置/落地机房 IP）。
- 使用 **优先级 + filter + exclude-filter**：一个节点只进入**一个**地区组（推荐 Mihomo / Clash Meta / Verge）。
- 名称带 `kr` 等韩国关键词时优先进韩国（例如 `voll-kr-id12345`），避免被香港中转命名抢走。
- 支持 `nb-jp02-panda`、`dmit-us-id4262` 这类「地区码+数字/编号」命名。
- 配置校验报 `port ... NaN` 时，多半是**机场节点**解析问题（不是规则模板端口）；可换机场源、关有问题的节点，或在客户端用「代理更新订阅」。
- 含 **马来西亚、新加坡** 等地区，并出现在各分流策略可选列表中。
- **无法识别地区**的节点进入 **🌐 其他地区**。
- 手动选择 / 自动选择仍为 include-all，便于手选任意节点。
- **漏网之鱼** 可选：手动、自动、全部地区组、其他地区、DIRECT/REJECT。
- **漏网之鱼** 可选：手动、自动、全部地区组、其他地区、DIRECT/REJECT。
- 自动选择测速与参考完整模板一致：`https://cp.cloudflare.com/generate_204`（interval 300 / tolerance 50）。
- DNS 含 `proxy-server-nameserver`（直连解析节点域名），减轻 dmit 等美线测速 timeout 误报；`ipv6: false`。
- 自动选择使用 `lazy` + `timeout: 5000` + `expected-status: 204`（Mihomo）；客户端批量测延迟仍可在设置里加大超时。

### 上游同步（自动）

- Cron 约每 5 分钟扫描；是否真正拉取看各源的同步间隔  
- **成功**：写入 D1，作为本地规则缓存  
- **失败**：**不删除**已有规则，继续用上次成功内容  
- 失败后 **至少 1 小时** 才再自动重试；连续失败 **3 次** 则 **当天** 暂停自动拉，**次日** 重置  
- 后台 **手动同步** 可随时立刻重试  

---

## （可选）自定义域名

1. Worker → Custom Domains 绑定域名  
2. 用 `https://你的域名/admin/login` 访问  
3. Secrets 或后台设置填写 `BASE_URL`  

---

## 本地开发

```bash
pnpm install
cp .dev.vars.example .dev.vars
# 填写 ADMIN_PASSWORD / SESSION_SECRET / RULE_TOKEN
pnpm db:migrate:local
pnpm dev
```

打开：`http://localhost:5173/admin/login`

```bash
pnpm build
pnpm exec wrangler deploy --dry-run --keep-vars
```

---

## 踩坑速查

完整说明见 **[docs/DEPLOY.md](./docs/DEPLOY.md)**。

| # | 问题 | 结论 |
| --- | --- | --- |
| 1 | 名称含下划线报错 | 用 `cloudflare-rules`；Vite 环境名 `worker` |
| 2 | `ERR_PNPM_NOTHING_TO_DEPLOY` | Deploy 写 **`pnpm run deploy`** |
| 3 | 尚未配置登录密钥 | 需要 `ADMIN_PASSWORD` **和** `SESSION_SECRET`，改完重部署 |
| 4 | `-join` 不是命令 | 在 **PowerShell** 里生成随机串 |
| 5 | D1 名不可用 | 多半重名，换名；绑定仍是 `DB` |
| 6 | 不会绑库 | Bindings → D1 → **`DB`** |
| 7 | 迁移 duplicate column（仅开发者跑 wrangler 时） | 用 **`pnpm db:migrate:remote`**；日常靠 ensureDatabase 即可 |
| 8 | 订阅集 `proxy ["xxx"] not found` | 更新到最新代码；`RULE-SET` 第三段不要带错误引号 |
| 9 | 旧 better-sqlite3 / Docker | 本仓库已 Cloudflare-only |

---

## 安全说明

- 后台接口需登录会话或 API Key  
- Token 订阅仅为路径保密，不是端到端加密  
- 勿提交 `.dev.vars`、密码、生产备份  
- 更换 `SESSION_SECRET` / `RULE_TOKEN` 会使旧登录与旧私密链接失效  

---

## 技术栈

- Cloudflare Workers、Hono、D1  
- React 19、TypeScript、Vite  
- Cron：约每 5 分钟扫描；同步间隔与失败退避见上文  

## 致谢

- 原项目：[Cyclince/Private_rules](https://github.com/Cyclince/Private-rules)（本仓库二改基础）
- 规则图标：[Koolson/Qure](https://github.com/Koolson/Qure) 等图标包

## 许可证

[MIT](./LICENSE)
