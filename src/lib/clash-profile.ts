import type { RuleCategory, RulesData, SubscriptionBundle } from '../types/domain-rules';
import { fileNameForClient } from './formatters';

/** 地区定义：priority 越小越优先（落地码优先于常见中转「港」） */
export type RegionDef = {
  id: string;
  name: string;
  priority: number;
  keywords: string[];
};

/**
 * 关键词尽量「能认出 + 少串组」：
 * - 短英文码用边界匹配（在 assignRegion / 生成 filter 时处理）
 * - 韩国优先于香港，保证 voll-kr-* 进韩国而非香港
 */
export const REGION_DEFS: RegionDef[] = [
  {
    id: 'kr',
    name: '🇰🇷 韩国',
    priority: 1,
    keywords: ['kr', 'korea', 'korean', '韩', '韩国', '韓', '首尔', 'ソウル', 'seoul', '釜山', 'busan', '仁川', 'incheon'],
  },
  {
    id: 'jp',
    name: '🇯🇵 日本',
    priority: 2,
    keywords: ['jp', 'japan', 'japanese', '日', '日本', '东京', '東京', 'tokyo', 'osaka', '大阪', '名古屋', 'nagoya', '埼玉', '神户', 'kobe'],
  },
  {
    id: 'sg',
    name: '🇸🇬 新加坡',
    priority: 3,
    keywords: ['sg', 'singapore', '新加坡', '狮城', '獅城', 'sing', 'sgp'],
  },
  {
    id: 'my',
    name: '🇲🇾 马来西亚',
    priority: 4,
    keywords: ['my', 'malaysia', '马来', '马来西亚', '馬來', '馬來西亞', '吉隆坡', 'kuala', 'lumpur', 'kl-', '-kl-', '柔佛', '槟城'],
  },
  {
    id: 'tw',
    name: '🇹🇼 台湾',
    priority: 5,
    keywords: ['tw', 'taiwan', '台', '台湾', '台灣', '台北', 'taipei', '高雄', 'kaohsiung', '台中', '台南'],
  },
  {
    id: 'us',
    name: '🇺🇸 美国',
    priority: 6,
    // us 用边界匹配：us- / -us- / us02 可中；plus 不会中
    keywords: ['us', 'usa', 'unitedstates', 'united states', 'america', 'american', '美', '美国', '美國', '洛杉矶', '矽谷', '硅谷', 'seattle', 'chicago', 'miami', 'dallas', 'lasvegas', 'sanjose', 'sfo', 'lax', 'nyc', 'newyork', 'new york'],
  },
  {
    id: 'hk',
    name: '🇭🇰 香港',
    priority: 7,
    keywords: ['hk', 'hongkong', 'hong kong', '港', '香港', 'hkp', 'hkt', '深港'],
  },
  {
    id: 'gb',
    name: '🇬🇧 英国',
    priority: 8,
    keywords: ['uk', 'gb', 'britain', 'british', 'england', 'london', '英', '英国', '英國', '伦敦', '倫敦'],
  },
  {
    id: 'de',
    name: '🇩🇪 德国',
    priority: 9,
    keywords: ['de', 'germany', 'german', 'frankfurt', 'berlin', '德', '德国', '德國', '法兰克福', '柏林'],
  },
  {
    id: 'fr',
    name: '🇫🇷 法国',
    priority: 10,
    keywords: ['fr', 'france', 'french', 'paris', '法', '法国', '法國', '巴黎'],
  },
  {
    id: 'tr',
    name: '🇹🇷 土耳其',
    priority: 11,
    keywords: ['tr', 'turkey', 'türkiye', 'istanbul', '土', '土耳其', '伊斯坦布尔'],
  },
  {
    id: 'in',
    name: '🇮🇳 印度',
    priority: 12,
    keywords: ['india', 'indian', 'mumbai', 'delhi', '印', '印度', '孟买'],
  },
  {
    id: 'ca',
    name: '🇨🇦 加拿大',
    priority: 13,
    keywords: ['ca', 'canada', 'canadian', 'toronto', 'vancouver', '加', '加拿大', '温哥华', '多伦多'],
  },
  {
    id: 'au',
    name: '🇦🇺 澳大利亚',
    priority: 14,
    keywords: ['au', 'australia', 'australian', 'sydney', 'melbourne', '澳', '澳大利亚', '澳洲', '悉尼', '墨尔本'],
  },
];

export const OTHER_REGION_NAME = '🌐 其他地区';

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 短英文地区码匹配：
 * - 允许 jp02、us-id、nb-jp02（码后接数字或分隔符）
 * - 不允许 plus 里的 us、script 里的 sg 等「嵌在单词里」
 * 规则：左侧为开头或非字母数字；右侧为结尾、非字母、或数字（jp02）
 */
export function keywordMatches(nodeName: string, keyword: string): boolean {
  const name = nodeName.trim();
  if (!name || !keyword) return false;
  if (/[一-鿿㐀-䶿]/.test(keyword)) {
    return name.includes(keyword);
  }
  const k = keyword.toLowerCase();
  // 多词（united states）
  if (k.includes(' ')) {
    return name.toLowerCase().includes(k);
  }
  const e = escapeRegex(k);
  if (k.length <= 3) {
    // (^|[^a-z0-9]) code ([^a-z]|[0-9]|$)  → jp02、us-1、kr 均可；plus 中 us 不行
    return new RegExp(`(^|[^a-z0-9])${e}([^a-z]|[0-9]|$)`, 'i').test(name);
  }
  return new RegExp(escapeRegex(k), 'i').test(name);
}

/** 按优先级返回唯一地区组名；认不出 → 其他地区 */
export function assignRegion(nodeName: string): string {
  const sorted = [...REGION_DEFS].sort((a, b) => a.priority - b.priority);
  for (const region of sorted) {
    if (region.keywords.some((kw) => keywordMatches(nodeName, kw))) {
      return region.name;
    }
  }
  return OTHER_REGION_NAME;
}

/** 生成 Mihomo 可用的 (?i) 过滤正则（用于 filter / exclude-filter） */
export function buildFilterPattern(keywords: string[]): string {
  const unique = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))];
  const parts = unique.map((kw) => {
    if (/[一-鿿㐀-䶿]/.test(kw)) return escapeRegex(kw);
    const e = escapeRegex(kw);
    if (kw.length <= 3 && !kw.includes(' ')) {
      // 与 keywordMatches 一致：码后允许数字（jp02 / us01）
      return `(^|[^A-Za-z0-9])${e}([^A-Za-z]|[0-9]|$)`;
    }
    return e;
  });
  if (!parts.length) return '(?!)';
  return `(?i)(${parts.join('|')})`;
}

function keywordsOfPriorityLessThan(priority: number): string[] {
  return REGION_DEFS.filter((r) => r.priority < priority).flatMap((r) => r.keywords);
}

function allRegionKeywords(): string[] {
  return REGION_DEFS.flatMap((r) => r.keywords);
}

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

/** YAML 标量：仅在必要时加双引号 */
function yamlScalar(value: string) {
  if (value === '') return '""';
  if (/^[\w.\-/-￿]+$/u.test(value) && !/^true|false|null|yes|no$/i.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

/**
 * Clash rules 行第三段是策略组名：绝不能带 JSON 双引号。
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
 * - 内置 DIRECT / REJECT
 * - 地区组：按节点名关键词 + 优先级互斥（filter + exclude-filter）；认不出 → 🌐 其他地区
 * - 推荐 Mihomo / Clash Meta / Verge（需支持 exclude-filter）
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
    `# - 若更新订阅失败：可在客户端开启「通过代理更新订阅」/ 换可访问的机场 URL；模板本身不含节点端口`,
    `# - 地区分组只看节点【名称】：关键词 + 优先级，一节点只进一个地区组`,
    `# - 支持 jp02、us-id 等「地区码+数字」命名；无法识别 → 「${OTHER_REGION_NAME}」`,
    `# - 韩国优先于香港；需要 exclude-filter（Mihomo / Clash Meta / Verge Rev）`,
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
    '      # 测速地址：gstatic 在部分网络更稳；仍超时可在客户端改为 cp.cloudflare.com/generate_204',
    '      url: https://www.gstatic.com/generate_204',
    '      interval: 600',
    '      timeout: 5000',
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

  const regionsSorted = [...REGION_DEFS].sort((a, b) => a.priority - b.priority);
  const regionNames = regionsSorted.map((item) => item.name);
  const commonSelect = ['🚀 手动选择', '♻️ 自动选择', ...regionNames, OTHER_REGION_NAME, 'DIRECT', 'REJECT'];

  lines.push('', 'proxy-groups:');

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

  // 自动选择：include-all 纳入全部节点；url-test 参数对齐常见可用模板
  //（参考订阅同样用 generate_204；并配合下方「测速工具」分流，避免测速走错策略）
  lines.push(
    '  - name: ♻️ 自动选择',
    '    type: url-test',
    '    include-all: true',
    '    include-all-proxies: true',
    '    include-all-providers: true',
    '    lazy: true',
    '    url: https://www.gstatic.com/generate_204',
    '    interval: 300',
    '    tolerance: 50',
    '    timeout: 5000',
    '    expected-status: 204',
    '    proxies:',
    '      - DIRECT',
  );

  // 地区组：filter = 本区；exclude-filter = 更高优先级区关键词 → 一节点一地区
  for (const region of regionsSorted) {
    const filter = buildFilterPattern(region.keywords);
    const higher = keywordsOfPriorityLessThan(region.priority);
    lines.push(
      `  - name: ${region.name}`,
      '    type: select',
      '    include-all: true',
      '    include-all-proxies: true',
      '    include-all-providers: true',
      `    filter: ${yamlScalar(filter)}`,
    );
    if (higher.length) {
      lines.push(`    exclude-filter: ${yamlScalar(buildFilterPattern(higher))}`);
    }
    lines.push(
      '    proxies:',
      '      - DIRECT',
      '      - REJECT',
    );
  }

  // 其他地区：排除所有已知地区关键词
  lines.push(
    `  - name: ${OTHER_REGION_NAME}`,
    '    type: select',
    '    include-all: true',
    '    include-all-proxies: true',
    '    include-all-providers: true',
    `    exclude-filter: ${yamlScalar(buildFilterPattern(allRegionKeywords()))}`,
    '    proxies:',
    '      - DIRECT',
    '      - REJECT',
  );

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
  );

  // 漏网之鱼：与业务策略组相同，可选手动/自动/全部地区/其他地区
  lines.push('  - name: 🐟 漏网之鱼', '    type: select', '    proxies:');
  for (const item of commonSelect) {
    lines.push(`      - ${yamlScalar(item)}`);
  }

  // 测速工具：客户端「测延迟」流量应走此组，避免被业务规则误伤；默认直连测速站点更稳
  // 参考完整模板里「🚀 测速工具」+ GEOSITE category-speedtest 的做法
  lines.push('  - name: 🚀 测速工具', '    type: select', '    proxies:');
  lines.push('      - DIRECT');
  for (const item of commonSelect) {
    if (item === 'DIRECT' || item === 'REJECT') continue;
    lines.push(`      - ${yamlScalar(item)}`);
  }
  lines.push('      - REJECT');

  lines.push('', 'rules:');
  // 测速/连通性检测域名优先：直连或经「测速工具」组，减轻美国等节点「全超时」误报
  lines.push(
    '  - DOMAIN-SUFFIX,gstatic.com,🚀 测速工具',
    '  - DOMAIN-SUFFIX,google.com,🚀 测速工具',
    '  - DOMAIN-SUFFIX,googleapis.com,🚀 测速工具',
    '  - DOMAIN-SUFFIX,cloudflare.com,🚀 测速工具',
    '  - DOMAIN-KEYWORD,generate_204,🚀 测速工具',
    '  - DOMAIN-KEYWORD,connectivitycheck,🚀 测速工具',
    '  - DOMAIN-KEYWORD,captive,🚀 测速工具',
    '  - GEOSITE,category-speedtest,🚀 测速工具',
  );
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
