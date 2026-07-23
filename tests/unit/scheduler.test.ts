import { describe, expect, it } from 'vitest';
import { isSourceDue } from '../../src/lib/sync';

describe('source sync due calculation', () => {
  it('uses the injected time and source interval', () => {
    const now = Date.parse('2026-01-01T01:00:00.000Z');
    expect(isSourceDue({ last_synced_at: '2026-01-01T00:30:01.000Z', sync_interval_minutes: 30 }, false, now)).toBe(false);
    expect(isSourceDue({ last_synced_at: '2026-01-01T00:30:00.000Z', sync_interval_minutes: 30 }, false, now)).toBe(true);
    expect(isSourceDue({ last_synced_at: null, sync_interval_minutes: 60 }, false, now)).toBe(true);
    expect(isSourceDue({ last_synced_at: '2026-01-01T00:00:00.000Z', sync_interval_minutes: 60 }, true, now)).toBe(true);
  });
});
