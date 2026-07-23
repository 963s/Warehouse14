/**
 * `buildWorker(opts)` — the testable factory for `apps/worker`.
 *
 * Returns:
 *   • `runner`  — JobRunner with all V1 jobs registered (but cron NOT started).
 *   • `metrics` — the prom-client Registry, exposed via Fastify /metrics.
 *   • `httpServer` — Fastify instance bound to 127.0.0.1:<METRICS_PORT> for
 *     /metrics + /health. Bound to localhost only — Prometheus scrapes from
 *     the same VM (ADR-0012). NEVER exposes business endpoints.
 *   • `close()` — graceful shutdown: stop runner + close http + end pool.
 *
 * `server.ts` calls `buildWorker(env)` then `runner.startSchedules()` to
 * begin actual cron-driven execution. Tests skip `startSchedules` and drive
 * `runner.runOnce(jobName)` directly.
 */

import fastifySensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';

import { type WorkerDb, connectWorker } from '@warehouse14/db/client';

import type { Env } from './config/env.js';
import {
  anomalyWatchdogJob,
  appointmentNoShowDetectorJob,
  appointmentNotificationsJob,
  chainVerifierJob,
  dsfinvkDailyExportJob,
  ebaySyncJob,
  emailOutboxSenderJob,
  reservationExpiryReminderJob,
  supportInboxPollerJob,
  gdprCleanupJob,
  intakeSweepJob,
  lbmaPricesJob,
  posReservationSweeperJob,
  productPhotoPurgeJob,
  reservationSweeperJob,
  sessionsCleanupJob,
  storefrontCartSweeperJob,
  productTranslatorJob,
  tseArchiveExporterJob,
  tseCertCheckerJob,
  workerJobRunsRetentionJob,
} from './jobs/index.js';
import { createMetalPriceProvider } from './jobs/providers/index.js';
import { createAnthropicVisionClient } from './lib/anthropic-vision-client.js';
import { JobRunner } from './lib/job-runner.js';
import { type WorkerMetrics, createMetrics } from './lib/metrics.js';

export interface BuildWorkerOpts {
  env: Env;
  /** Optional override — tests inject a testcontainer-backed client pair. */
  dbOverride?: {
    db: WorkerDb;
    sql: Sql;
    /** URL the runner uses for the per-job advisory-lock connection. */
    lockConnectionUrl: string;
  };
  /** Skip cron registration. Tests use `'manual'` and call `runOnce` directly. */
  schedule?: 'cron' | 'manual';
}

export interface WorkerHandle {
  runner: JobRunner;
  metrics: WorkerMetrics;
  httpServer: FastifyInstance;
  close: () => Promise<void>;
}

export async function buildWorker(opts: BuildWorkerOpts): Promise<WorkerHandle> {
  const metrics = createMetrics();

  // Resolve the DB clients.
  let workerDb: WorkerDb;
  let workerSql: Sql;
  let lockUrl: string;
  let ownedConnections = false;
  if (opts.dbOverride) {
    workerDb = opts.dbOverride.db;
    workerSql = opts.dbOverride.sql;
    lockUrl = opts.dbOverride.lockConnectionUrl;
  } else {
    const { db, sql } = connectWorker({
      url: opts.env.DATABASE_URL,
      max: opts.env.DB_POOL_MAX,
      applicationName: 'warehouse14_worker',
    });
    workerDb = db;
    workerSql = sql;
    lockUrl = opts.env.DATABASE_URL;
    ownedConnections = true;
    // Smoke test — fail fast if URL/role wrong.
    await sql`SELECT 1`;
  }

  const runner = new JobRunner({
    db: workerDb,
    sql: workerSql,
    lockConnectionUrl: lockUrl,
    metrics,
    defaults: {
      maxRetries: opts.env.WORKER_DEFAULT_MAX_RETRIES,
      timeoutMs: opts.env.WORKER_DEFAULT_TIMEOUT_MS,
    },
    schedule: opts.schedule ?? 'cron',
    logger: {
      info: (msg, extra) => console.log(JSON.stringify({ level: 'info', msg, ...extra })),
      warn: (msg, extra) => console.warn(JSON.stringify({ level: 'warn', msg, ...extra })),
      error: (msg, extra) => console.error(JSON.stringify({ level: 'error', msg, ...extra })),
      debug: (msg, extra) =>
        opts.env.LOG_LEVEL === 'debug' || opts.env.LOG_LEVEL === 'trace'
          ? console.debug(JSON.stringify({ level: 'debug', msg, ...extra }))
          : undefined,
    },
  });

  // Register V1 jobs. Order doesn't affect runtime — cron handles scheduling.
  runner.register(reservationSweeperJob);
  runner.register(posReservationSweeperJob);
  runner.register(chainVerifierJob);
  runner.register(sessionsCleanupJob);
  runner.register(workerJobRunsRetentionJob);
  runner.register(anomalyWatchdogJob);
  runner.register(
    lbmaPricesJob({
      provider: createMetalPriceProvider({
        provider: opts.env.METAL_PRICE_PROVIDER,
        apiKey: opts.env.METAL_PRICE_API_KEY,
        jsonUrl: opts.env.LBMA_PRICES_URL,
      }),
      nodeEnv: opts.env.NODE_ENV,
    }),
  );
  // Epic K: push the finalized closing to Fiskaly DSFinV-K when configured;
  // empty credentials → the job logs "fiskaly not configured" and continues.
  runner.register(
    dsfinvkDailyExportJob({
      fiskaly: {
        apiKey: opts.env.FISKALY_API_KEY,
        apiSecret: opts.env.FISKALY_API_SECRET,
      },
    }),
  );
  // Phase 1.5 #I-2: KassenSichV §10 daily TSE archive → Fiskaly export + R2.
  // Empty Fiskaly TSS id → the job records FAILED("fiskaly not configured").
  runner.register(
    tseArchiveExporterJob({
      fiskaly: {
        apiKey: opts.env.FISKALY_API_KEY,
        apiSecret: opts.env.FISKALY_API_SECRET,
        tssId: opts.env.FISKALY_TSS_ID,
      },
      r2Config: {
        accountId: opts.env.R2_ACCOUNT_ID,
        bucket: opts.env.R2_BUCKET,
        accessKeyId: opts.env.R2_ACCESS_KEY_ID,
        secretAccessKey: opts.env.R2_SECRET_ACCESS_KEY,
      },
    }),
  );
  // Phase 1.5 #I-1: KassenSichV TSE certificate-expiry monitor. Empty Fiskaly
  // TSS id → the job skips; near-expiry → alert.tse_cert_expiry (throttled 24h).
  runner.register(
    tseCertCheckerJob({
      fiskaly: {
        apiKey: opts.env.FISKALY_API_KEY,
        apiSecret: opts.env.FISKALY_API_SECRET,
        tssId: opts.env.FISKALY_TSS_ID,
      },
    }),
  );
  // Phase 1.5 #I-4 + #I-5: daily GDPR sweep — audit_log IP minimization +
  // expired-KYC purge (local encrypted .enc delete + PII null, row kept as an
  // audit shell). Worker MUST mount the SAME KYC_PHOTOS_DIR volume as the API.
  runner.register(
    gdprCleanupJob({
      kycPhotosDir: opts.env.KYC_PHOTOS_DIR,
    }),
  );
  // Day 20: B2C cart expiry — releases 15-min STOREFRONT soft locks.
  runner.register(storefrontCartSweeperJob);
  runner.register(
    productTranslatorJob({
      apiKey: opts.env.OPENAI_API_KEY,
      model: opts.env.OPENAI_TRANSLATE_MODEL,
      locales: opts.env.PRODUCT_TRANSLATE_LOCALES,
      batchSize: opts.env.PRODUCT_TRANSLATE_BATCH,
    }),
  );
  // 0102: der Brief, BEVOR eine Reservierung verfaellt. Bis dahin verfiel sie
  // stillschweigend und der Mensch erfuhr es erst am leeren Regal.
  runner.register(
    reservationExpiryReminderJob({ piiKey: opts.env.WAREHOUSE14_PII_KEY || '' }),
  );
  // 0088: transactional mail delivery (welcome, reservation, cancellation).
  runner.register(
    emailOutboxSenderJob({
      smtpHost: opts.env.SMTP_HOST || undefined,
      smtpPort: opts.env.SMTP_PORT,
      smtpUser: opts.env.SMTP_USER || undefined,
      smtpPass: opts.env.SMTP_PASS || undefined,
      mailFrom: opts.env.MAIL_FROM || undefined,
      mailReplyTo: opts.env.MAIL_REPLY_TO || undefined,
      piiKey: opts.env.WAREHOUSE14_PII_KEY || undefined,
    }),
  );
  // 0097: collect customer replies into support tickets.
  runner.register(
    supportInboxPollerJob({
      serviceAccountB64: opts.env.GOOGLE_SERVICE_ACCOUNT_B64 || undefined,
      mailbox: opts.env.SUPPORT_MAILBOX || undefined,
      piiKey: opts.env.WAREHOUSE14_PII_KEY || undefined,
      ownAddresses: opts.env.SUPPORT_OWN_ADDRESSES.split(',')
        .map((a) => a.trim())
        .filter(Boolean),
      publicAddresses: opts.env.SUPPORT_PUBLIC_ADDRESSES.split(',')
        .map((a) => a.trim())
        .filter(Boolean),
    }),
  );
  // Epic D: end eBay listings for items sold at the retail counter.
  runner.register(ebaySyncJob({ token: opts.env.EBAY_API_TOKEN }));
  // Epic F: AI Intake Pipeline — close grouping windows + process sessions.
  // Real Anthropic vision when ANTHROPIC_API_KEY is set; else the mock (Phase B).
  const intakeVision = opts.env.ANTHROPIC_API_KEY
    ? createAnthropicVisionClient({
        apiKey: opts.env.ANTHROPIC_API_KEY,
        r2: {
          accountId: opts.env.R2_ACCOUNT_ID,
          bucket: opts.env.R2_BUCKET,
          accessKeyId: opts.env.R2_ACCESS_KEY_ID,
          secretAccessKey: opts.env.R2_SECRET_ACCESS_KEY,
        },
      })
    : undefined;
  runner.register(intakeSweepJob(intakeVision ? { vision: intakeVision } : {}));
  // Epic G: Smart Appointment System — reminder dispatch + no-show grace release.
  // WhatsApp sends are token-gated: empty WHATSAPP_* env → rows queued (inert).
  runner.register(
    appointmentNotificationsJob({
      whatsapp: {
        phoneNumberId: opts.env.WHATSAPP_PHONE_NUMBER_ID,
        accessToken: opts.env.WHATSAPP_ACCESS_TOKEN,
      },
    }),
  );
  runner.register(appointmentNoShowDetectorJob);
  // Storage hygiene: product photos are TEMPORARY — purge files+rows once the
  // item is SOLD/ARCHIVED (or an unassigned orphan ages out). Empty PHOTOS_DIR
  // → the job is a no-op. Worker MUST mount the SAME PHOTOS_DIR as the API.
  runner.register(
    productPhotoPurgeJob({
      photosDir: opts.env.PHOTOS_DIR,
      schedule: opts.env.PHOTO_PURGE_SCHEDULE,
      orphanRetentionDays: opts.env.PHOTO_PURGE_ORPHAN_RETENTION_DAYS,
      batchLimit: opts.env.PHOTO_PURGE_BATCH_LIMIT,
    }),
  );

  // Tiny Fastify for /metrics + /health.
  const httpServer = Fastify({
    logger: {
      level: opts.env.LOG_LEVEL,
    },
    disableRequestLogging: true,
    trustProxy: false,
  });
  await httpServer.register(fastifySensible);

  httpServer.get('/health', async (_req, reply) => {
    let dbStatus: 'up' | 'down' = 'down';
    try {
      await workerSql`SELECT 1`;
      dbStatus = 'up';
    } catch {
      /* up=false */
    }
    return reply
      .status(200)
      .send({ ok: true, db: dbStatus, version: '0.1.0', timestamp: new Date().toISOString() });
  });

  httpServer.get('/metrics', async (_req, reply) => {
    reply.header('content-type', metrics.registry.contentType);
    return reply.send(await metrics.registry.metrics());
  });

  return {
    runner,
    metrics,
    httpServer,
    close: async () => {
      await runner.close().catch(() => {});
      await httpServer.close().catch(() => {});
      if (ownedConnections) {
        await workerSql.end({ timeout: 5 }).catch(() => {});
      }
    },
  };
}
