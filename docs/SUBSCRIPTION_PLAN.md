# 订阅页改造：规则集 + 订阅集

## 一、需求总结（此前讨论）

### 1. 为什么要改
- 现有导出只有 **规则集**（`payload:` / list），**不能**当完整 Clash 主配置用。
- 用户需要两类产物：
  1. **规则集**：只有规则，方便 rule-provider / 单独复制。
  2. **订阅集**：完整 Clash 模板（策略组 + 分流），**不管节点数据本身**。

### 2. 规则集（Rule set）
| 点 | 约定 |
| --- | --- |
| 单条规则 | **已有分类自动出现**，无需「先创建规则集」；可直接复制 yaml/list/txt/json |
| 合并规则集 | 可选：新建时多选分类 → 合成一个规则链接（现有 bundle 能力保留并归入此类） |
| 内容 | 仅规则（`payload` / list / txt / json），与现在一致 |
| 访问 | 私密 / 公开（分类或合并项各自设置） |

### 3. 订阅集（Subscription / Profile）
| 点 | 约定 |
| --- | --- |
| 新建时 | **同样要选规则**（多选分类） |
| 导出内容 | **完整 Clash 模板**（可作主配置骨架） |
| 节点 | **不**在后台强制填机场；模板内 **预留** `proxy-providers` 填 URL 的位置（空着即可） |
| 内置 | 仅 **DIRECT**、**REJECT** |
| 策略组 | 手动选择、自动选择、地区组（filter）、按勾选分类生成的策略组、直连、漏网之鱼等 |
| 分流 | 按勾选分类生成 `rules` / `rule-providers`（优先引用本站规则 URL） |
| 无机场时 | 仍可用；节点可之后在客户端自行导入/填写 |

### 4. 界面结构
```
订阅
├── 规则集
│     · 全部已有规则（每个一条，直接复制）
│     · 已保存的合并规则集
│     · [新建合并规则集] → 再选规则 → 命名/格式/访问 → 保存
│
└── 订阅集
      · 已保存的完整模板列表
      · [新建订阅集] → 再选规则 → 命名/访问 → 保存
      · 复制完整配置链接
```

- **新建时才选规则**（规则集合并 / 订阅集），首页不是先勾一堆再导出唯一路径。
- 单分类规则集：列表自带，点进或行内复制。

### 5. 完整模板应包含
- 基础：`mixed-port`、`mode: rule`、`log-level` 等合理默认
- `proxy-providers`：占位（`url: ""` 或注释说明在此填机场）
- `proxy-groups`：通用组 + 地区 filter 组 + 每选中分类一组
- `rule-providers` + `rules`：指向本站对应规则 URL / 或内联（优先 rule-providers）
- **无**写死机场节点列表

### 6. 相关已定技术点（可并行）
- 合并规则：动态合并分类规则，不靠快照
- 性能：概览预览条数已降为 80；写操作优先用接口返回 overview（进行中）

### 7. 明确不做（本轮）
- 后台强制维护机场节点库
- 新建订阅集时必填机场 URL
- 生成真实节点名列表

---

## 二、详细修改计划

### 阶段 A：数据模型
1. 迁移 `0012_bundle_kind.sql`：`subscription_bundles.kind` = `'rules' | 'profile'`，默认 `'rules'`。
2. `ensureDatabase` + `reconcileD1MigrationRecords` + `d1-migrate-safe.mjs` 同步支持。
3. 类型 `SubscriptionBundle` 增加 `kind`。

### 阶段 B：完整模板生成
1. 新模块 `src/lib/clash-profile.ts`：根据分类列表 + 站点 baseURL + token 生成完整 yaml 字符串。
2. 默认模板：
   - proxies 概念上仅 DIRECT/REJECT（组内引用）
   - proxy-providers 占位
   - 地区 filter 默认关键词（港/台/日/新/美/韩等）
   - 每分类：`rule-providers` + 策略组 + `RULE-SET` 规则
   - `MATCH` → 漏网之鱼

### 阶段 C：后端路由
1. 创建/更新 bundle 时写 `kind`。
2. 导出：
   - `kind=rules`：现有 `bundle-<slug>.(yaml|list|txt|json)`
   - `kind=profile`：`profile-<slug>.yaml` 走完整模板（public/token 与现访问策略一致）
3. `parseBundleFileName` 扩展识别 `profile-`。

### 阶段 D：前端订阅页
1. 重做 `links-panel.tsx`：
   - Tab 或上下两大区：**规则集** / **订阅集**
   - 规则集：分类列表（保留单分类详情复制）+ 合并列表 + 新建合并向导
   - 订阅集：profile 列表 + 新建向导（选规则 → 命名 → 访问）
2. hooks：`createBundle({ kind: 'rules' | 'profile', ... })`。

### 阶段 E：文档与校验
1. README/DEPLOY 简短说明两类产物。
2. typecheck + unit 测试。

### 阶段 F：性能（顺带落地未提交部分）
1. 保持 `UPSTREAM_RULE_PREVIEW_LIMIT = 80`。
2. 保持 mutate 用返回体、首屏优先 categories。

---

## 三、验收标准
- [ ] 规则集区能直接复制每个已有分类的订阅链接
- [ ] 能新建合并规则集，链接仍为规则内容
- [ ] 能新建订阅集，链接打开为完整 Clash yaml（含 groups/rules、provider 占位、DIRECT/REJECT）
- [ ] 不填机场也能保存/打开模板
- [ ] 私密/公开与 RULE_TOKEN 行为与现网一致
- [ ] 迁移可安全 apply

---

## 四、实现顺序
A → B → C → D → E（F 随前端一起）
