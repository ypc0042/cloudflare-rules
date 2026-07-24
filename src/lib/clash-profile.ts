import type { RuleCategory, RulesData, SubscriptionBundle } from '../types/domain-rules';
import { fileNameForClient } from './formatters';

const REGION_GROUPS: Array<{ name: string; filter: string }> = [
  { name: '🇭🇰 香港', filter: '港|HK|Hong|hongkong|HongKong' },
  { name: '🇹🇼 台湾', filter: '台|TW|Taiwan|taiwan' },
  { name: '🇯🇵 日本', filter: '日|JP|Japan|tokyo|osaka' },
  { name: '🇸🇬 新加坡', filter: '新|SG|Singapore|singapore' },
  { name: '🇺🇸 美国', filter: '美|US|USA|United States|america' },
  { name: '🇰🇷 韩国', filter: '韩|KR|Korea|seoul' },
  { name: '🇬🇧 英国', filter: '英|UK|London|britain' },
  { name: '🇩🇪 德国', filter: '德|DE|Germany|frankfurt' },
];

function siteBase(data: RulesData, requestUrl: string) {
  const request = new URL(requestUrl);
  const configured = data.settings.baseUrl.trim().replace(/\/+$/, '');
  if (!configured) return request.origin;
  try {
    const base = new URL(configured);
    if (request.protocol === 'https:' && base.protocol === 'http:') base.protocol = 'https:';
    return base.toString().replace(/\/+$/, '');
  } catch {
    return request.origin;
  }
}

/** YAML 标量：仅在必要时加双引号（用于 name/url/filter 等字段） */
function yamlScalar(value: string) {
  if (value === '') return '""';
  // 纯标识符/含 emoji 但无特殊 YAML 字符时可不加引号；空格、冒号等需引用
  if (/^[\w.\-/-￿]+$/u.test(value) && !/^true|false|null|yes|no$/i.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

/**
 * Clash rules 行第三段是策略组名：绝不能带 JSON 双引号。
 * 错误示例：RULE-SET,netflix,"netflix" → 会去找名为 `"netflix"` 的组
 * 正确示例：RULE-SET,netflix,netflix
 */
function ruleGroupRef(name: string) {
  return name.replace(/,/g, '');
}

function providerKey(slug: string) {
  return slug.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'rules';
}

/** 按分类名/slug 给策略组加 emoji 前缀（已有 emoji 则不重复加） */
function groupLabel(category: RuleCategory) {
  const raw = (category.name || category.slug || '规则').trim();
  if (/^\p{Extended_Pictographic}/u.test(raw)) return raw;
  const key = `${category.slug} ${category.name}`.toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/github|\bgh\b/, '🐙'],
    [/youtube|ytb|googlevideo/, '▶️'],
    [/netflix|nflx/, '🎬'],
    [/telegram|\btg\b/, '✈️'],
    [/openai|chatgpt|claude|gemini|\bai\b/, '🤖'],
    [/google|gmail|gstatic/, '🇬'],
    [/apple|icloud|app.?store/, '🍎'],
    [/microsoft|xbox|office|onedrive/, 'Ⓜ️'],
    [/steam|epic|game|playstation|nintendo/, '🎮'],
    [/twitter|\bx\.com\b/, '𝕏'],
    [/facebook|instagram|meta/, '📘'],
    [/tiktok|douyin/, '🎵'],
    [/spotify|music/, '🎧'],
    [/discord/, '💬'],
    [/cloudflare|\bcf\b/, '☁️'],
    [/bili|bilibili/, '📺'],
    [/\bcn\b|china|国内|直连/, '🇨🇳'],
    [/ads?$|adblock|reject|广告/, '🚫'],
    [/proxy|代理|gfw/, '🚀'],
  ];
  for (const [re, emoji] of rules) {
    if (re.test(key)) return `${emoji} ${raw}`;
  }
  return `📁 ${raw}`;
}


/**
 * 生成完整 Clash / Mihomo 配置模板。
 * - 不含机场节点列表；proxy-providers 预留填写位置
 * - 内置仅逻辑上使用 DIRECT / REJECT
 * - 地区组靠 filter + include-all，导入节点后自动归类
 */
export function buildClashProfileYaml(options: {
  bundle: SubscriptionBundle;
  categories: RuleCategory[];
  data: RulesData;
  requestUrl: string;
  ruleToken?: string;
}) {
  const { bundle, categories, data, requestUrl, ruleToken } = options;
  const base = siteBase(data, requestUrl);
  const selected = categories.filter((category) => bundle.categoryIds.includes(category.id) && category.enabled !== false);
  const useToken = bundle.tokenLinksEnabled !== false && Boolean(ruleToken);

  const lines: string[] = [
    `# Cloudflare Rules · 订阅集「${bundle.name}」`,
    `# 完整 Clash / Mihomo 配置模板（不含节点列表）`,
    `# - 在下方 proxy-providers 的 url 中填入机场订阅（可选）`,
    `# - 也可在客户端另行导入节点；地区组将按节点名 filter 自动归类`,
    `# - 内置策略仅引用 DIRECT / REJECT`,
    '',
    'mixed-port: 7890',
    'allow-lan: false',
    'mode: rule',
    'log-level: info',
    'ipv6: true',
    'external-controller: 127.0.0.1:9090',
    '',
    'dns:',
    '  enable: true',
    '  enhanced-mode: fake-ip',
    '  nameserver:',
    '    - https://dns.alidns.com/dns-query',
    '    - https://cloudflare-dns.com/dns-query',
    '',
    '# ========== 机场订阅（可选：把 url 改成你的订阅地址）==========',
    'proxy-providers:',
    '  机场订阅:',
    '    type: http',
    '    url: ""',
    '    interval: 3600',
    '    path: ./providers/airport.yaml',
    '    health-check:',
    '      enable: true',
    '      url: https://cp.cloudflare.com/generate_204',
    '      interval: 600',
    '',
    '# ========== 规则提供者（引用本站规则集）==========',
    'rule-providers:',
  ];

  for (const category of selected) {
    const key = providerKey(category.slug);
    const fileName = fileNameForClient(category, 'mihomo');
    const url = useToken
      ? `${base}/sub/${encodeURIComponent(ruleToken!)}/${fileName}`
      : `${base}/rules/${fileName}`;
    lines.push(
      `  ${key}:`,
      '    type: http',
      `    url: ${yamlScalar(url)}`,
      '    interval: 3600',
      `    path: ./providers/rules-${key}.yaml`,
      '    behavior: classical',
      '    format: yaml',
    );
  }
  if (!selected.length) {
    lines.push('  {}');
  }

  const regionNames = REGION_GROUPS.map((item) => item.name);
  const commonSelect = ['🚀 手动选择', '♻️ 自动选择', ...regionNames, 'DIRECT', 'REJECT'];

  lines.push('', 'proxy-groups:');

  // 手动选择
  lines.push(
    '  - name: 🚀 手动选择',
    '    type: select',
    '    include-all: true',
    '    include-all-proxies: true',
    '    include-all-providers: true',
    '    proxies:',
    '      - ♻️ 自动选择',
    '      - DIRECT',
    '      - REJECT',
  );

  // 自动选择
  lines.push(
    '  - name: ♻️ 自动选择',
    '    type: url-test',
    '    include-all: true',
    '    include-all-proxies: true',
    '    include-all-providers: true',
    '    url: https://cp.cloudflare.com/generate_204',
    '    interval: 300',
    '    tolerance: 50',
    '    proxies:',
    '      - DIRECT',
  );

  // 地区
  for (const region of REGION_GROUPS) {
    lines.push(
      `  - name: ${region.name}`,
      '    type: select',
      '    include-all: true',
      '    include-all-proxies: true',
      '    include-all-providers: true',
      `    filter: ${yamlScalar(region.filter)}`,
      '    proxies:',
      '      - DIRECT',
      '      - REJECT',
    );
  }

  // 按规则分类（组名与 rules 第三段一致；带 emoji）
  for (const category of selected) {
    const groupName = groupLabel(category);
    lines.push(`  - name: ${yamlScalar(groupName)}`, '    type: select', '    proxies:');
    for (const item of commonSelect) {
      lines.push(`      - ${yamlScalar(item)}`);
    }
  }

  lines.push(
    '  - name: 🎯 全球直连',
    '    type: select',
    '    proxies:',
    '      - DIRECT',
    '      - REJECT',
    '  - name: 🐟 漏网之鱼',
    '    type: select',
    '    proxies:',
    '      - 🚀 手动选择',
    '      - ♻️ 自动选择',
    '      - DIRECT',
    '      - REJECT',
  );

  lines.push('', 'rules:');
  for (const category of selected) {
    const key = providerKey(category.slug);
    const groupName = ruleGroupRef(groupLabel(category));
    lines.push(`  - RULE-SET,${key},${groupName}`);
  }
  lines.push('  - MATCH,🐟 漏网之鱼', '');

  return `${lines.join('\n')}\n`;
}

export function profileFileName(slug: string) {
  const safe = slug.replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'profile';
  return `profile-${safe}.yaml`;
}

export function parseProfileFileName(fileName: string): { slug: string } | null {
  const match = /^profile-(.+)\.ya?ml$/i.exec(fileName);
  return match ? { slug: match[1] } : null;
}
