import type { Env } from '../types';
import type { DomainRule } from '../types/domain-rules';
import { parseBulkImport } from './parser';
import { id } from './slug';
import { getSettings, now } from './db';
import { loadGeositeRules } from './geosite';
import { compactRules } from './rule-compactor';
import { rewriteGithubUrl } from './github-mirror';

type SourceRecord = {
  id: string;
  category_id: string;
  name: string;
  url: string;
  last_synced_at: string | null;
  sync_interval_minutes: number | null;
  user_agent: string | null;
  source_type: 'url' | 'geosite' | 'geoip' | null;
  geosite_name: string | null;
  geoip_name: string | null;
  rule_optimization: 'none' | 'conservative' | 'aggressive' | 'balanced' | null;
  consecutive_failures?: number | null;
  skip_auto_sync_on?: string | null;
};

export type SyncResult = {
  sourceId: string;
  categoryId: string;
  name: string;
  ok: boolean;
  count: number;
  originalCount?: number;
  optimized?: boolean;
  error?: string;
  syncedAt: string;
  /** 使用库内已有规则，未覆盖上游（拉取失败但本地有缓存） */
  usedLocalCache?: boolean;
  consecutiveFailures?: number;
};

const staleSourceError = '来源已删除或所属分类已变更，已取消同步';
/** 自动同步：连续失败达到此次数后，当日不再自动重试 */
const AUTO_FAIL_LIMIT = 3;

const staleSourceResult = (source: SourceRecord, syncedAt: string): SyncResult => ({
  sourceId: source.id,
  categoryId: source.category_id,
  name: source.name,
  ok: false,
  count: 0,
  error: staleSourceError,
  syncedAt,
});

/** YYYY-MM-DD in Asia/Shanghai，用于「今天放弃」判定 */
export function shanghaiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function isSourceDue(source: Pick<SourceRecord, 'last_synced_at' | 'sync_interval_minutes'>, force = false, nowMs = Date.now()) {
  if (force || !source.last_synced_at) return true;
  const lastSync = Date.parse(source.last_synced_at);
  return !Number.isFinite(lastSync) || nowMs - lastSync >= (source.sync_interval_minutes ?? 60) * 60_000;
}

function normalizeUpstreamText(text: string) {
  return text.split(/\r?\n/).map((line) => {
    let value = line.trim().replace(/^﻿/, '');
    if (!value || /^(payload|rules|rule-providers)\s*:/i.test(value)) return '';
    value = value.replace(/^[-]\s*/, '').replace(/^['"]|['"]$/g, '').trim();
    value = value.replace(/^(HOST-SUFFIX|HOST-KEYWORD|HOST),/i, (type) => `${type.toUpperCase() === 'HOST' ? 'DOMAIN' : type.toUpperCase().replace('HOST', 'DOMAIN')},`);
    const parts = value.split(',').map((part) => part.trim());
    if (/^(DOMAIN|DOMAIN-SUFFIX|DOMAIN-KEYWORD|IP-CIDR|SRC-IP-CIDR|IP-ASN|DST-PORT|GEOSITE|GEOIP)$/i.test(parts[0]) && parts.length > 2) {
      value = `${parts[0]},${parts[1]}`;
    }
    return value;
  }).filter(Boolean).join('\n');
}

function ruleStatement(env: Env, source: SourceRecord, rule: DomainRule, index: number) {
  return env.DB.prepare(
    `INSERT OR IGNORE INTO rules (id, category_id, value, type, display_type, note, enabled, sort_order, source_id, created_at, updated_at)
     SELECT ?, category_id, ?, ?, ?, ?, 1, ?, id, ?, ?
     FROM category_sources
     WHERE id = ? AND category_id = ? AND enabled = 1`,
  ).bind(id('rule'), rule.value, rule.type, rule.displayType ?? '', rule.note ?? '', Date.now() + index, rule.createdAt, rule.updatedAt, source.id, source.category_id);
}

async function sourceStillExists(env: Env, source: SourceRecord) {
  return Boolean(await env.DB.prepare('SELECT 1 AS present FROM category_sources WHERE id = ? AND category_id = ? AND enabled = 1').bind(source.id, source.category_id).first());
}

async function countLocalRules(env: Env, sourceId: string) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM rules WHERE source_id = ?').bind(sourceId).first<{ c: number }>();
  return Number(row?.c ?? 0);
}

/**
 * 成功拉取：覆盖写入 rules（本地缓存即 D1 中 source_id 关联的规则），失败计数归零。
 * 失败：不删除已有 rules，保留本地缓存；累计失败次数；自动同步满 3 次则标记当日跳过。
 */
async function syncSource(env: Env, source: SourceRecord, githubMirrorUrl: string, force: boolean): Promise<SyncResult> {
  const syncedAt = now();
  const today = shanghaiDateKey();

  try {
    let text: string;
    if (source.source_type === 'geosite' && source.geosite_name) text = await loadGeositeRules(source.geosite_name, githubMirrorUrl);
    else if (source.source_type === 'geoip' && source.geoip_name) {
      const textUrl = `https://raw.githubusercontent.com/Loyalsoldier/geoip/release/text/${encodeURIComponent(source.geoip_name)}.txt`;
      const response = await fetch(rewriteGithubUrl(textUrl, githubMirrorUrl), { headers: { accept: 'text/plain' } });
      if (!response.ok) throw new Error(`GeoIP ${source.geoip_name} 返回 HTTP ${response.status}`);
      const networks = (await response.text()).split(/\s+/).map((value) => value.trim()).filter(Boolean);
      text = networks.map((network) => `IP-CIDR,${network}`).join('\n');
    } else {
      const response = await fetch(rewriteGithubUrl(source.url, githubMirrorUrl), {
        headers: {
          accept: 'text/plain, application/yaml, application/json;q=0.8',
          'user-agent': source.user_agent || 'clash-verge/v2.5.1',
        },
      });
      if (!response.ok) throw new Error(`上游返回 HTTP ${response.status}`);
      text = await response.text();
    }
    if (text.length > 5_000_000) throw new Error('上游文件超过 5MB 限制');
    const preview = parseBulkImport(source.source_type === 'geosite' || source.source_type === 'geoip' ? text : normalizeUpstreamText(text), []);
    if (!preview.rules.length) throw new Error('未从上游识别出有效规则');
    const originalCount = preview.rules.length;
    const optimization = source.rule_optimization === 'balanced' ? 'aggressive' : source.rule_optimization;
    const optimized = source.source_type === 'url' && (optimization === 'conservative' || optimization === 'aggressive');
    const syncedRules = optimized ? compactRules(preview.rules, optimization).rules : preview.rules;
    if (!await sourceStillExists(env, source)) return staleSourceResult(source, syncedAt);

    // 成功：用最新内容覆盖本地缓存（rules 表）
    await env.DB.prepare('DELETE FROM rules WHERE source_id = ?').bind(source.id).run();
    for (let offset = 0; offset < syncedRules.length; offset += 80) {
      await env.DB.batch(syncedRules.slice(offset, offset + 80).map((rule, index) => ruleStatement(env, source, rule, offset + index)));
    }
    if (!await sourceStillExists(env, source)) return staleSourceResult(source, syncedAt);
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE category_sources SET last_synced_at = ?, last_status = 'success', last_count = ?, last_original_count = ?,
         last_error = NULL, consecutive_failures = 0, skip_auto_sync_on = NULL, updated_at = ?
         WHERE id = ? AND category_id = ?`,
      ).bind(syncedAt, syncedRules.length, originalCount, syncedAt, source.id, source.category_id),
      env.DB.prepare('UPDATE categories SET updated_at = ? WHERE id = ?').bind(syncedAt, source.category_id),
    ]);
    return {
      sourceId: source.id,
      categoryId: source.category_id,
      name: source.name,
      ok: true,
      count: syncedRules.length,
      originalCount,
      optimized,
      syncedAt,
      consecutiveFailures: 0,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '同步失败';
    const prevFails = Number(source.consecutive_failures ?? 0);
    const nextFails = prevFails + 1;
    const localCount = await countLocalRules(env, source.id);
    // 满 3 次且非手动强制：标记「今天」不再自动拉；手动 force 仍会尝试但不因 skip 被挡在入口
    const skipToday = !force && nextFails >= AUTO_FAIL_LIMIT ? today : (source.skip_auto_sync_on ?? null);

    // 失败绝不 DELETE 已有 rules → 订阅/导出继续用本地缓存
    await env.DB.prepare(
      `UPDATE category_sources SET last_synced_at = ?, last_status = 'error', last_error = ?,
       consecutive_failures = ?, skip_auto_sync_on = ?, updated_at = ? WHERE id = ?`,
    ).bind(syncedAt, message.slice(0, 500), nextFails, skipToday, syncedAt, source.id).run();

    const usingCache = localCount > 0;
    return {
      sourceId: source.id,
      categoryId: source.category_id,
      name: source.name,
      ok: false,
      count: localCount,
      error: usingCache
        ? `${message}（已保留本地 ${localCount} 条规则${nextFails >= AUTO_FAIL_LIMIT && !force ? '；今日自动同步将暂停' : ''}）`
        : message,
      syncedAt,
      usedLocalCache: usingCache,
      consecutiveFailures: nextFails,
    };
  }
}

export async function syncRuleSources(env: Env, categoryId?: string, force = true) {
  const { githubMirrorUrl } = await getSettings(env);
  const query = categoryId
    ? env.DB.prepare(
      `SELECT id, category_id, name, url, last_synced_at, sync_interval_minutes, user_agent, source_type, geosite_name, geoip_name,
        rule_optimization, consecutive_failures, skip_auto_sync_on
       FROM category_sources WHERE enabled = 1 AND category_id = ?`,
    ).bind(categoryId)
    : env.DB.prepare(
      `SELECT id, category_id, name, url, last_synced_at, sync_interval_minutes, user_agent, source_type, geosite_name, geoip_name,
        rule_optimization, consecutive_failures, skip_auto_sync_on
       FROM category_sources WHERE enabled = 1`,
    );
  const sources = await query.all<SourceRecord>();
  const results: SyncResult[] = [];
  const today = shanghaiDateKey();
  const nowMs = Date.now();

  for (const source of sources.results ?? []) {
    // 跨日：清空「今日跳过」与失败计数，重新给上游机会
    if (source.skip_auto_sync_on && source.skip_auto_sync_on !== today) {
      await env.DB.prepare(
        'UPDATE category_sources SET skip_auto_sync_on = NULL, consecutive_failures = 0, updated_at = ? WHERE id = ?',
      ).bind(now(), source.id).run();
      source.skip_auto_sync_on = null;
      source.consecutive_failures = 0;
    }

    if (!force) {
      // 自动同步：当日已因连续失败放弃则跳过
      if (source.skip_auto_sync_on === today) continue;
      if (!isSourceDue(source, false, nowMs)) continue;
    }

    results.push(await syncSource(env, source, githubMirrorUrl, force));
  }
  return results;
}
