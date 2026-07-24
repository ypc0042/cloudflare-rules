import { useCallback, useEffect, useState } from 'react';
import type { BundleFormat, BundleKind, ClientLink, DomainRule, DomainRuleType, GeoSourceSuggestion, ImportPreview, RulesData, SubscriptionBundle } from '../../types/domain-rules';
import { UPSTREAM_RULE_PREVIEW_LIMIT } from '../../types/domain-rules';

type LinksByCategory = Record<string, ClientLink[]>;
export type ApiKeySummary = { id: string; note: string; keyPrefix: string; createdAt: string; lastUsedAt?: string };

const demoCategories = ['AI', 'Apple', 'Google', 'YouTube', 'GitHub', 'Cloudflare'].map((name, categoryIndex) => ({
  id: name.toLowerCase(), name, slug: name, icon: name.slice(0, 2).toUpperCase(),
  description: `${name} 相关服务和域名规则`, enabled: true, sortOrder: categoryIndex,
  createdAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z',
  rules: Array.from({ length: 3 + categoryIndex }, (_, ruleIndex) => ({
    id: `${name}-${ruleIndex}`, categoryId: name.toLowerCase(), value: `${ruleIndex ? `api${ruleIndex}.` : ''}${name.toLowerCase()}.com`,
    type: 'DOMAIN-SUFFIX' as const, enabled: ruleIndex !== 2, sortOrder: ruleIndex,
    createdAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z',
  })),
}));

const localDemoData: RulesData = {
  version: 1,
  settings: { baseUrl: '', policyName: 'PROXY', githubMirrorUrl: '', publicLinksEnabled: true, tokenLinksEnabled: true, customIconPackUrls: [], customIconPackNames: {} },
  meta: { d1Ready: false, adminPasswordConfigured: true, ruleTokenConfigured: true, sessionSecretConfigured: true, apiKeyConfigured: false },
  categories: demoCategories,
  updatedAt: '2026-07-13T00:00:00.000Z',
};

type OverviewPayload = {
  data?: RulesData;
  links?: LinksByCategory;
  bundles?: SubscriptionBundle[];
  bundle?: SubscriptionBundle;
  error?: string;
  ok?: boolean;
};

export function useDomainAdmin() {
  const [data, setData] = useState<RulesData | null>(null);
  const [links, setLinks] = useState<LinksByCategory>({});
  const [bundles, setBundles] = useState<SubscriptionBundle[]>([]);
  const [meta, setMeta] = useState({
    authenticated: false,
    passwordConfigured: false,
    ruleTokenConfigured: false,
    sessionSecretConfigured: false,
    apiKeyConfigured: false,
    d1Ready: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [apiKeys, setApiKeys] = useState<ApiKeySummary[]>([]);

  const applyOverview = useCallback((payload: OverviewPayload) => {
    if (payload.data) setData(payload.data);
    if (payload.links) setLinks(payload.links);
    if (payload.bundles) setBundles(payload.bundles);
    if (payload.bundle) {
      setBundles((current) => {
        const index = current.findIndex((item) => item.id === payload.bundle!.id);
        if (index < 0) return [payload.bundle!, ...current];
        const next = current.slice();
        next[index] = payload.bundle!;
        return next;
      });
    }
  }, []);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // 首屏优先等 categories；me / api-keys / bundles 并行且不阻塞主列表结束
      const categoriesPromise = fetch('/api/categories');
      const secondaryPromise = Promise.all([
        fetch('/api/auth/me'),
        fetch('/api/api-keys'),
        fetch('/api/bundles'),
      ]);

      const response = await categoriesPromise;
      if (response.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      if (!response.ok && import.meta.env.DEV) {
        setData(localDemoData);
        setLinks({});
        setBundles([]);
        setError('');
        return;
      }
      if (!response.ok) throw new Error('无法加载规则数据，请检查数据库连接');
      const payload = (await response.json()) as OverviewPayload;
      applyOverview(payload);
      setError('');
      if (!silent) setLoading(false);

      const [meResponse, apiKeysResponse, bundlesResponse] = await secondaryPromise;
      if (meResponse.ok) setMeta((await meResponse.json()) as typeof meta);
      if (apiKeysResponse.ok) setApiKeys(((await apiKeysResponse.json()) as { keys?: ApiKeySummary[] }).keys ?? []);
      if (bundlesResponse.ok) setBundles(((await bundlesResponse.json()) as { bundles?: SubscriptionBundle[] }).bundles ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [applyOverview]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const mutate = useCallback(
    async (url: string, options: RequestInit) => {
      const response = await fetch(url, {
        ...options,
        headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
      });
      const payload = (await response.json().catch(() => ({}))) as OverviewPayload;
      if (!response.ok) {
        const message = payload.error ?? '操作失败';
        setError(message);
        throw new Error(message);
      }

      // 写操作接口已返回轻量 overview 时直接套用，避免再打 4 个全量请求
      if (payload.data || payload.links || payload.bundle || payload.bundles) {
        applyOverview(payload);
      } else if (url.includes('/api/bundles/') && options.method === 'DELETE') {
        const id = url.split('/').pop()!;
        setBundles((current) => current.filter((item) => item.id !== id));
      } else if (url.includes('/api/api-keys')) {
        const keysResponse = await fetch('/api/api-keys');
        if (keysResponse.ok) setApiKeys(((await keysResponse.json()) as { keys?: ApiKeySummary[] }).keys ?? []);
      } else {
        await refresh(true);
      }
      return response;
    },
    [applyOverview, refresh],
  );

  const loadRules = useCallback(async (options: { categoryId?: string; query?: string; source?: 'manual' | 'upstream' | 'url' | 'geo'; all?: boolean }, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (options.categoryId) params.set('categoryId', options.categoryId);
    if (options.query) params.set('q', options.query);
    if (options.source) params.set('source', options.source);
    if (options.all) params.set('all', '1');
    else params.set('limit', String(UPSTREAM_RULE_PREVIEW_LIMIT));
    const response = await fetch(`/api/rules?${params.toString()}`, { signal });
    if (!response.ok) throw new Error('规则加载失败');
    return ((await response.json()) as { rules: DomainRule[] }).rules;
  }, []);

  return {
    data,
    links,
    bundles,
    loading,
    error,
    clearError: () => setError(''),
    meta,
    apiKeys,
    refresh,
    createCategory: (input: { name: string; icon?: string; description?: string; sourceUrls?: string[]; geositeNames?: string[]; geoipNames?: string[]; syncIntervalMinutes?: number; userAgent?: string; ruleOptimization?: 'none' | 'conservative' | 'aggressive'; tokenLinksEnabled?: boolean; publicLinksEnabled?: boolean }) =>
      mutate('/api/categories', { method: 'POST', body: JSON.stringify(input) }),
    updateCategory: (id: string, input: Record<string, unknown>) =>
      mutate(`/api/categories/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    updateSettings: (input: Record<string, unknown>) =>
      mutate('/api/settings', { method: 'PATCH', body: JSON.stringify(input) }),
    deleteCategory: (id: string) => mutate(`/api/categories/${id}`, { method: 'DELETE' }),
    syncAll: () => mutate('/api/sync', { method: 'POST' }),
    syncCategory: (id: string) => mutate(`/api/categories/${id}/sync`, { method: 'POST' }),
    searchGeoSources: async (query: string) => {
      const response = await fetch(`/api/geo/search?q=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error('Geo 数据索引加载失败');
      return ((await response.json()) as { results: GeoSourceSuggestion[] }).results;
    },
    loadRules,
    addRule: (categoryId: string, input: { value: string; type?: DomainRuleType; note?: string }) =>
      mutate(`/api/categories/${categoryId}/rules`, { method: 'POST', body: JSON.stringify(input) }),
    updateRule: (categoryId: string, rule: DomainRule) =>
      mutate(`/api/categories/${categoryId}/rules/${rule.id}`, { method: 'PATCH', body: JSON.stringify(rule) }),
    deleteRule: (categoryId: string, ruleId: string) =>
      mutate(`/api/categories/${categoryId}/rules/${ruleId}`, { method: 'DELETE' }),
    batchRules: (categoryId: string, ruleIds: string[], action: 'enable' | 'disable' | 'delete') =>
      mutate(`/api/categories/${categoryId}/rules/batch`, { method: 'POST', body: JSON.stringify({ ruleIds, action }) }),
    importPreview: async (categoryId: string, text: string) => {
      const response = await fetch(`/api/categories/${categoryId}/rules/bulk-import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, confirm: false }),
      });
      return response.json() as Promise<{ preview: ImportPreview }>;
    },
    confirmImport: (categoryId: string, text: string) =>
      mutate(`/api/categories/${categoryId}/rules/bulk-import`, {
        method: 'POST',
        body: JSON.stringify({ text, confirm: true }),
      }),
    exportData: async () => {
      const response = await fetch('/api/data');
      if (!response.ok) throw new Error('备份导出失败');
      return JSON.stringify(await response.json());
    },
    importData: (json: string) => mutate('/api/data', { method: 'PUT', body: json }),
    createApiKey: async (note: string) => {
      const response = await fetch('/api/api-keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note }) });
      const payload = (await response.json().catch(() => ({}))) as { id?: string; apiKey?: string; note?: string; keyPrefix?: string; createdAt?: string; error?: string };
      if (!response.ok || !payload.apiKey) throw new Error(payload.error ?? 'API Key 生成失败');
      const keysResponse = await fetch('/api/api-keys');
      if (keysResponse.ok) setApiKeys(((await keysResponse.json()) as { keys?: ApiKeySummary[] }).keys ?? []);
      return payload;
    },
    deleteApiKey: (keyId: string) => mutate(`/api/api-keys/${keyId}`, { method: 'DELETE' }),
    updateApiKeyNote: (keyId: string, note: string) => mutate(`/api/api-keys/${keyId}`, { method: 'PATCH', body: JSON.stringify({ note }) }),
    createBundle: (input: { name?: string; kind?: 'rules' | 'profile'; categoryIds: string[]; format?: BundleFormat; tokenLinksEnabled?: boolean; publicLinksEnabled?: boolean; note?: string }) =>
      mutate('/api/bundles', { method: 'POST', body: JSON.stringify(input) }),
    updateBundle: (id: string, input: { name?: string; kind?: 'rules' | 'profile'; categoryIds?: string[]; format?: BundleFormat; tokenLinksEnabled?: boolean; publicLinksEnabled?: boolean; note?: string }) =>
      mutate(`/api/bundles/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    deleteBundle: (id: string) => mutate(`/api/bundles/${id}`, { method: 'DELETE' }),
  };
}
