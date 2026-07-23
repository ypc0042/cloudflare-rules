import { describe, expect, it } from 'vitest';
import packageMetadata from '../../package.json';
import { APP_VERSION } from '../../src/version';

describe('release version', () => {
  it('uses package.json as the runtime source of truth', () => {
    expect(APP_VERSION).toBe(packageMetadata.version);
  });
});
