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
      Type.Literal('gold_api_com'),
      Type.Literal('stooq'),
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
  // ── Meta WhatsApp Cloud API — appointment_notifications sweep ───────
  // Empty (default) → whatsapp rows are marked 'queued' with a log; the
  // job stays fully wired but inert until both keys are set (eBay pattern).
  WHATSAPP_PHONE_NUMBER_ID: Type.String({
    default: '',
    description:
      'Meta WhatsApp Cloud API phone-number id for appointment reminders. Empty → queued only.',
  }),
  WHATSAPP_ACCESS_TOKEN: Type.String({
    default: '',
    description:
      'Meta Graph API access token paired with WHATSAPP_PHONE_NUMBER_ID. Empty → queued only.',
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
  // ── Fiskaly SIGN DE V2 TSS — used by tse_archive_exporter (#I-2) ─────
  // Empty TSS id → the daily archive job records FAILED("fiskaly not
  // configured") and skips; it never blocks the worker.
  FISKALY_TSS_ID: Type.String({
    default: '',
    description: 'Fiskaly TSS (technical security system) id for the §10 daily TSE export.',
  }),
  // ── Cloudflare R2 — the §10 TSE archive TAR lands here ──────────────
  // Empty → the archive job records FAILED (no upload target); the app boots.
  R2_ACCOUNT_ID: Type.String({
    default: '',
    description: 'Cloudflare account id for the R2 endpoint.',
  }),
  R2_BUCKET: Type.String({ default: '', description: 'R2 bucket for TSE archives + media.' }),
  R2_ACCESS_KEY_ID: Type.String({ default: '', description: 'R2 API token access key id.' }),
  R2_SECRET_ACCESS_KEY: Type.String({ default: '', description: 'R2 API token secret.' }),
  // Empty → the intake pipeline uses the deterministic mock vision client.
  ANTHROPIC_API_KEY: Type.String({
    default: '',
    description: 'Anthropic API key for the real intake VisionClient (Phase B). Empty → mock.',
  }),
  R2_PUBLIC_URL_BASE: Type.String({
    default: '',
    description: 'Public CDN base for served R2 objects.',
  }),

  // ── Product-photo auto-purge (product_photo_purge job) ──────────────
  // Product photos are TEMPORARY: kept only until the item is sold/archived.
  // The worker MUST mount the SAME PHOTOS_DIR volume as the API. Empty →
  // the purge job is a no-op (cloud-only / R2 deployments).
  PHOTOS_DIR: Type.String({
    default: '',
    description:
      'Local filesystem root for product photos (<id>.webp + <id>_thumb.webp). Empty → product_photo_purge is a no-op.',
  }),
  // ── KYC image local store (migration 0074) — the gdpr_cleanup retention ──
  // purge deletes the AES-256-GCM-encrypted .enc file before flipping the row
  // to a shell. The worker MUST mount the SAME KYC_PHOTOS_DIR volume as the API
  // (separate from PHOTOS_DIR). The worker only DELETES files — it never needs
  // the encryption key. Empty → KYC file deletion is skipped (the row is still
  // flipped; a doc-store-only deployment).
  KYC_PHOTOS_DIR: Type.String({
    default: '',
    description:
      'Local filesystem root for KYC encrypted image (.enc) files. Same volume as the API KYC_PHOTOS_DIR. Empty → the gdpr_cleanup KYC file delete is skipped.',
  }),
  PHOTO_PURGE_SCHEDULE: Type.String({
    default: '0 3 * * *', // daily 03:00
    description: 'node-cron schedule for the product_photo_purge job.',
  }),
  PHOTO_PURGE_ORPHAN_RETENTION_DAYS: Type.Integer({
    minimum: 1,
    maximum: 3650,
    default: 30,
    description:
      'Age (days) past which an UNASSIGNED (product_id IS NULL) photo is purge-eligible. Sold/archived photos are purged immediately.',
  }),
  PHOTO_PURGE_BATCH_LIMIT: Type.Integer({
    minimum: 1,
    maximum: 100_000,
    default: 500,
    description: 'Max photos processed per product_photo_purge run (bounds tx time).',
  }),
});

export type Env = Static<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const coerced: Record<string, unknown> = { ...source };
  // Coerce EVERY integer/number-typed var from string → number, derived from
  // the schema so a newly-added numeric field can't be forgotten here.
  for (const [key, propSchema] of Object.entries(EnvSchema.properties)) {
    const t = (propSchema as { type?: string }).type;
    if (
      (t === 'integer' || t === 'number') &&
      typeof coerced[key] === 'string' &&
      coerced[key] !== ''
    ) {
      const n = Number(coerced[key]);
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
