import { useMemo, useState } from 'react';
import type { BundleFormat, ClientLink, RulesData, SubscriptionBundle } from '../../types/domain-rules';
import type { useDomainAdmin } from '../hooks/use-domain-admin';
import { copyText } from '../lib/clipboard';
import { preferHttpsLink } from '../lib/links';
import { CategoryIcon } from './category-icon';
import { SortToolbar, sortCategoryEntries, usePersistentSort } from './sort-toolbar';
import { UiIcon } from './ui-icon';

type FormatLink = { id: string; title: string; suffix: string; description: string; tone: string; link?: ClientLink };
type AccessPolicy = 'token' | 'public' | 'disabled';

const FORMAT_OPTIONS: { id: BundleFormat; title: string; suffix: string; description: string }[] = [
  { id: 'yaml', title: 'YAML 规则集', suffix: '.yaml', description: 'Mihomo / Clash / OpenClash / Stash' },
  { id: 'list', title: 'LIST 规则集', suffix: '.list', description: 'Loon / Surge / Shadowrocket 等' },
  { id: 'txt', title: '纯地址列表', suffix: '.txt', description: '仅域名与 IP' },
  { id: 'json', title: 'JSON 数据', suffix: '.json', description: '结构化数据' },
];

function policyLabel(token?: boolean, pub?: boolean) {
  if (token !== false) return '私密';
  if (pub !== false) return '公开';
  return '已禁用';
}

export function LinksPanel({ api, data, links, onToast }: { api: ReturnType<typeof useDomainAdmin>; data: RulesData; links: Record<string, ClientLink[]>; onToast: (message: string) => void }) {
  const [selectedId, setSelectedId] = useState('');
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [bundleName, setBundleName] = useState('');
  const [bundleFormat, setBundleFormat] = useState<BundleFormat>('yaml');
  const [bundleAccess, setBundleAccess] = useState<'token' | 'public'>('token');
  const [saving, setSaving] = useState(false);
  const [editingBundle, setEditingBundle] = useState<SubscriptionBundle | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategoryIds, setEditCategoryIds] = useState<string[]>([]);
  const [editFormat, setEditFormat] = useState<BundleFormat>('yaml');
  const [editAccess, setEditAccess] = useState<'token' | 'public' | 'disabled'>('token');
  const { value: sortKey, direction: sortDirection, setValue: setSortKey, setDirection: setSortDirection } = usePersistentSort('subscriptions');

  const bundles = api.bundles ?? [];
  const selectedCategory = data.categories.find((category) => category.id === selectedId);
  const selectedLinks = selectedId ? links[selectedId] ?? [] : [];
  const sortedCategories = sortCategoryEntries(
    data.categories.map((category) => ({ category, count: category.ruleCount ?? category.rules.length })),
    sortKey,
    sortDirection,
  ).map((entry) => entry.category);

  const allChecked = sortedCategories.length > 0 && checkedIds.length === sortedCategories.length;
  const formats = useMemo<FormatLink[]>(() => [
    { id: 'yaml', title: 'YAML 规则集', suffix: '.yaml', description: '适用于 Mihomo、Clash、OpenClash 与 Stash', tone: 'cyan', link: selectedLinks.find((link) => link.id === 'mihomo') },
    { id: 'list', title: 'LIST 规则集', suffix: '.list', description: '适用于 Loon、Surge、Shadowrocket 与 Egern', tone: 'purple', link: selectedLinks.find((link) => link.id === 'general') },
    { id: 'txt', title: '纯地址列表', suffix: '.txt', description: '仅保留域名与 IP，方便脚本或其他工具继续处理', tone: 'blue', link: selectedLinks.find((link) => link.id === 'url') },
    { id: 'json', title: 'JSON 数据', suffix: '.json', description: '保留结构化规则数据，适合二次开发和自动化', tone: 'orange', link: selectedLinks.find((link) => link.id === 'json') },
  ], [selectedLinks]);

  function toggleCheck(id: string) {
    setCheckedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  function toggleAll() {
    if (allChecked) setCheckedIds([]);
    else setCheckedIds(sortedCategories.map((category) => category.id));
  }

  async function copy(link?: ClientLink | string) {
    const url = typeof link === 'string' ? link : link?.recommendedUrl;
    if (!url) { onToast('此规则当前未开放可用的订阅链接'); return; }
    await copyText(preferHttpsLink(url));
    onToast('订阅链接已复制');
  }

  async function setAccess(policy: AccessPolicy) {
    if (!selectedCategory) return;
    await api.updateCategory(selectedCategory.id, { tokenLinksEnabled: policy === 'token', publicLinksEnabled: policy === 'public' });
    onToast('规则访问策略已更新');
  }

  function openWizard() {
    if (!checkedIds.length) { onToast('请先勾选至少一个规则'); return; }
    setBundleName('');
    setBundleFormat('yaml');
    setBundleAccess('token');
    setWizardOpen(true);
  }

  async function saveBundle() {
    if (!checkedIds.length) return;
    setSaving(true);
    try {
      await api.createBundle({
        name: bundleName.trim() || undefined,
        categoryIds: checkedIds,
        format: bundleFormat,
        tokenLinksEnabled: bundleAccess === 'token',
        publicLinksEnabled: bundleAccess === 'public',
      });
      setWizardOpen(false);
      setCheckedIds([]);
      onToast('合并订阅已保存');
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  function openEditBundle(bundle: SubscriptionBundle) {
    setEditingBundle(bundle);
    setEditName(bundle.name);
    setEditCategoryIds([...bundle.categoryIds]);
    setEditFormat(bundle.format);
    setEditAccess(bundle.tokenLinksEnabled !== false ? 'token' : bundle.publicLinksEnabled ? 'public' : 'disabled');
  }

  async function saveEditBundle() {
    if (!editingBundle) return;
    if (!editCategoryIds.length) { onToast('请至少选择一个规则'); return; }
    setSaving(true);
    try {
      await api.updateBundle(editingBundle.id, {
        name: editName.trim() || '默认规则',
        categoryIds: editCategoryIds,
        format: editFormat,
        tokenLinksEnabled: editAccess === 'token',
        publicLinksEnabled: editAccess === 'public',
      });
      setEditingBundle(null);
      onToast('订阅已更新');
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '更新失败');
    } finally {
      setSaving(false);
    }
  }

  async function removeBundle(bundle: SubscriptionBundle) {
    if (!window.confirm(`确定删除合并订阅「${bundle.name}」？`)) return;
    try {
      await api.deleteBundle(bundle.id);
      onToast('已删除');
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '删除失败');
    }
  }

  // —— 单分类详情（保持原有行为）——
  if (selectedCategory) {
    const privateAccess = selectedCategory.tokenLinksEnabled !== false;
    const publicAccess = selectedCategory.publicLinksEnabled !== false;
    const accessPolicy: AccessPolicy = privateAccess ? 'token' : publicAccess ? 'public' : 'disabled';
    return <div className="page-stack unified-page">
      <header className="page-title detail-title"><div><button className="back-button" onClick={() => setSelectedId('')}><UiIcon name="arrowLeft" size={20}/>返回订阅中心</button><div className="detail-name"><CategoryIcon icon={selectedCategory.icon} name={selectedCategory.name} size={58}/><span><h1>{selectedCategory.name} 订阅</h1><p>选择文件后缀后复制地址，同系列客户端可以共用</p></span></div></div></header>
      <section className="soft-card unified-card subscription-access-card"><div><span className="metric-icon blue"><UiIcon name="settings"/></span><span><h2>规则访问策略</h2><p>只影响 {selectedCategory.name} 的订阅链接</p></span></div><select className="app-input access-policy-select" value={accessPolicy} onChange={(event) => setAccess(event.target.value as AccessPolicy)}><option value="token">私密访问（带密钥）</option><option value="public">公开访问</option><option value="disabled">禁止访问</option></select></section>
      <div className="access-banner"><span><UiIcon name="info" size={19}/>{privateAccess ? '优先使用私密地址' : publicAccess ? '当前使用公开地址' : '当前未开放订阅访问'}</span><small>系统会根据当前访问策略自动选择可用地址</small></div>
      <div className="format-link-grid">{formats.map((format) => <section className="format-link-card" key={format.id}><div className="format-link-head"><span className={`metric-icon ${format.tone}`}><UiIcon name="file"/></span><code>{format.suffix}</code></div><h2>{format.title}</h2><p>{format.description}</p><span className="format-file-name">{format.link?.fileName}</span><button className="primary-action icon-action" disabled={!format.link?.recommendedUrl} onClick={() => copy(format.link)}><UiIcon name="copy" size={17}/>复制订阅链接</button></section>)}</div>
    </div>;
  }

  // —— 订阅中心首页 ——
  return <div className="page-stack unified-page">
    <header className="page-title"><div><span className="eyebrow">SUBSCRIPTIONS</span><h1>订阅中心</h1><p>可单独复制某个规则，也可多选打包成一个链接</p></div></header>

    <section className="soft-card unified-card">
      <div className="section-inline sort-section-head">
        <div><h2>选择规则</h2><p>勾选多个规则后可一键导出合并订阅；点右侧进入单条复制</p></div>
        <div className="section-inline" style={{ gap: 10 }}>
          <button type="button" className="subtle-action" onClick={toggleAll}>{allChecked ? '取消全选' : '全选'}</button>
          <button type="button" className="primary-action icon-action" disabled={!checkedIds.length} onClick={openWizard}><UiIcon name="links" size={17}/>一键导出{checkedIds.length ? `（${checkedIds.length}）` : ''}</button>
          <SortToolbar value={sortKey} direction={sortDirection} onChange={(key, direction) => { setSortKey(key); setSortDirection(direction); }}/>
        </div>
      </div>
      <div className="category-summary-grid subscription-categories sort-content-transition" key={`${sortKey}-${sortDirection}`}>
        {sortedCategories.map((category) => {
          const policy = policyLabel(category.tokenLinksEnabled, category.publicLinksEnabled);
          const checked = checkedIds.includes(category.id);
          return (
            <div className={`category-summary-card subscription-select-card ${checked ? 'selected' : ''}`} key={category.id}>
              <label className="subscription-check" onClick={(event) => event.stopPropagation()}>
                <input type="checkbox" checked={checked} onChange={() => toggleCheck(category.id)} />
              </label>
              <button type="button" className="subscription-open-detail" onClick={() => setSelectedId(category.id)}>
                <CategoryIcon icon={category.icon} name={category.name}/>
                <span><strong>{category.name}</strong><small>{category.enabledRuleCount ?? category.rules.filter((rule) => rule.enabled).length} 条启用规则</small></span>
                <span className={`access-policy-badge ${policy === '已禁用' ? 'disabled' : ''}`}>{policy}</span>
                <UiIcon name="chevronRight" size={19}/>
              </button>
            </div>
          );
        })}
      </div>
    </section>

    <section className="soft-card unified-card">
      <div className="section-inline sort-section-head">
        <div>
          <h2>已保存的合并订阅</h2>
          <p>多个规则合为一个链接；内容会随成员规则自动更新（远程源按各自间隔同步）</p>
        </div>
      </div>
      {!bundles.length ? (
        <div className="empty-hint"><p>还没有合并订阅。在上方勾选规则后点「一键导出」即可创建。</p></div>
      ) : (
        <div className="category-summary-grid subscription-categories">
          {bundles.map((bundle) => {
            const policy = policyLabel(bundle.tokenLinksEnabled, bundle.publicLinksEnabled);
            return (
              <div className="category-summary-card bundle-card" key={bundle.id}>
                <div className="bundle-card-main">
                  <span className="metric-icon purple"><UiIcon name="links"/></span>
                  <span>
                    <strong>{bundle.name}</strong>
                    <small>
                      {bundle.categoryNames?.join('、') || `${bundle.categoryIds.length} 个规则`}
                      {' · '}
                      {bundle.format.toUpperCase()}
                      {bundle.lastSyncedAt ? ` · 成员同步 ${new Date(bundle.lastSyncedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}
                    </small>
                  </span>
                  <span className={`access-policy-badge ${policy === '已禁用' ? 'disabled' : ''}`}>{policy}</span>
                </div>
                <div className="bundle-card-actions">
                  <button type="button" className="primary-action icon-action" disabled={!bundle.recommendedUrl} onClick={() => copy(bundle.recommendedUrl)}><UiIcon name="copy" size={16}/>复制链接</button>
                  <button type="button" className="subtle-action" onClick={() => openEditBundle(bundle)}>编辑</button>
                  <button type="button" className="danger-action" onClick={() => removeBundle(bundle)}>删除</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>

    {wizardOpen ? (
      <div className="modal-backdrop" role="presentation" onClick={() => !saving && setWizardOpen(false)}>
        <div className="modal-card soft-card" role="dialog" onClick={(event) => event.stopPropagation()}>
          <h2>保存合并订阅</h2>
          <p>已选 {checkedIds.length} 个规则，将合并为一个链接（规则去重）。不填名称则使用「默认规则」。</p>
          <label className="field-label">名称</label>
          <input className="app-input" placeholder="默认规则" value={bundleName} onChange={(event) => setBundleName(event.target.value)} />
          <label className="field-label">格式</label>
          <select className="app-input" value={bundleFormat} onChange={(event) => setBundleFormat(event.target.value as BundleFormat)}>
            {FORMAT_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.title}（{item.suffix}）</option>)}
          </select>
          <label className="field-label">访问方式</label>
          <select className="app-input" value={bundleAccess} onChange={(event) => setBundleAccess(event.target.value as 'token' | 'public')}>
            <option value="token">私密（带密钥）</option>
            <option value="public">公开</option>
          </select>
          <div className="modal-actions">
            <button type="button" className="subtle-action" disabled={saving} onClick={() => setWizardOpen(false)}>取消</button>
            <button type="button" className="primary-action" disabled={saving} onClick={saveBundle}>{saving ? '保存中…' : '保存订阅'}</button>
          </div>
        </div>
      </div>
    ) : null}

    {editingBundle ? (
      <div className="modal-backdrop" role="presentation" onClick={() => !saving && setEditingBundle(null)}>
        <div className="modal-card soft-card" role="dialog" onClick={(event) => event.stopPropagation()}>
          <h2>编辑合并订阅</h2>
          <label className="field-label">名称</label>
          <input className="app-input" value={editName} onChange={(event) => setEditName(event.target.value)} />
          <label className="field-label">格式</label>
          <select className="app-input" value={editFormat} onChange={(event) => setEditFormat(event.target.value as BundleFormat)}>
            {FORMAT_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.title}（{item.suffix}）</option>)}
          </select>
          <label className="field-label">访问方式</label>
          <select className="app-input" value={editAccess} onChange={(event) => setEditAccess(event.target.value as AccessPolicy)}>
            <option value="token">私密（带密钥）</option>
            <option value="public">公开</option>
            <option value="disabled">禁止访问</option>
          </select>
          <label className="field-label">包含的规则</label>
          <div className="bundle-edit-categories">
            {data.categories.map((category) => (
              <label key={category.id} className="bundle-edit-item">
                <input
                  type="checkbox"
                  checked={editCategoryIds.includes(category.id)}
                  onChange={() => setEditCategoryIds((prev) => (prev.includes(category.id) ? prev.filter((id) => id !== category.id) : [...prev, category.id]))}
                />
                <span>{category.name}</span>
              </label>
            ))}
          </div>
          <div className="modal-actions">
            <button type="button" className="subtle-action" disabled={saving} onClick={() => setEditingBundle(null)}>取消</button>
            <button type="button" className="primary-action" disabled={saving} onClick={saveEditBundle}>{saving ? '保存中…' : '保存修改'}</button>
          </div>
        </div>
      </div>
    ) : null}
  </div>;
}
