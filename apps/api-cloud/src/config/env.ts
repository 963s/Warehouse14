/**
 * Environment validation — TypeBox + Value.Check, fail-fast on boot.
 *
 * The single source of truth for which env vars exist, what shape they take,
 * and what defaults apply. Any access to `process.env.*` outside this module
 * is a bug — call `loadEnv()` and pass the typed object around instead.
 *
 * Strict mode: unknown keys are not removed (they remain on process.env), but
 * the typed `Env` only exposes vetted fields, narrowing the API surface.
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

/**
 * The canonical env schema. Adding a var = adding a key here.
 */
const EnvSchema = Type.Object({
  NODE_ENV: NodeEnv,
  PORT: Type.Integer({ minimum: 1, maximum: 65535, default: 3000 }),
  LOG_LEVEL: LogLevel,
  DATABASE_URL: Type.String({
    minLength: 1,
    description: 'postgres:// connection string for the warehouse14_app role',
  }),
  DB_POOL_MAX: Type.Integer({ minimum: 1, maximum: 200, default: 10 }),
  WAREHOUSE14_PII_KEY: Type.String({
    minLength: 16,
    description:
      'Key for pgcrypto pgp_sym_encrypt — injected per request via SET LOCAL warehouse14.pii_key',
  }),
  TRUSTED_ORIGINS: Type.String({
    default: '',
    description: 'Comma-separated list of allowed origins for CORS + better-auth',
  }),
  TEST_DEVICE_FINGERPRINT: Type.String({
    default: '',
    description:
      'TEST-ONLY pre-mTLS escape hatch. When set (production), device-gated requests ' +
      'with no Cloudflare client cert are treated as coming from this single seeded ' +
      'device fingerprint. Empty = off. MUST be unset once Cloudflare Access mTLS is live.',
  }),
  TRANSACTION_STEP_UP_THRESHOLD_EUR: Type.String({
    default: '1000.00',
    pattern: '^\\d{1,10}(\\.\\d{1,2})?$',
    description:
      'Total amount (EUR) above which POST /transactions/finalize requires a fresh PIN step-up. ' +
      'NUMERIC(18,2) string. ADR-0022 §4c.',
  }),
  // ── Cloudflare R2 (Day 16) ────────────────────────────────────────────
  // R2 is S3-compatible; the AWS SDK speaks to it via a custom endpoint.
  // Empty defaults so dev/test can boot without R2 wired; the photo route
  // refuses if any are unset.
  R2_ACCOUNT_ID: Type.String({
    default: '',
    description: 'Cloudflare account ID for R2 endpoint construction.',
  }),
  R2_BUCKET: Type.String({
    default: '',
    description: 'R2 bucket name (e.g. warehouse14-products).',
  }),
  R2_ACCESS_KEY_ID: Type.String({ default: '', description: 'R2 API token access key id.' }),
  R2_SECRET_ACCESS_KEY: Type.String({ default: '', description: 'R2 API token secret.' }),
  R2_PUBLIC_URL_BASE: Type.String({
    default: '',
    description:
      'Public-facing CDN base URL for served R2 objects (e.g. https://media.warehouse14.de).',
  }),
  // ── Local product-photo store (replaces the empty R2 bucket) ───────────
  // Bytes are compressed to WebP and written to local disk under PHOTOS_DIR,
  // sharded by id prefix (e.g. /data/photos/ab/<id>.webp). PHOTOS_DIR must be
  // a Docker volume so photos survive container recreation.
  PHOTOS_DIR: Type.String({
    default: '/data/photos',
    description:
      'Filesystem directory the API writes compressed product-photo WebP bytes to. ' +
      'MUST be a persistent Docker volume in production.',
  }),
  PHOTO_STORE_MAX_BYTES: Type.Integer({
    // 20 GiB — the owner-imposed hard cap for product photos on the limited
    // server disk. Counted against SUM(product_photos.size_bytes) of local rows.
    default: 20 * 1024 * 1024 * 1024,
    minimum: 1024 * 1024,
    description:
      'Hard cap (bytes) for the local product-photo store. Uploads that would exceed it are refused.',
  }),
  PHOTOS_PUBLIC_BASE_URL: Type.String({
    default: 'https://api.warehouse14.de',
    description:
      'Public base URL the POS/storefront reads served photos from. publicUrl is built as ' +
      '<base>/api/photos/<id>/raw. The Tauri CSP already allows the api host for img/connect.',
  }),
  // ── Stripe (Day 19) — primary online payment provider ─────────────────
  // V1 amendment to memory.md #31 (Mollie primary): Basel overrode 2026-05-25
  // and selected Stripe for the entire payment surface — supports SEPA Direct
  // Debit, Klarna, iDEAL, German cards. Empty defaults so dev/test can boot
  // without Stripe wired; checkout/webhook routes refuse if any are unset
  // when actually invoked.
  STRIPE_SECRET_KEY: Type.String({
    default: '',
    description:
      'Stripe API secret key (sk_test_… or sk_live_…). Used for /checkout PaymentIntent creation.',
  }),
  STRIPE_WEBHOOK_SECRET: Type.String({
    default: '',
    description:
      'Stripe webhook signing secret (whsec_…). Used by the webhook handler to verify ' +
      'Stripe-Signature header HMAC-SHA256 against the raw request body before any business logic runs.',
  }),
  STRIPE_WEBHOOK_TOLERANCE_SECONDS: Type.Integer({
    default: 300,
    minimum: 30,
    maximum: 3600,
    description:
      'Maximum age of the Stripe-Signature timestamp (in seconds) accepted by the webhook handler. ' +
      'Stripe recommends 5 minutes (300). Older signatures are refused (replay defense).',
  }),
  STRIPE_API_VERSION: Type.String({
    default: '2024-12-18.acacia',
    description:
      'Pinned Stripe API version to avoid surprise schema changes (Stripe documents version-on-write).',
  }),
  // ── WhatsApp Cloud API (Day 21) ──────────────────────────────────────
  // Empty defaults are OK in dev/test; the webhook route refuses if invoked.
  WHATSAPP_APP_SECRET: Type.String({
    default: '',
    description:
      'Meta App Secret used to verify X-Hub-Signature-256 HMAC-SHA256 on the WhatsApp webhook.',
  }),
  WHATSAPP_VERIFY_TOKEN: Type.String({
    default: '',
    description:
      'Token Meta uses during webhook subscription handshake (GET /api/webhooks/whatsapp?hub.verify_token=...).',
  }),
  WHATSAPP_PHONE_NUMBER_ID: Type.String({
    default: '',
    description:
      'Meta phone-number id used in the Send route. POST is targeted at ' +
      'https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages. ' +
      'Empty in dev → the route stores the message as status="queued".',
  }),
  WHATSAPP_ACCESS_TOKEN: Type.String({
    default: '',
    description:
      'Meta Cloud API access token (Bearer). Required alongside ' +
      'WHATSAPP_PHONE_NUMBER_ID for live sends. Empty in dev → queued only.',
  }),
  // ── Meta socials (Instagram DMs + Facebook Messenger, Decision #48) ──
  // Same Meta App as WhatsApp; a single webhook config fans out by `object`.
  META_APP_SECRET: Type.String({
    default: '',
    description:
      'Meta App Secret for the socials webhook X-Hub-Signature-256. Empty → ' +
      'falls back to WHATSAPP_APP_SECRET (same Meta App).',
  }),
  META_SOCIALS_VERIFY_TOKEN: Type.String({
    default: '',
    description: 'Verify token for GET /api/webhooks/meta-socials subscription handshake.',
  }),
  META_PAGE_ACCESS_TOKEN: Type.String({
    default: '',
    description:
      'Page-scoped access token used to send Messenger/Instagram replies via ' +
      'graph.facebook.com/v20.0/me/messages. Empty in dev → replies are stored not sent.',
  }),
  // ── DHL Versenden / Shipping label API (Epic D) ──────────────────────
  // Empty defaults are OK in dev/test → the DHL client falls back to a
  // deterministic mock label so the flow works without sandbox credentials.
  DHL_API_USER: Type.String({
    default: '',
    description: 'DHL Geschäftskundenversand (GKP) API username. Empty → mock label.',
  }),
  DHL_API_SIGNATURE: Type.String({
    default: '',
    description: 'DHL API signature/password for the GKP user. Empty → mock label.',
  }),
  DHL_API_EKP: Type.String({
    default: '',
    description: 'DHL EKP (Einlieferungskundennummer / billing number) used in label requests.',
  }),
  // ── Anthropic / WhatsApp AI bot (Epic E) ─────────────────────────────
  // Empty default is OK in dev/test → the bot orchestrator is disabled and
  // inbound messages are simply stored for operator triage.
  ANTHROPIC_API_KEY: Type.String({
    default: '',
    description:
      'Anthropic API key (Bearer) for the WhatsApp bot. Empty → the bot is ' +
      'disabled; inbound messages are stored but not auto-answered.',
  }),
  // ── Telemetry (GlitchTip / Sentry-compatible) ────────────────────────
  // Optional + fail-safe: empty → telemetry disabled, the app boots normally.
  SENTRY_DSN: Type.Optional(Type.String({ default: '' })),
  // ── Chatwoot omnichannel inbox (Decision #48) ────────────────────────
  // Empty defaults → the Chatwoot webhook is inert; the app boots without it.
  CHATWOOT_URL: Type.String({
    default: '',
    description: 'Base URL of the self-hosted Chatwoot (e.g. https://chat.warehouse14.de).',
  }),
  CHATWOOT_ACCOUNT_ID: Type.String({
    default: '',
    description: 'Chatwoot numeric account id (string form for the REST path).',
  }),
  CHATWOOT_BOT_TOKEN: Type.String({
    default: '',
    description: 'Chatwoot Agent Bot API access token (api_access_token header).',
  }),
  CHATWOOT_WEBHOOK_SECRET: Type.String({
    default: '',
    description: 'HMAC-SHA256 secret to verify Chatwoot webhook X-Hub-Signature-256.',
  }),
  // ── OpenSanctions screening (Epic J — GwG §10 PEP/EU/OFAC matching) ──
  // Empty key → screening is skipped (route returns matched:false, skipped:true)
  // so the app boots + checks out fine without the external service wired.
  OPENSANCTIONS_API_KEY: Type.String({
    default: '',
    description:
      'OpenSanctions hosted match API key (Authorization: ApiKey …). Empty → ' +
      'screening is skipped; a transaction is never blocked by a missing key.',
  }),
  OPENSANCTIONS_SCORE_THRESHOLD: Type.String({
    default: '0.7',
    pattern: '^\\d+\\.\\d+$',
    description:
      'Match score (0.0–1.0) at/above which a customer counts as a sanctions hit. ' +
      'Decimal string, e.g. "0.7". Tunable without code change.',
  }),
  // ── Fiskaly DSFinV-K (Epic K — year-end fiscal export) ───────────────
  // Empty → the DSFinV-K push is skipped (logged "fiskaly not configured");
  // the daily-closing flow is never blocked by a missing/erroring Fiskaly.
  FISKALY_API_KEY: Type.String({
    default: '',
    description: 'Fiskaly DSFinV-K API key (Basic auth user). Empty → push skipped.',
  }),
  FISKALY_API_SECRET: Type.String({
    default: '',
    description: 'Fiskaly DSFinV-K API secret (Basic auth password). Empty → push skipped.',
  }),
  // ── Duress PIN silent alarm (Decision #37) ───────────────────────────
  // Optional outbound webhook fired in the background on a duress login.
  // Empty → the alarm still hits audit_log + the alert.duress ledger event.
  DURESS_ALARM_WEBHOOK_URL: Type.String({
    default: '',
    description: 'POST target for the silent duress alarm. Empty → no external webhook.',
  }),
  // ── eBay Trading API (Epic D) — instant POS delisting ────────────────
  // Empty → endEbayListing() returns a mock success so checkout works without
  // eBay credentials (the listing is still flipped to BEENDET locally).
  EBAY_API_TOKEN: Type.String({
    default: '',
    description: 'eBay Trading API token (Epic D).',
  }),
  // ── eBay Sell Inventory API (Epic D #38) — the LISTING-PUSH path ──────
  // Empty OAuth token → publishProductToEbay() returns an honest
  // not-configured result (no HTTP); the route surfaces a German "token
  // pending" toast. Basel holds the real token until go-live.
  EBAY_OAUTH_TOKEN: Type.String({
    default: '',
    description:
      'eBay user OAuth token (Bearer) for the Sell Inventory API push. Empty → not configured.',
  }),
  EBAY_MARKETPLACE: Type.Union([Type.Literal('EBAY_DE')], {
    default: 'EBAY_DE',
    description: 'Target eBay marketplace. DE-only for this shop.',
  }),
  EBAY_SELL_API_BASE_URL: Type.String({
    default: 'https://api.ebay.com',
    description:
      'eBay Sell API base URL. Production https://api.ebay.com; sandbox https://api.sandbox.ebay.com.',
  }),
  EBAY_MERCHANT_LOCATION_KEY: Type.String({
    default: '',
    description:
      'eBay inventory location key (created once via the Account API). Empty → offer omits it.',
  }),
  EBAY_FULFILLMENT_POLICY_ID: Type.String({
    default: '',
    description: 'eBay business policy id (shipping). All three policies needed together or none.',
  }),
  EBAY_PAYMENT_POLICY_ID: Type.String({
    default: '',
    description: 'eBay business policy id (payment).',
  }),
  EBAY_RETURN_POLICY_ID: Type.String({
    default: '',
    description: 'eBay business policy id (returns).',
  }),
  EBAY_DEFAULT_CATEGORY_ID: Type.String({
    default: '',
    description: 'Fallback eBay category id for offers. Empty → offer omits categoryId.',
  }),
});

export type Env = Static<typeof EnvSchema>;

/**
 * Read process.env, coerce numeric strings to numbers, apply defaults, and
 * validate the whole thing. Throws an aggregated error on the first failure
 * so the operator sees ALL missing/invalid vars in one shot.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const coerced: Record<string, unknown> = { ...source };
  // Convert EVERY integer/number-typed var from string → number BEFORE
  // validation, because process.env is `Record<string, string | undefined>`.
  // Derived from the schema so a new numeric field can't be forgotten here
  // (the bug that crashed boot when STRIPE_WEBHOOK_TOLERANCE_SECONDS was set).
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
    throw new Error(`Invalid environment configuration:\n${lines}`);
  }

  const env = candidate as Env;
  // Go-live hardening: fail fast if a production build still carries the
  // pre-mTLS device-gate bypass without an explicit acknowledgement. Runs in
  // every boot path because every entrypoint goes through loadEnv().
  assertNoTestDeviceFingerprintInProd(env, source);

  return env;
}

/**
 * Convenience: `parseOrigins(env)` → string[] for CORS plugin / better-auth.
 */
export function parseOrigins(env: Env): string[] {
  return env.TRUSTED_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Day 16 audit fix A-2 — assert the DATABASE_URL points at the
 * `warehouse14_app` role only. If a misconfiguration ever sets the URL to
 * the migrator or another role, refuse to start: a compromised app would
 * inherit too-broad privileges (DELETE on fiscal tables, DDL, etc.).
 *
 * The check is a substring match on the userinfo segment of the URL —
 * `postgres://<user>[:<pass>]@host:port/db`. We do not parse with `URL`
 * because postgres-js URLs sometimes carry colons in passwords that the
 * WHATWG parser mis-classifies.
 *
 * Tests / dev override: set `DATABASE_URL_ROLE_OVERRIDE=1` to bypass the
 * assertion (testcontainers may use the `postgres` superuser temporarily,
 * or a custom role). Production refuses the override flag (see prod-safety
 * Phase 1.5).
 */
export function assertAppRoleInDatabaseUrl(env: Env): void {
  if (process.env.DATABASE_URL_ROLE_OVERRIDE === '1') return;
  const url = env.DATABASE_URL;

  // Extract the user from `postgres://USER:pass@host…` or `postgres://USER@host…`.
  const match = /^postgres(?:ql)?:\/\/([^:@/]+)(?::|@)/.exec(url);
  if (!match) {
    throw new Error(
      'DATABASE_URL does not have the expected `postgres://user:pass@host/db` shape. ' +
        'Refusing to start (audit fix A-2).',
    );
  }
  // biome-ignore lint/style/noNonNullAssertion: the regex above guarantees group 1 when matched.
  const user = decodeURIComponent(match[1]!);
  if (user !== 'warehouse14_app') {
    throw new Error(
      `DATABASE_URL points at role "${user}" — expected "warehouse14_app". The API runtime MUST use the least-privileged role. Refusing to start (audit fix A-2).`,
    );
  }
}

/**
 * Go-live hardening guard — refuse to boot a PRODUCTION build that still
 * carries the pre-mTLS `TEST_DEVICE_FINGERPRINT` escape hatch.
 *
 * `TEST_DEVICE_FINGERPRINT` makes every device-gated request resolve to a
 * single seeded device when no Cloudflare client cert is presented — i.e. it
 * disables the mTLS device gate. That is intentional during test mode, but
 * shipping it to a hardened go-live would silently bypass device
 * authorization for the whole shop. This guard makes that mistake impossible
 * by accident: in production the fingerprint MUST be paired with the explicit
 * opt-in `ALLOW_TEST_DEVICE_FINGERPRINT_IN_PROD=true`, which forces whoever
 * keeps the bypass to acknowledge it in writing (env config + deploy review).
 *
 * Current state: the Schorndorf shop still runs WITH the bypass (mTLS is not
 * yet provisioned), so production deploys set the escape flag. The day mTLS
 * goes live, drop both `TEST_DEVICE_FINGERPRINT` and the escape flag — and a
 * stray fingerprint left in the env will then HARD-FAIL the boot instead of
 * silently re-opening the hole.
 */
export function assertNoTestDeviceFingerprintInProd(
  env: Env,
  source: NodeJS.ProcessEnv = process.env,
): void {
  if (env.NODE_ENV !== 'production') return;
  if (env.TEST_DEVICE_FINGERPRINT.trim() === '') return;

  const escapeFlag = (source.ALLOW_TEST_DEVICE_FINGERPRINT_IN_PROD ?? '').trim().toLowerCase();
  if (escapeFlag === 'true') return;

  throw new Error(
    'FATAL: TEST_DEVICE_FINGERPRINT is set in a production build. This disables the ' +
      'mTLS device gate for every device-gated request and MUST NOT ship to a hardened ' +
      'go-live. Either unset TEST_DEVICE_FINGERPRINT (provision Cloudflare Access mTLS ' +
      'first), or — if you are knowingly still in pre-mTLS test mode — set ' +
      'ALLOW_TEST_DEVICE_FINGERPRINT_IN_PROD=true to acknowledge the bypass. Refusing to start.',
  );
}
