/**
 * `buildApp` — the testable Fastify factory.
 *
 * Tests call `buildApp({ env, dbOverride })` to spin up an isolated server,
 * call `app.inject({…})` against it, and `await app.close()` in teardown.
 *
 * Production calls `buildApp({ env: loadEnv() })` once from `server.ts` and
 * never closes — `close-with-grace` takes care of SIGTERM.
 *
 * Plugin registration order — every position is intentional:
 *
 *   1. metrics            — wraps every following route in HTTP histograms.
 *   2. sensible           — error helpers (reply.notFound(), etc.).
 *   3. cookie             — better-auth + PIN-login need reply.setCookie.
 *   4. swagger            — early so route schemas can be collected.
 *   5. db                 — required by everything below.
 *   6. mtls               — populates req.deviceId (used by PIN-login).
 *   7. auth (better-auth) — mounts /api/auth/*, fills req.actor + req.session.
 *   8. request-context    — opens AsyncLocalStorage scope (needs req.actor).
 *   9. pii                — decorates app.withPii (needs db + request-context).
 *  10. error-handler      — replaces Fastify's default error formatter.
 *  11. routes             — after every decorator is in place.
 */

import fastifyCookie from '@fastify/cookie';
import fastifySensible from '@fastify/sensible';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Sql } from 'postgres';

import type { AppDb } from '@warehouse14/db/client';

import type { Env } from './config/env.js';
import { initSentry } from './lib/sentry.js';
import { mcpServer } from './mcp/index.js';
import authPlugin from './plugins/auth.js';
import botDispatchPlugin from './plugins/bot-dispatch.js';
import dbPlugin from './plugins/db.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import metricsPlugin from './plugins/metrics.js';
import mtlsPlugin from './plugins/mtls.js';
import piiPlugin from './plugins/pii.js';
import rateLimitPlugin from './plugins/rate-limit.js';
import requestContextPlugin from './plugins/request-context.js';
import securityHeadersPlugin from './plugins/security-headers.js';
import storefrontSessionPlugin from './plugins/storefront-session.js';
import swaggerPlugin from './plugins/swagger.js';
import aiComposeRoute from './routes/ai-compose.js';
import appointmentsRoutes from './routes/appointments.js';
// Day 22 — Konvolut + Appraisals
import appraisalRoutes from './routes/appraisals.js';
import approvalsRoutes from './routes/approvals.js';
import authPinRoutes from './routes/auth-pin.js';
import authSessionRoutes from './routes/auth-session.js';
import belegtextRoutes from './routes/belegtext.js';
import bridgeRoutes from './routes/bridge.js';
import calendarRoute from './routes/calendar.js';
import categoriesRoutes from './routes/categories.js';
import closingExportRoute from './routes/closing-export.js';
import closingsFinalizeRoute from './routes/closings-finalize.js';
import complianceRoute from './routes/compliance.js';
import customerKycDocumentsRoute from './routes/customer-kyc-documents.js';
// Day 26 — Backend Finale: Customer Trust + Belegtext
import customerTrustRoutes from './routes/customer-trust.js';
import customerUpdateRoute from './routes/customer-update.js';
import customersCheckSanctionsRoute from './routes/customers-check-sanctions.js';
import customersListRoute from './routes/customers-list.js';
import customersVatLookupRoute from './routes/customers-vat-lookup.js';
import { customersVerifyVatRoute } from './routes/customers-verify-vat.js';
import customersRoutes from './routes/customers.js';
import dashboardRoutes from './routes/dashboard.js';
import documentsRoutes from './routes/documents.js';
import expensesRoutes from './routes/expenses.js';
import financeRoutes from './routes/finance.js';
import fixedCostsRoutes from './routes/fixed-costs.js';
import healthRoute from './routes/health.js';
import intakeDraftsRoutes from './routes/intake-drafts.js';
import integrationsRoute from './routes/integrations.js';
import inventoryAdjustmentRoute from './routes/inventory-adjustment.js';
import inventoryRelease from './routes/inventory-release.js';
import inventoryReserve from './routes/inventory-reserve.js';
import inventorySessionsRoutes from './routes/inventory-sessions.js';
import ledgerRoutes from './routes/ledger.js';
// Day 23 — Edelmetall-Kursmodul
import metalPricesRoutes from './routes/metal-prices.js';
import photoDirectUploadRoute from './routes/photo-direct-upload.js';
import photoUploadUrlRoute from './routes/photo-upload-url.js';
// Phase 2 Day 2 — closes the Day-24 route gap + dashboard aggregator
import photosRoutes from './routes/photos.js';
import productCategoriesRoute from './routes/product-categories.js';
import productRelocateRoute from './routes/product-relocate.js';
import productsDetailRoute from './routes/products-detail.js';
import productsEbayPublishRoute from './routes/products-ebay-publish.js';
import productsEbayRoutes from './routes/products-ebay.js';
import productsListRoute from './routes/products-list.js';
import productsRoutes from './routes/products.js';
import registersRoute from './routes/registers.js';
// Day 21 — Retail Core
import settingsRoute from './routes/settings.js';
import shiftsRoutes from './routes/shifts.js';
import shippingRoutes from './routes/shipping.js';
import shopInfoRoute from './routes/shop-info.js';
import sseLedger from './routes/sse-ledger.js';
import storefrontAppointmentsRoutes from './routes/storefront-appointments.js';
import storefrontGoogleAuthRoutes from './routes/storefront-auth-google.js';
import storefrontAuthRoutes from './routes/storefront-auth.js';
import storefrontCartRoutes from './routes/storefront-cart.js';
// Phase 2.A — Storefront catalog (public read-only) + MCP server
import storefrontCatalogRoutes from './routes/storefront-catalog.js';
import storefrontOrdersRoutes from './routes/storefront-orders.js';
import storefrontReserveRoutes from './routes/storefront-reserve.js';
import storefrontWebhookRoutes from './routes/storefront-webhook.js';
// Day 25 — Single-Operator Assistance
import tasksRoutes from './routes/tasks.js';
import transactionsAnkauf from './routes/transactions-ankauf.js';
import transactionsFinalize from './routes/transactions-finalize.js';
import transactionsRecent from './routes/transactions-recent.js';
import transactionsReturn from './routes/transactions-return.js';
import transactionsStorno from './routes/transactions-storno.js';
import transactionsTseSignature from './routes/transactions-tse-signature.js';
import voucherRoutes from './routes/vouchers.js';
import chatwootWebhookRoutes from './routes/webhooks-chatwoot.js';
import metaSocialsRoutes from './routes/webhooks-meta-socials.js';
import whatsappIntakeRoutes from './routes/webhooks-whatsapp-intake.js';
import whatsappWebhookRoutes from './routes/webhooks-whatsapp.js';
import whatsappInboxRoutes from './routes/whatsapp-inbox.js';

export interface BuildAppOpts {
  env: Env;
  /**
   * Optional DB override — integration tests pass a testcontainer-backed
   * `{ db, sql }` pair so the factory does not open its own connection.
   * Tests exercising SSE LISTEN should also pass `dedicatedConnectionFactory`
   * so per-subscriber connections point at the same container.
   */
  dbOverride?: {
    db: AppDb;
    sql: Sql;
    dedicatedConnectionFactory?: () => Sql;
  };
  /**
   * Optional Fastify options — tests may want `disableRequestLogging: true`,
   * production uses the default Pino transport.
   */
  fastifyOpts?: FastifyServerOptions;
}

export async function buildApp(opts: BuildAppOpts): Promise<FastifyInstance> {
  // Telemetry (GlitchTip/Sentry) — optional + fail-safe: a no-op when no DSN.
  initSentry({ dsn: opts.env.SENTRY_DSN, environment: opts.env.NODE_ENV });

  const app = Fastify({
    logger: {
      level: opts.env.LOG_LEVEL,
      ...(opts.env.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:standard' } } }
        : {}),
    },
    genReqId: () => crypto.randomUUID(),
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
    disableRequestLogging: false,
    trustProxy: true,
    bodyLimit: 1024 * 1024,
    ...opts.fastifyOpts,
  });

  // 1. Metrics — early, so it wraps every later route.
  await app.register(metricsPlugin);

  // 1.5 Security headers + CORS (Day 16 audit A-3 + A-4) — must be FIRST
  //     before any handler emits a response, so even error replies carry
  //     the OWASP headers.
  await app.register(securityHeadersPlugin, { env: opts.env });

  // 2. HTTP error helpers.
  await app.register(fastifySensible);

  // 3. Cookies — better-auth + PIN-login both set/read cookies.
  await app.register(fastifyCookie);

  // 4. OpenAPI generation + Swagger UI.
  await app.register(swaggerPlugin, { env: opts.env });

  // 5. Database.
  await app.register(dbPlugin, {
    env: opts.env,
    ...(opts.dbOverride ? { override: opts.dbOverride } : {}),
  });

  // 6. mTLS device extraction — populates req.deviceId.
  await app.register(mtlsPlugin, { env: opts.env });

  // 7. better-auth + session/actor preHandler — populates req.actor + req.session.
  await app.register(authPlugin, { env: opts.env });

  // 8. AsyncLocalStorage request-context — must run AFTER auth populates the actor.
  await app.register(requestContextPlugin, { env: opts.env });

  // 9. PII helper — depends on db + request-context.
  await app.register(piiPlugin);

  // 9.1 Bot dispatcher — bounded concurrency gate for detached bot turns.
  await app.register(botDispatchPlugin, { env: opts.env });

  // 9.5 Storefront session — fills req.shopper for /api/storefront/* routes.
  //     Runs alongside (not instead of) the staff auth plugin; they read
  //     different cookies so they never conflict.
  await app.register(storefrontSessionPlugin);

  // 10. Rate limit (Day 16 audit A-1) — AFTER auth so the key generator
  //     can use req.actor.id; falls back to req.ip for unauthenticated routes.
  await app.register(rateLimitPlugin, { env: opts.env });

  // 11. Error handler.
  await app.register(errorHandlerPlugin);

  // 12. Routes.
  await app.register(healthRoute);
  await app.register(authPinRoutes, { env: opts.env });
  await app.register(authSessionRoutes);
  await app.register(inventoryReserve);
  await app.register(inventoryRelease);
  await app.register(productsRoutes, { env: opts.env });
  await app.register(productsListRoute);
  await app.register(productsDetailRoute);
  await app.register(inventoryAdjustmentRoute);
  await app.register(productRelocateRoute);
  await app.register(complianceRoute);
  // ── Day 13 / Phase 2.B kick-off: commerce taxonomy ────────────────
  await app.register(categoriesRoutes);
  await app.register(productCategoriesRoute);
  await app.register(customersRoutes);
  await app.register(customersListRoute);
  await app.register(customersVatLookupRoute);
  await app.register(customerUpdateRoute);
  await app.register(customersVerifyVatRoute);
  await app.register(customersCheckSanctionsRoute, { env: opts.env });
  await app.register(customerKycDocumentsRoute, { env: opts.env });
  await app.register(photoUploadUrlRoute, { env: opts.env });
  await app.register(photoDirectUploadRoute, { env: opts.env });
  await app.register(transactionsFinalize, { env: opts.env });
  await app.register(transactionsAnkauf, { env: opts.env });
  await app.register(transactionsStorno);
  await app.register(transactionsTseSignature);
  await app.register(transactionsRecent);
  await app.register(sseLedger);
  // ── Day 19: storefront commerce ────────────────────────────────────
  await app.register(storefrontAuthRoutes);
  await app.register(storefrontGoogleAuthRoutes, { env: opts.env });
  await app.register(storefrontCartRoutes, { env: opts.env });
  await app.register(storefrontReserveRoutes);
  await app.register(storefrontOrdersRoutes);
  await app.register(storefrontWebhookRoutes, { env: opts.env });
  // ── Day 21: retail core ───────────────────────────────────────────
  await app.register(shiftsRoutes);
  await app.register(voucherRoutes);
  await app.register(inventorySessionsRoutes);
  await app.register(transactionsReturn, { env: opts.env });
  await app.register(whatsappWebhookRoutes, { env: opts.env });
  await app.register(whatsappIntakeRoutes, { env: opts.env });
  await app.register(whatsappInboxRoutes, { env: opts.env });
  await app.register(intakeDraftsRoutes, { env: opts.env });
  await app.register(metaSocialsRoutes, { env: opts.env });
  await app.register(chatwootWebhookRoutes, { env: opts.env });
  await app.register(appointmentsRoutes, { env: opts.env });
  // ── Day 22: Konvolut + Appraisals ────────────────────────────────
  await app.register(appraisalRoutes);
  // ── Day 23: Edelmetall-Kursmodul ─────────────────────────────────
  await app.register(metalPricesRoutes);
  // ── Day 25: Single-Operator Assistance ───────────────────────────
  await app.register(tasksRoutes);
  await app.register(documentsRoutes);
  // ── Day 26: Backend Finale — Customer Trust + Belegtext ──────────
  await app.register(customerTrustRoutes);
  await app.register(belegtextRoutes);
  // ── Phase 2 Day 2: photo + eBay state machine + dashboard ────────
  await app.register(photosRoutes, { env: opts.env });
  await app.register(productsEbayRoutes);
  await app.register(productsEbayPublishRoute, { env: opts.env });
  await app.register(shippingRoutes, { env: opts.env });
  await app.register(dashboardRoutes);
  // ── Owner OS: finance backend (migration 0075) ───────────────────
  await app.register(financeRoutes);
  await app.register(expensesRoutes);
  await app.register(fixedCostsRoutes);
  await app.register(bridgeRoutes);
  await app.register(approvalsRoutes);
  await app.register(settingsRoute);
  await app.register(integrationsRoute, { env: opts.env });
  await app.register(calendarRoute);
  await app.register(shopInfoRoute);
  await app.register(aiComposeRoute, { env: opts.env });
  await app.register(ledgerRoutes);
  // ── Epic K: DSFinV-K / DATEV fiscal exports ──────────────────────
  await app.register(closingExportRoute);
  await app.register(closingsFinalizeRoute);
  await app.register(registersRoute);
  // ── Phase 2.A: storefront catalog + MCP (memory.md §20) ──────────
  // Public read-only catalog endpoints. The path prefix
  // `/api/storefront/` is in PUBLIC_PREFIXES (lib/public-routes.ts),
  // so the auth + mTLS preHandlers bypass these routes automatically.
  await app.register(storefrontCatalogRoutes, { env: opts.env });
  // Public appointment booking (CONTRACT 1+2) — same public `/api/storefront/`
  // scope as the catalog; strict per-route rate limits inside the plugin.
  await app.register(storefrontAppointmentsRoutes, { env: opts.env });
  // MCP server — ADMIN-only JSON-RPC 2.0 endpoint at /api/mcp.
  await app.register(mcpServer);

  return app;
}
