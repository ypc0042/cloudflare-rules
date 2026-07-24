# Cloudflare Rules

**操作简单、维护方便的私有自托管规则控制台（仅 Cloudflare Workers + D1）**

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-16858A.svg)](./LICENSE)

---

## 这是什么

Cloudflare Rules 把自定义规则、远程订阅、GeoSite / GeoIP 数据源集中在同一个后台，自动去重，并按客户端需要导出 **YAML / LIST / TXT / JSON** 订阅。

- 数据存在你自己的 **Cloudflare D1** 里
- 每条规则可单独设：私密链接 / 公开链接 / 禁止访问
- **不支持** Docker / 自建 Node 服务（本仓库已改成 Cloudflare-only）

相关文档：

| 文档 | 内容 |
| --- | --- |
| [docs/DEPLOY.md](./docs/DEPLOY.md) | 我们踩过的坑 + 排错清单 |
| [docs/PROJECT_FILE_MAP.md](./docs/PROJECT_FILE_MAP.md) | 每个文件干什么 |

---

## 部署前你需要准备什么

1. 一个 **GitHub** 账号（用来放代码）
2. 一个 **Cloudflare** 账号（免费即可）
3. 本机安装 **Node.js**（建议 20+）和 **pnpm**（用于「数据库迁移」这一步）
4. 大约 20～40 分钟，按下面步骤 **从上到下** 做，不要跳步

> **命名铁律（先记住）**  
> Cloudflare 项目名 / Worker 名只能：`a-z`、`0-9`、连字符 `-`  
> **不能有下划线 `_`**。本项目默认名：`cloudflare-rules`（连字符）。

---

## 总览：做完这些才算真正上线

| 顺序 | 你要做的事 | 怎样算成功 |
| --- | --- | --- |
| ① | 代码推到 GitHub | 仓库里有 `package.json`、`wrangler.toml` |
| ② | Cloudflare 用 Git 导入并构建部署 | 部署日志成功，有 `workers.dev` 域名 |
| ③ | 创建 D1 数据库 | D1 列表里能看到库 |
| ④ | 把 D1 **绑定**到 Worker，名字必须是 `DB` | Settings → Bindings 有 `DB` |
| ⑤ | 配置 Secrets（密码 + 会话密钥等） | `/api/auth/me` 里相关字段为 `true` |
| ⑥ | 本机跑数据库迁移 | 提示 `No migrations to apply!` 或全部成功 |
| ⑦ | 打开后台登录 | 能进管理界面 |

下面按小白步骤写详细操作。

---

## 第一步：把代码放到 GitHub

### 1.1 确认推送的是「项目根目录」

应包含这些文件的目录才是根目录（不要推多一层空壳文件夹）：

```text
package.json
wrangler.toml
vite.config.ts
src/
migrations/
```

本仓库 `package.json` 里的项目名是：

```json
"name": "cloudflare-rules"
```

### 1.2 在 GitHub 新建空仓库

1. 打开 [https://github.com/new](https://github.com/new)
2. Repository name 建议填：`cloudflare-rules`
3. 选 Public 或 Private 均可
4. **不要**勾选 “Add a README / .gitignore / license”（本地已有代码）
5. 点 **Create repository**
6. 复制仓库地址，例如：  
   `https://github.com/你的用户名/cloudflare-rules.git`

### 1.3 本机初始化并推送（Windows 示例）

在 **PowerShell** 或 **Git Bash** 中（路径按你电脑实际修改）：

```bash
cd "c:/Users/你的用户名/Desktop/private-rules/clone/Private-rules-main"

git init
git branch -M main
git add .
git status
git commit -m "Initial commit: cloudflare-rules"

git remote add origin https://github.com/你的用户名/cloudflare-rules.git
git push -u origin main
```

说明：

- GitHub 已不支持「账号密码」推送，`git push` 时密码处请用 **Personal Access Token**
- 创建 Token：GitHub → Settings → Developer settings → Personal access tokens，勾选 `repo`
- 不要把 `.dev.vars`、真实密码提交进仓库（`.gitignore` 已忽略）

---

## 第二步：在 Cloudflare 用 Git 部署

### 2.1 连接仓库

1. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 左侧进入 **Workers & Pages**（有的界面叫 Workers）
3. **Create** → 选择 **导入仓库 / Connect to Git**（文案可能略有不同）
4. 授权 GitHub，选中你刚推的 `cloudflare-rules` 仓库

### 2.2 填写构建设置（最容易填错）

| 设置项 | 请这样填 | 不要这样填 |
| --- | --- | --- |
| **项目名称 / Worker 名** | `cloudflare-rules` | ~~`cloudflare_rules`~~（下划线会报错） |
| **生产分支** | `main` | 除非你默认分支不是 main |
| **构建命令 Build command** | `pnpm build` | 不要写成两行、不要带 deploy |
| **部署命令 Deploy command** | `pnpm run deploy` | ~~`pnpm deploy`~~（见下方大坑） |
| **根目录 Root directory** | 留空 或 `/` | 只有代码在子目录时才填子路径 |

#### 大坑：`pnpm deploy` ≠ 本项目的部署脚本

- 裸写 **`pnpm deploy`** → 调用的是 **pnpm 自带的 monorepo 发布**，会报：  
  `ERR_PNPM_NOTHING_TO_DEPLOY No project was selected for deployment`
- 正确写法必须带 **`run`**：

```text
pnpm run deploy
```

等价于执行 `package.json` 里的：

```json
"deploy": "wrangler deploy --keep-vars"
```

也可以直接写：

```text
npx wrangler deploy --keep-vars
```

> 高级设置里默认的 `npx wrangler versions upload` 是「上传版本」流程，也能用；  
> 若你只想简单上线生产，用 **`pnpm run deploy`** 即可。

### 2.3 开始构建并等待成功

构建日志里应大致看到：

1. `pnpm install` 成功（本项目约 100+ 包，**不应**再出现 `better-sqlite3` 编译）
2. `vite build` 产出：
   - `dist/worker/wrangler.json`
   - `dist/client/...`
3. `Prepared Cloudflare deploy config: dist/worker/wrangler.json (name=cloudflare-rules, ...)`
4. 部署命令成功

记下你的访问域名，一般是：

```text
https://cloudflare-rules.<你的子域>.workers.dev
```

此时页面可能还不能登录——**还没配密钥和数据库**，属正常。

---

## 第三步：创建 D1 数据库

1. Dashboard 左侧 **Storage & Databases → D1**（或搜索 D1）
2. **Create database**
3. 名称示例：`cloudflare-rules-d`  
   - 若某个名字显示「不可用」，多半是账号里已经用过同名，**换一个名字即可**  
   - 不是「`-db` 后缀非法」；库名不必和 Worker 完全一样
4. 创建成功后，点进数据库详情，可复制 **Database ID**（一串 UUID），本机迁移时有用

---

## 第四步：把 D1 绑定到 Worker（关键）

代码里通过 **`env.DB`** 访问数据库，所以绑定名必须是 **`DB`**。

1. 回到 **Workers & Pages** → 点开 Worker **`cloudflare-rules`**
2. 进入 **Settings（设置）**
3. 找到 **Bindings（绑定）**
4. **Add（添加）** → 选择 **D1 Database**
5. 填写：

| 字段 | 值 |
| --- | --- |
| **Variable name / Binding name** | **`DB`**（必须全大写，不能写成 `db`） |
| **D1 database** | 选你刚建的库（如 `cloudflare-rules-d`） |

6. **Save**  
7. 若提示需要重新部署：点 Deploy / Retry 一次

保存后应看到：

```text
DB  →  D1  →  （你的库名）
```

本仓库 `wrangler.toml` 中对应片段：

```toml
[[d1_databases]]
binding = "DB"
database_name = "cloudflare-rules-d"
# database_id = "从 Dashboard 复制的 UUID"   # 本机 wrangler 迁移时建议填上
```

若你建库时用了别的名字，把 `database_name` 改成一致，并填上 `database_id`，再推到 GitHub（可选，但本机迁移更稳）。

---

## 第五步：配置 Secrets（登录必需）

### 5.1 要配哪些？

路径：**Worker → Settings → Variables and Secrets**  
类型请选 **Secret**（加密存储）。

| 名称（必须一字不差） | 是否必须 | 作用 |
| --- | --- | --- |
| `ADMIN_PASSWORD` | **必须** | 后台登录密码 |
| `SESSION_SECRET` | **必须** | 登录会话签名；**只配密码不够** |
| `RULE_TOKEN` | **强烈建议** | 私密订阅链接校验 |
| `BASE_URL` | 可选 | 自定义域名后的完整站点地址，如 `https://rules.example.com` |

登录接口逻辑（简化）：

```text
只有 ADMIN_PASSWORD 和 SESSION_SECRET 都存在 → 才允许登录
否则返回：服务端尚未配置登录密钥。
```

### 5.2 怎么生成随机串？（Windows 小白版）

**不要在「命令提示符 cmd」里跑 PowerShell 语法。**

- cmd 提示符一般是：`C:\Users\你>`  
- PowerShell 提示符一般是：`PS C:\Users\你>`

#### 方法 A：打开 Windows PowerShell 后执行两次

```powershell
-join ((48..57 + 65..90 + 97..122) | Get-Random -Count 40 | ForEach-Object { [char]$_ })
```

- 第 1 次输出 → 填 `SESSION_SECRET`
- 第 2 次输出 → 填 `RULE_TOKEN`
- `ADMIN_PASSWORD` → 你自己定一个强登录密码

#### 方法 B：仍在 cmd 黑窗口时，用这一条

```bat
powershell -NoProfile -Command "[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')"
```

再执行一次，得到另一串。

### 5.3 保存后请重新部署

改 Secrets 后，**旧版本 Worker 可能还读不到新密钥**。  
在 Deployments 里 **Retry / 重新部署** 一次。

### 5.4 用接口检查是否生效

浏览器打开（换成你的域名）：

```text
https://你的域名/api/auth/me
```

期望大致如下（字段为 `true` 才算配好）：

```json
{
  "authenticated": false,
  "passwordConfigured": true,
  "sessionSecretConfigured": true,
  "ruleTokenConfigured": true,
  "d1Ready": true
}
```

| 字段为 false | 含义 |
| --- | --- |
| `passwordConfigured` | 没读到 `ADMIN_PASSWORD` |
| `sessionSecretConfigured` | 没读到 `SESSION_SECRET` |
| `d1Ready` | 没绑好 Binding `DB` |

---

## 第六步：数据库迁移（建表）

部署成功 **不会自动建表**。需要在本机对远程 D1 执行 `migrations/` 下的 SQL。

### 6.1 环境

- 已安装 Node.js
- 在项目根目录（有 `wrangler.toml` 的目录）

若本机没有全局 pnpm：

```bash
npm install -g pnpm
# 或使用 corepack enable 后 corepack prepare pnpm@10.11.1 --activate
```

### 6.2 登录 Cloudflare CLI

```bash
cd 你的项目根目录
npx wrangler login
```

浏览器弹出授权 → 成功后终端显示 `Successfully logged in.`

### 6.3 执行远程迁移

```bash
pnpm db:migrate:remote
```

等价命令：

```bash
npx wrangler d1 migrations apply DB --remote
```

全新空库时，应看到 `0001`～`0010` 依次应用成功。

最后再查一次应显示：

```text
✅ No migrations to apply!
```

### 6.4 迁移常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `duplicate column name: public_links_enabled` | 表结构已有，但 `d1_migrations` 记录不完整 | 见 [docs/DEPLOY.md](./docs/DEPLOY.md) 修复步骤 |
| `no such table: _migrations` | 表名搞错 | 正确表名是 **`d1_migrations`** |
| 找不到数据库 | `database_id` / 绑定不一致 | Dashboard 复制 Database ID 写入 `wrangler.toml` 后再试 |

---

## 第七步：登录后台开始用

1. 打开：

```text
https://你的域名/admin/login
```

2. 输入 **`ADMIN_PASSWORD`** 对应的密码  
3. 进入后建议：
   - **设置 → 服务状态**：数据库 / 密钥应为「已配置」
   - **规则**：建分类、加规则或上游源
   - **订阅**：设访问策略，复制客户端链接
   - **设置**：备份 / 恢复 JSON

### 订阅路径示例

```text
/rules/分类slug.yaml
/sub/<RULE_TOKEN>/分类slug.yaml
```

| 后缀 | 常见客户端 |
| --- | --- |
| `.yaml` | Mihomo、Clash、OpenClash、Stash |
| `.list` | Loon、Surge、Shadowrocket 等 |
| `.txt` | 纯文本 |
| `.json` | 结构化数据 |

---

## （可选）自定义域名

1. Worker → **Custom Domains / 自定义域** 绑定你的域名  
2. 证书生效后用 `https://你的域名/admin/login` 访问  
3. 在 Secrets 或后台设置里填 `BASE_URL`（完整 `https://...`，无末尾斜杠亦可按后台说明）

---

## 本地开发

```bash
pnpm install
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars：ADMIN_PASSWORD / SESSION_SECRET / RULE_TOKEN
pnpm db:migrate:local
pnpm dev
```

浏览器打开：`http://localhost:5173/admin/login`

生产构建自检：

```bash
pnpm build
pnpm exec wrangler deploy --dry-run --keep-vars
```

---

## 我们部署时踩过的坑（速查）

更完整的表格与修复命令见 **[docs/DEPLOY.md](./docs/DEPLOY.md)**。

| # | 问题 | 一句话结论 |
| --- | --- | --- |
| 1 | 名称只能小写字母数字连字符 | Worker 名用 `cloudflare-rules`，禁止 `_`；Vite 环境名用 `worker` 避免目录 `*_rules` 被误当 Worker 名 |
| 2 | `ERR_PNPM_NOTHING_TO_DEPLOY` | Deploy 填 **`pnpm run deploy`**，不要裸 `pnpm deploy` |
| 3 | 服务端尚未配置登录密钥 | 必须同时有 `ADMIN_PASSWORD` + `SESSION_SECRET`，改完要重新部署 |
| 4 | `-join` 不是内部或外部命令 | 在 **PowerShell** 里跑，或用 `powershell -Command "..."` |
| 5 | D1 名 `…-db` 不可用 | 多半重名，换名如 `cloudflare-rules-d`；绑定名仍是 `DB` |
| 6 | 不会绑数据库 | Worker → Settings → Bindings → D1 → **`DB`** |
| 7 | 迁移 duplicate column | 结构已在、记录不全；见 DEPLOY.md 补 `d1_migrations` |
| 8 | 旧版 better-sqlite3 编译失败 | 本仓库已去掉 Node/Docker/SQLite 路径 |

---

## 安全说明

- 后台接口需要登录会话或 API Key  
- Token 订阅只是「路径保密」，不是端到端加密  
- 勿提交 `.dev.vars`、密码、生产备份到公开仓库  
- 更换 `SESSION_SECRET` / `RULE_TOKEN` 后，旧登录态与旧私密链接会失效  

---

## 技术栈

- Cloudflare Workers、Hono、D1  
- React 19、TypeScript、Vite  
- Cron：每 5 分钟扫描；真实同步间隔由各数据源配置决定  

## 许可证

[MIT](./LICENSE)
