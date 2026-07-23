import type { ClientLink, RulesData } from './types/domain-rules';
import type { AssetsPort } from './application/ports/assets';
import type { DatabasePort } from './application/ports/database';

export type Env = {
  DB: DatabasePort;
  ASSETS: AssetsPort;
  ADMIN_PASSWORD?: string;
  RULE_TOKEN?: string;
  SESSION_SECRET?: string;
  BASE_URL?: string;
  RUNTIME?: 'cloudflare' | 'node';
  APP_VERSION?: string;
  TRUST_PROXY?: boolean;
};

export type AppVariables = {
  sessionId?: string;
  authType?: 'session' | 'apiKey';
};

export type ApiOk<T> = {
  ok: true;
  data: T;
};

export type CategoriesPayload = {
  data: RulesData;
  links: Record<string, ClientLink[]>;
};
