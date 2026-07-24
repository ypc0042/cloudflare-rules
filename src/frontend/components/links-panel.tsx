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
type Tab = 'rules' | 'profiles';

const FORMAT_OPTIONS: { id: BundleFormat; title: string; suffix: string; description: string }[] = [
  { id: 'yaml', title: 'YAML 规则集', suffix: '.yaml', description: 'Mihomo / Clash rule-provider' },
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
  const [tab, setTab] = useState<Tab>('rules');
  const [selectedId, setSelectedId] = useState('');
  const [wizard, setWizard] = useState<null | 'rules' | 'profile'>(null);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
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

  const allBundles = api.bundles ?? [];
  const ruleBundles = allBundles.filter((item) => (item.kind ?? 'rules') !== 'profile');
  const profileBundles = allBundles.filter((item) => item.kind === 'profile');

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
    { id: 'txt', title: '纯地址列表', suffix: '.txt', description: '仅保留域名与 IP', tone: 'blue', link: selectedLinks.find((link) => link.id === 'url') },
    { id: 'json', title: 'JSON 数据', suffix: '.json', description: '结构化规则数据', tone: 'orange', link: selectedLinks.find((link) => link.id === 'json') },
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
    if (!url) { onToast('当前没有可用的链接'); return; }
    await copyText(preferHttpsLink(url));
    onToast('链接已复制');
  }

  async function setAccess(policy: AccessPolicy) {
    if (!selectedCategory) return;
    await api.updateCategory(selectedCategory.id, { tokenLinksEnabled: policy === 'token', publicLinksEnabled: policy === 'public' });
    onToast('访问策略已更新');
  }

  function openWizard(kind: 'rules' | 'profile') {
    setCheckedIds([]);
    setBundleName('');
    setBundleFormat('yaml');
    setBundleAccess('token');
    setWizard(kind);
  }

  async function saveWizard() {
    if (!wizard) return;
    if (!checkedIds.length) { onToast('请至少选择一个规则'); return; }
    setSaving(true);
    try {
      await api.createBundle({
        kind: wizard === 'profile' ? 'profile' : 'rules',
        name: bundleName.trim() || undefined,
        categoryIds: checkedIds,
        format: wizard === 'profile' ? 'yaml' : bundleFormat,
        tokenLinksEnabled: bundleAccess === 'token',
        publicLinksEnabled: bundleAccess === 'public',
      });
      setWizard(null);
      setCheckedIds([]);
      setTab(wizard === 'profile' ? 'profiles' : 'rules');
      onToast(wizard === 'profile' ? '订阅集已保存' : '合并规则集已保存');
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
        kind: editingBundle.kind,
        categoryIds: editCategoryIds,
        format: editingBundle.kind === 'profile' ? 'yaml' : editFormat,
        tokenLinksEnabled: editAccess === 'token',
        publicLinksEnabled: editAccess === 'public',
      });
      setEditingBundle(null);
      onToast('已更新');
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '更新失败');
    } finally {
      setSaving(false);
    }
  }

  async function removeBundle(bundle: SubscriptionBundle) {
    if (!window.confirm(`确定删除「${bundle.name}」？`)) return;
    try {
      await api.deleteBundle(bundle.id);
      onToast('已删除');
    } catch (cause) {
      onToast(cause instanceof Error ? cause.message : '删除失败');
    }
  }

  // —— 单分类规则集详情 ——
  if (selectedCategory) {
    const privateAccess = selectedCategory.tokenLinksEnabled !== false;
    const publicAccess = selectedCategory.publicLinksEnabled !== false;
    const accessPolicy: AccessPolicy = privateAccess ? 'token' : publicAccess ? 'public' : 'disabled';
    return <div className="page-stack unified-page">
      <header className="page-title detail-title"><div><button className="back-button" onClick={() => setSelectedId('')}><UiIcon name="arrowLeft" size={20}/>返回订阅中心</button><div className="detail-name"><CategoryIcon icon={selectedCategory.icon} name={selectedCategory.name} size={58}/><span><h1>{selectedCategory.name}</h1><p>单条规则集 · 选择格式后复制链接</p></span></div></div></header>
      <section className="soft-card unified-card subscription-access-card"><div><span className="metric-icon blue"><UiIcon name="settings"/></span><span><h2>访问策略</h2><p>只影响本规则集</p></span></div><select className="app-input access-policy-select" value={accessPolicy} onChange={(event) => setAccess(event.target.value as AccessPolicy)}><option value="token">私密访问（带密钥）</option><option value="public">公开访问</option><option value="disabled">禁止访问</option></select></section>
      <div className="format-link-grid">{formats.map((format) => <section className="format-link-card" key={format.id}><div className="format-link-head"><span className={`metric-icon ${format.tone}`}><UiIcon name="file"/></span><code>{format.suffix}</code></div><h2>{format.title}</h2><p>{format.description}</p><span className="format-file-name">{format.link?.fileName}</span><button className="primary-action icon-action" disabled={!format.link?.recommendedUrl} onClick={() => copy(format.link)}><UiIcon name="copy" size={17}/>复制链接</button></section>)}</div>
    </div>;
  }

  function renderCategoryPicker() {
    return (
      <div className="bundle-edit-categories wizard-categories">
        <div className="section-inline" style={{ marginBottom: 8 }}>
          <button type="button" className="subtle-action" onClick={toggleAll}>{allChecked ? '取消全选' : '全选'}</button>
          <small>已选 {checkedIds.length} 个</small>
        </div>
        {sortedCategories.map((category) => (
          <label key={category.id} className="bundle-edit-item">
            <input type="checkbox" checked={checkedIds.includes(category.id)} onChange={() => toggleCheck(category.id)} />
            <CategoryIcon icon={category.icon} name={category.name} size={28} />
            <span>{category.name}<small style={{ display: 'block', opacity: 0.7 }}>{category.enabledRuleCount ?? category.rules.filter((r) => r.enabled).length} 条</small></span>
          </label>
        ))}
      </div>
    );
  }

  function renderSavedList(items: SubscriptionBundle[], empty: string) {
    if (!items.length) return <div className="empty-hint"><p>{empty}</p></div>;
    return (
      <div className="category-summary-grid subscription-categories">
        {items.map((bundle) => {
          const policy = policyLabel(bundle.tokenLinksEnabled, bundle.publicLinksEnabled);
          return (
            <div className="category-summary-card bundle-card" key={bundle.id}>
              <div className="bundle-card-main">
                <span className={`metric-icon ${bundle.kind === 'profile' ? 'orange' : 'purple'}`}><UiIcon name={bundle.kind === 'profile' ? 'download' : 'links'}/></span>
                <span>
                  <strong>{bundle.name}</strong>
                  <small>
                    {bundle.categoryNames?.join('、') || `${bundle.categoryIds.length} 个规则`}
                    {bundle.kind === 'profile' ? ' · 完整模板' : ` · ${bundle.format.toUpperCase()}`}
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
    );
  }

  return <div className="page-stack unified-page">
    <header className="page-title"><div><span className="eyebrow">SUBSCRIPTIONS</span><h1>订阅中心</h1><p>规则集只含规则；订阅集是完整 Clash 模板（节点在模板内自行填写或客户端导入）</p></div></header>

    <div className="subscription-tabs">
      <button type="button" className={tab === 'rules' ? 'active' : ''} onClick={() => setTab('rules')}>规则集</button>
      <button type="button" className={tab === 'profiles' ? 'active' : ''} onClick={() => setTab('profiles')}>订阅集</button>
    </div>

    {tab === 'rules' ? (
      <>
        <section className="soft-card unified-card">
          <div className="section-inline sort-section-head">
            <div><h2>全部规则（单条规则集）</h2><p>无需新建，点进即可复制该规则的订阅链接</p></div>
            <SortToolbar value={sortKey} direction={sortDirection} onChange={(key, direction) => { setSortKey(key); setSortDirection(direction); }}/>
          </div>
          <div className="category-summary-grid subscription-categories sort-content-transition" key={`${sortKey}-${sortDirection}`}>
            {sortedCategories.map((category) => {
              const policy = policyLabel(category.tokenLinksEnabled, category.publicLinksEnabled);
              return (
                <button className="category-summary-card" key={category.id} type="button" onClick={() => setSelectedId(category.id)}>
                  <CategoryIcon icon={category.icon} name={category.name}/>
                  <span><strong>{category.name}</strong><small>{category.enabledRuleCount ?? category.rules.filter((rule) => rule.enabled).length} 条启用</small></span>
                  <span className={`access-policy-badge ${policy === '已禁用' ? 'disabled' : ''}`}>{policy}</span>
                  <UiIcon name="chevronRight" size={19}/>
                </button>
              );
            })}
          </div>
        </section>

        <section className="soft-card unified-card">
          <div className="section-inline sort-section-head">
            <div><h2>合并规则集</h2><p>多选规则合成一个规则链接（仍是规则集合，不是完整配置）</p></div>
            <button type="button" className="primary-action icon-action" onClick={() => openWizard('rules')}><UiIcon name="plus" size={17}/>新建合并规则集</button>
          </div>
          {renderSavedList(ruleBundles, '还没有合并规则集。需要「多合一」时再点新建。')}
        </section>
      </>
    ) : (
      <section className="soft-card unified-card">
        <div className="section-inline sort-section-head">
          <div>
            <h2>订阅集（完整 Clash 模板）</h2>
            <p>含策略组与分流；模板内预留机场订阅 URL 位置；内置 DIRECT / REJECT；节点可后导入</p>
          </div>
          <button type="button" className="primary-action icon-action" onClick={() => openWizard('profile')}><UiIcon name="plus" size={17}/>新建订阅集</button>
        </div>
        {renderSavedList(profileBundles, '还没有订阅集。点「新建订阅集」选择规则后生成完整模板。')}
      </section>
    )}

    {wizard ? (
      <div className="modal-backdrop" role="presentation" onClick={() => !saving && setWizard(null)}>
        <div className="modal-card soft-card" role="dialog" onClick={(event) => event.stopPropagation()}>
          <h2>{wizard === 'profile' ? '新建订阅集' : '新建合并规则集'}</h2>
          <p>{wizard === 'profile' ? '选择要参与分流的规则，将生成完整 Clash 模板链接。' : '选择多个规则，合并为一个规则集链接。'}</p>
          <label className="field-label">名称</label>
          <input className="app-input" placeholder="默认规则" value={bundleName} onChange={(event) => setBundleName(event.target.value)} />
          {wizard === 'rules' ? (
            <>
              <label className="field-label">格式</label>
              <select className="app-input" value={bundleFormat} onChange={(event) => setBundleFormat(event.target.value as BundleFormat)}>
                {FORMAT_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.title}（{item.suffix}）</option>)}
              </select>
            </>
          ) : (
            <p className="empty-hint" style={{ margin: 0 }}>格式固定为完整 YAML 配置模板</p>
          )}
          <label className="field-label">访问方式</label>
          <select className="app-input" value={bundleAccess} onChange={(event) => setBundleAccess(event.target.value as 'token' | 'public')}>
            <option value="token">私密（带密钥）</option>
            <option value="public">公开</option>
          </select>
          <label className="field-label">选择规则</label>
          {renderCategoryPicker()}
          <div className="modal-actions">
            <button type="button" className="subtle-action" disabled={saving} onClick={() => setWizard(null)}>取消</button>
            <button type="button" className="primary-action" disabled={saving || !checkedIds.length} onClick={saveWizard}>{saving ? '保存中…' : '保存'}</button>
          </div>
        </div>
      </div>
    ) : null}

    {editingBundle ? (
      <div className="modal-backdrop" role="presentation" onClick={() => !saving && setEditingBundle(null)}>
        <div className="modal-card soft-card" role="dialog" onClick={(event) => event.stopPropagation()}>
          <h2>编辑{editingBundle.kind === 'profile' ? '订阅集' : '合并规则集'}</h2>
          <label className="field-label">名称</label>
          <input className="app-input" value={editName} onChange={(event) => setEditName(event.target.value)} />
          {editingBundle.kind !== 'profile' ? (
            <>
              <label className="field-label">格式</label>
              <select className="app-input" value={editFormat} onChange={(event) => setEditFormat(event.target.value as BundleFormat)}>
                {FORMAT_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
            </>
          ) : null}
          <label className="field-label">访问方式</label>
          <select className="app-input" value={editAccess} onChange={(event) => setEditAccess(event.target.value as AccessPolicy)}>
            <option value="token">私密</option>
            <option value="public">公开</option>
            <option value="disabled">禁止</option>
          </select>
          <label className="field-label">包含的规则</label>
          <div className="bundle-edit-categories">
            {data.categories.map((category) => (
              <label key={category.id} className="bundle-edit-item">
                <input type="checkbox" checked={editCategoryIds.includes(category.id)} onChange={() => setEditCategoryIds((prev) => (prev.includes(category.id) ? prev.filter((id) => id !== category.id) : [...prev, category.id]))} />
                <span>{category.name}</span>
              </label>
            ))}
          </div>
          <div className="modal-actions">
            <button type="button" className="subtle-action" disabled={saving} onClick={() => setEditingBundle(null)}>取消</button>
            <button type="button" className="primary-action" disabled={saving} onClick={saveEditBundle}>{saving ? '保存中…' : '保存'}</button>
          </div>
        </div>
      </div>
    ) : null}
  </div>;
}
