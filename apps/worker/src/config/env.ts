/**
 * Worker env — TypeBox validated, fail-fast on boot. The worker enforces
 * the same DATABASE_URL role-guard discipline as the API (Day 16 audit A-2):
 * the URL MUST point at `warehouse14_worker` or the process refuses to start.
 */

import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const NodeEnv = Type.Union(
  [Type.Literal('development'), Type.Literal('test'), Type.Literal('production')],
  { default: 'development' },
);

const LogLevel = Type.Union(
  [
    Type.Literal('fatal'),
    Type.Literal('error'),
    Type.Literal('warn'),
    Type.Literal('info'),
    Type.Literal('debug'),
    Type.Literal('trace'),
  ],
  { default: 'info' },
);

const EnvSchema = Type.Object({
  NODE_ENV: NodeEnv,
  LOG_LEVEL: LogLevel,
  /** Prometheus-scrape + readiness probe HTTP port. Default 3100 (API uses 3000). */
  METRICS_PORT: Type.Integer({ minimum: 0, maximum: 65535, default: 3100 }),
  DATABASE_URL: Type.String({
    minLength: 1,
    description: 'postgres:// URL for the warehouse14_worker role',
  }),
  DB_POOL_MAX: Type.Integer({ minimum: 1, maximum: 50, default: 5 }),

  /** Per-job runner config — operator overrides via env if needed. */
  WORKER_DEFAULT_MAX_RETRIES: Type.Integer({ minimum: 1, maximum: 100, default: 5 }),
  WORKER_DEFAULT_TIMEOUT_MS: Type.Integer({
    minimum: 1_000,
    maximum: 30 * 60_000,
    default: 5 * 60_000,
  }),

  /**
   * Metal-price provider selection (Epic A). `mock` is the zero-config
   * dev/demo default; production should set a real vendor + key.
   */
  METAL_PRICE_PROVIDER: Type.Union(
    [
      Type.Literal('mock'),
      Type.Literal('json_url'),
      Type.Literal('metalpriceapi'),
      Type.Literal('goldapi'),
      Type.Literal('disabled'),
    ],
    { default: 'mock' },
  ),
  /** API key for `metalpriceapi` / `goldapi`. Empty disables those providers. */
  METAL_PRICE_API_KEY: Type.String({ default: '' }),

  /** Used by the `json_url` provider (back-compat with the original stub). */
  LBMA_PRICES_URL: Type.String({
    default: '',
    description:
      'HTTP endpoint returning {goldEur, silverEur, platinumEur} JSON. Used by METAL_PRICE_PROVIDER=json_url.',
  }),

  /** eBay Trading API token for the `ebay_sync` reconciler. Empty → mock EndItem. */
  EBAY_API_TOKEN: Type.String({
    default: '',
    description: 'eBay Trading API user token used by ebay_sync to call EndItem. Empty → mock.',
  }),
  // ── Fiskaly DSFinV-K (Epic K) — used by dsfinvk_daily_export ─────────
  // Empty → the job skips the Fiskaly push and logs "fiskaly not configured".
  FISKALY_API_KEY: Type.String({
    default: '',
    description: 'Fiskaly DSFinV-K API key (Basic auth user). Empty → push skipped.',
  }),
  FISKALY_API_SECRET: Type.String({
    default: '',
    description: 'Fiskaly DSFinV-K API secret (Basic auth password). Empty → push skipped.',
  }),
});

export type Env = Static<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const coerced: Record<string, unknown> = { ...source };
  for (const key of [
    'METRICS_PORT',
    'DB_POOL_MAX',
    'WORKER_DEFAULT_MAX_RETRIES',
    'WORKER_DEFAULT_TIMEOUT_MS',
  ] as const) {
    const v = coerced[key];
    if (typeof v === 'string' && v !== '') {
      const n = Number(v);
      if (!Number.isNaN(n)) coerced[key] = n;
    }
  }
  const candidate = Value.Default(EnvSchema, coerced);
  const errors = [...Value.Errors(EnvSchema, candidate)];
  if (errors.length > 0) {
    const lines = errors.map((e) => `  ${e.path || '/'} — ${e.message}`).join('\n');
    throw new Error(`Invalid worker env:\n${lines}`);
  }
  return candidate as Env;
}

/**
 * Refuse to start unless DATABASE_URL points at warehouse14_worker.
 * Override flag DATABASE_URL_ROLE_OVERRIDE=1 for testcontainers.
 */
export function assertWorkerRoleInDatabaseUrl(env: Env): void {
  if (process.env.DATABASE_URL_ROLE_OVERRIDE === '1') return;
  const m = /^postgres(?:ql)?:\/\/([^:@/]+)(?::|@)/.exec(env.DATABASE_URL);
  if (!m) {
    throw new Error('DATABASE_URL has unexpected shape (worker boot guard)');
  }
  // biome-ignore lint/style/noNonNullAssertion: the regex above guarantees group 1 when matched.
  const user = decodeURIComponent(m[1]!);
  if (user !== 'warehouse14_worker') {
    throw new Error(
      `DATABASE_URL points at role "${user}" — worker expects "warehouse14_worker". Refusing to start.`,
    );
  }
}
