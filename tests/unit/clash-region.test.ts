import { describe, expect, it } from 'vitest';
import { OTHER_REGION_NAME, assignRegion, buildFilterPattern, keywordMatches } from '../../src/lib/clash-profile';

describe('clash region assignment', () => {
  it('puts voll-kr-id12345 in Korea only (not HK, not other)', () => {
    expect(assignRegion('voll-kr-id12345')).toBe('🇰🇷 韩国');
  });

  it('prefers Korea over Hong Kong when both tokens appear', () => {
    expect(assignRegion('hk-kr-relay-01')).toBe('🇰🇷 韩国');
    expect(assignRegion('香港中转-韩国落地')).toBe('🇰🇷 韩国');
  });

  it('classifies common regions by name', () => {
    expect(assignRegion('HK-IEPL-01')).toBe('🇭🇰 香港');
    expect(assignRegion('日本-东京-01')).toBe('🇯🇵 日本');
    expect(assignRegion('sg-premium-1')).toBe('🇸🇬 新加坡');
    expect(assignRegion('my-01-kuala')).toBe('🇲🇾 马来西亚');
    expect(assignRegion('TW-台北')).toBe('🇹🇼 台湾');
    expect(assignRegion('USA-LAX-1')).toBe('🇺🇸 美国');
  });

  it('sends unrecognized names to 其他地区', () => {
    expect(assignRegion('random-node-99')).toBe(OTHER_REGION_NAME);
    expect(assignRegion('voll-xx-id999')).toBe(OTHER_REGION_NAME);
    expect(assignRegion('premium-special')).toBe(OTHER_REGION_NAME);
  });

  it('does not let bare us match inside plus', () => {
    expect(keywordMatches('plus-node-1', 'us')).toBe(false);
    expect(keywordMatches('us-west-1', 'us')).toBe(true);
  });

  it('buildFilterPattern is non-empty and case-insensitive flag present', () => {
    const p = buildFilterPattern(['kr', '韩']);
    expect(p.startsWith('(?i)')).toBe(true);
    expect(p).toContain('kr');
  });
});
