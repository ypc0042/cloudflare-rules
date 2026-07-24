import { useEffect, useMemo, useRef, useState } from 'react';
import { CategoryIcon } from './category-icon';
import { UiIcon } from './ui-icon';

const QURE = 'https://raw.githubusercontent.com/Koolson/Qure/master/Other';

export const PRESET_ICON_PACKS = [
  { label: 'Qure Color (全部)', url: `${QURE}/QureColor-All.json` },
  { label: 'Qure Color · 媒体', url: `${QURE}/QureColor-Media.json` },
  { label: 'Qure Color · 服务', url: `${QURE}/QureColor-Service.json` },
  { label: 'Qure Color · 应用游戏', url: `${QURE}/QureColor-AppGame.json` },
  { label: 'Qure Color · 地区', url: `${QURE}/QureColor-Area.json` },
  { label: 'Qure Color · 常用', url: `${QURE}/QureColor-Common.json` },
  { label: 'Qure Light (全部)', url: `${QURE}/QureLight-All.json` },
];

type PackIcon = { name: string; url: string };

const ALIASES: Record<string, string[]> = {
  youtube: ['youtube', 'youtu'],
  youtubemusic: ['youtubemusic', 'youtube'],
  netflix: ['netflix', 'nflx'],
  github: ['github'],
  telegram: ['telegram', 'tg'],
  openai: ['openai', 'chatgpt'],
  chatgpt: ['chatgpt', 'openai'],
  google: ['google'],
  apple: ['apple'],
  microsoft: ['microsoft', 'ms'],
  discord: ['discord'],
  spotify: ['spotify'],
  twitter: ['twitter', 'x'],
  bilibili: ['bilibili', 'bili'],
  tiktok: ['tiktok', 'douyin'],
  instagram: ['instagram'],
  facebook: ['facebook', 'fb'],
  whatsapp: ['whatsapp'],
  steam: ['steam'],
  twitch: ['twitch'],
  disney: ['disney', 'disneyplus'],
  hbo: ['hbo', 'max'],
  prime: ['primevideo', 'amazon'],
  amazon: ['amazon', 'primevideo'],
  cloudflare: ['cloudflare'],
  gemini: ['gemini', 'google'],
  claude: ['claude', 'anthropic'],
  anthropic: ['anthropic', 'claude'],
  emby: ['emby'],
  plex: ['plex'],
  jellyfin: ['jellyfin'],
  bahamut: ['bahamut', 'ani'],
};

function readPackIcons(payload: unknown): PackIcon[] {
  if (Array.isArray(payload)) return payload as PackIcon[];
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.icons)) return record.icons as PackIcon[];
  return Object.entries(record)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([name, url]) => ({ name, url }));
}

function normalizeKey(value: string) {
  return value
    .toLowerCase()
    .replace(/\.png$/i, '')
    .replace(/[^a-z0-9一-鿿]+/g, '');
}

export function isLetterPlaceholderIcon(icon: string | undefined, name: string) {
  if (!icon) return true;
  if (/^https?:\/\//i.test(icon)) return false;
  const expected = name.trim().slice(0, 2).toUpperCase();
  return icon.trim().toUpperCase() === expected || icon.trim().length <= 3;
}

export function matchIconFromPack(name: string, icons: PackIcon[]): PackIcon | null {
  const raw = name.trim();
  if (!raw || !icons.length) return null;
  const key = normalizeKey(raw);
  if (!key) return null;

  const scored: Array<{ icon: PackIcon; score: number }> = [];

  for (const icon of icons) {
    const iconKey = normalizeKey(icon.name);
    if (!iconKey) continue;

    if (iconKey === key) {
      scored.push({ icon, score: 1000 });
      continue;
    }

    const aliasKeys = ALIASES[key];
    if (aliasKeys?.some((alias) => {
      const a = normalizeKey(alias);
      return iconKey === a || iconKey.includes(a);
    })) {
      scored.push({ icon, score: 800 });
      continue;
    }

    if (iconKey.includes(key) && key.length >= 3) {
      scored.push({ icon, score: 500 + Math.min(100, key.length * 10) - Math.min(80, iconKey.length) });
      continue;
    }
    if (key.includes(iconKey) && iconKey.length >= 4) {
      scored.push({ icon, score: 400 + iconKey.length * 5 });
    }
  }

  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score);
  if (scored[0].score < 400) return null;
  return scored[0].icon;
}

export function IconPicker({
  value,
  name,
  customPackUrls,
  customPackNames,
  onChange,
}: {
  value?: string;
  name: string;
  customPackUrls: string[];
  customPackNames?: Record<string, string>;
  onChange: (url: string) => void;
}) {
  const packs = useMemo(
    () => [
      ...PRESET_ICON_PACKS,
      ...customPackUrls.map((url, index) => ({
        label: customPackNames?.[url]?.trim() || `自定义图标包 ${index + 1}`,
        url,
      })),
    ],
    [customPackNames, customPackUrls],
  );
  const [packUrl, setPackUrl] = useState(packs[0]?.url ?? '');
  const [icons, setIcons] = useState<PackIcon[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const manualRef = useRef(false);
  const lastAutoUrlRef = useRef('');

  useEffect(() => {
    if (!packs.some((pack) => pack.url === packUrl)) setPackUrl(packs[0]?.url ?? '');
  }, [packs, packUrl]);

  useEffect(() => {
    if (!packUrl) return;
    const controller = new AbortController();
    setStatus('正在加载图标包');
    fetch(packUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json()) as unknown;
        setIcons(readPackIcons(payload).filter((icon) => icon.name && /^https?:\/\//i.test(icon.url)));
        setStatus('');
      })
      .catch((error: Error & { name?: string }) => {
        if (error.name !== 'AbortError') setStatus(`图标包加载失败：${error.message}`);
      });
    return () => controller.abort();
  }, [packUrl]);

  useEffect(() => {
    if (!icons.length || !name.trim()) return;
    if (manualRef.current && value && /^https?:\/\//i.test(value) && value !== lastAutoUrlRef.current) {
      return;
    }
    if (manualRef.current && value && /^https?:\/\//i.test(value)) return;

    const canAuto = !value || isLetterPlaceholderIcon(value, name) || value === lastAutoUrlRef.current;
    if (!canAuto) return;

    const timer = window.setTimeout(() => {
      const matched = matchIconFromPack(name, icons);
      if (!matched || matched.url === value) return;
      lastAutoUrlRef.current = matched.url;
      manualRef.current = false;
      onChange(matched.url);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [name, icons, value, onChange]);

  function pickIcon(url: string) {
    manualRef.current = true;
    lastAutoUrlRef.current = '';
    onChange(url);
  }

  const visible = icons.filter((icon) => icon.name.toLowerCase().includes(query.trim().toLowerCase()));
  const autoHint =
    !manualRef.current && value && /^https?:\/\//i.test(value)
      ? '已按名称自动匹配，可展开更换'
      : value
        ? '已选择图标，可展开继续更换'
        : '输入规则名可自动匹配；也可展开手动选择';

  return (
    <details className="icon-picker icon-picker-disclosure animated-disclosure">
      <summary className="icon-picker-current">
        <CategoryIcon icon={value} name={name || '规则'} size={52} />
        <span>
          <strong>规则图标</strong>
          <small>{autoHint}</small>
        </span>
        <span className="icon-picker-summary-meta">
          {visible.length} 个
          <UiIcon name="chevron" size={16} />
        </span>
      </summary>
      <div className="icon-picker-content">
        <div className="icon-picker-tools">
          <select className="app-input" value={packUrl} onChange={(event) => setPackUrl(event.target.value)}>
            {packs.map((pack) => (
              <option key={pack.url} value={pack.url}>
                {pack.label}
              </option>
            ))}
          </select>
          <input
            className="app-input"
            placeholder="搜索图标，例如 YouTube、Netflix"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {status ? (
          <p className="helper-text">{status}</p>
        ) : (
          <div className="icon-grid full-icon-grid">
            {visible.map((icon) => (
              <button
                className={value === icon.url ? 'active' : ''}
                key={`${icon.name}-${icon.url}`}
                title={icon.name}
                type="button"
                onClick={() => pickIcon(icon.url)}
              >
                <img src={icon.url} alt="" loading="lazy" referrerPolicy="no-referrer" />
                <span>{icon.name.replace(/\.png$/i, '')}</span>
              </button>
            ))}
            {!visible.length && <div className="icon-empty-state">没有匹配的图标</div>}
          </div>
        )}
      </div>
    </details>
  );
}
