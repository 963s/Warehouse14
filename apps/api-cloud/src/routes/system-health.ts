/**
 * System-Health — the Owner's operations snapshot (the "Leitstand" surface).
 *
 *   GET /api/system/health   (Owner only)
 *
 * One CTE round-trip over the signals that already exist as first-class server
 * state — worker dead-letters, the chain-verifier heartbeat, TSE cert headroom,
 * and the `alert.*` ledger stream — plus a guarded read of the migration
 * tracker and an env-presence check for the outboard integrations (Cloudflare,
 * Fiskaly, Stripe, R2, sanctions). It derives a per-component status and a
 * single top-line verdict, and it lists the genuinely-open problems (each with
 * the surface to open) rather than inventing severity.
 *
 * Deliberately server-side only. Offline/outbox conflicts live in each device's
 * local SQLite and never reach the cloud, so they are NOT counted here — the
 * Leitstand links to the Konfliktpostfach for those instead of faking a number.
 *
 * Modeled on `bridge.ts` (the ADMIN KPI snapshot): same Drizzle raw-SQL idiom,
 * same cents/camelCase-on-the-wire discipline, tighter to Owner.
 */

import { type Static, Type } from '@sinclair/typebox';
import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { Env } from '../config/env.js';
import { requireOwner } from '../lib/auth-policy.js';

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
  }),
});

const StatusU = Type.Union([Type.Literal('ok'), Type.Literal('watch'), Type.Literal('alert')]);
type ComponentStatus = Static<typeof StatusU>;

const Problem = Type.Object({
  id: Type.String(),
  severity: Type.Union([Type.Literal('watch'), Type.Literal('alert')]),
  title: Type.String(),
  detail: Type.String(),
  /** A surface path to open for this problem, or null when there is nowhere to go. */
  surface: Type.Union([Type.String(), Type.Null()]),
});
type TProblem = Static<typeof Problem>;

const Integration = Type.Object({
  key: Type.String(),
  label: Type.String(),
  configured: Type.Boolean(),
});

const SystemHealthResponse = Type.Object({
  status: StatusU,
  computedAt: Type.String({ format: 'date-time' }),
  components: Type.Object({
    api: Type.Object({ status: StatusU }),
    database: Type.Object({
      status: StatusU,
      migrationsApplied: Type.Union([Type.Integer(), Type.Null()]),
      latestMigration: Type.Union([Type.String(), Type.Null()]),
    }),
    worker: Type.Object({
      status: StatusU,
      deadLetter: Type.Integer(),
      oldestDeadLetterAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
      running: Type.Integer(),
      chainLastVerifiedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    }),
    fiscal: Type.Object({
      status: StatusU,
      tseCertDaysRemaining: Type.Union([Type.Integer(), Type.Null()]),
      tseCertValidUntil: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    }),
    alerts: Type.Object({
      status: StatusU,
      last24h: Type.Integer(),
      last7d: Type.Integer(),
    }),
    edge: Type.Object({
      status: Type.Union([Type.Literal('ok'), Type.Literal('unconfigured')]),
      configured: Type.Boolean(),
    }),
  }),
  integrations: Type.Array(Integration),
  problems: Type.Array(Problem),
});

export type TSystemHealthResponse = Static<typeof SystemHealthResponse>;

type HealthRow = {
  dlq_unacked: number;
  dlq_oldest: Date | null;
  jobs_running: number;
  chain_last_ok: Date | null;
  tse_days: number | null;
  tse_soonest: Date | null;
  alerts_24h: number;
  alerts_7d: number;
};

const STALE_CHAIN_MS = 26 * 60 * 60 * 1000; // a daily job that has not passed in >26h is stale.

const systemHealthRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  app.get(
    '/api/system/health',
    {
      schema: {
        tags: ['system'],
        summary: 'Owner system-health snapshot: components, integrations, open problems.',
        description:
          'Worker dead-letters + chain heartbeat + TSE cert headroom + alert stream in one ' +
          'round-trip, plus migration version and integration presence. Owner only, read-only.',
        response: {
          200: SystemHealthResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireOwner(req);

      // One round-trip over the server-side health signals. Reaching this line
      // at all proves the DB answered, so `database.status` is derived as `ok`.
      const rows = (await app.db.execute<HealthRow>(drizzleSql`
        WITH
          dlq AS (
            SELECT COUNT(*)::int AS n, MIN(pushed_at) AS oldest
              FROM worker_job_dlq WHERE acked_at IS NULL
          ),
          running AS (
            SELECT COUNT(*)::int AS n FROM worker_job_runs WHERE status = 'RUNNING'
          ),
          chain AS (
            SELECT MAX(finished_at) AS t FROM worker_job_runs
             WHERE job_name = 'chain_verifier' AND status = 'SUCCESS'
          ),
          tse AS (
            SELECT FLOOR(MIN(EXTRACT(EPOCH FROM (cert_valid_to - now()))) / 86400)::int AS days,
                   MIN(cert_valid_to) AS soonest
              FROM tse_clients
          ),
          a24 AS (
            SELECT COUNT(*)::int AS n FROM ledger_events
             WHERE event_type LIKE 'alert.%' AND created_at >= now() - interval '24 hours'
          ),
          a7 AS (
            SELECT COUNT(*)::int AS n FROM ledger_events
             WHERE event_type LIKE 'alert.%' AND created_at >= now() - interval '7 days'
          )
        SELECT
          (SELECT n FROM dlq)        AS dlq_unacked,
          (SELECT oldest FROM dlq)   AS dlq_oldest,
          (SELECT n FROM running)    AS jobs_running,
          (SELECT t FROM chain)      AS chain_last_ok,
          (SELECT days FROM tse)     AS tse_days,
          (SELECT soonest FROM tse)  AS tse_soonest,
          (SELECT n FROM a24)        AS alerts_24h,
          (SELECT n FROM a7)         AS alerts_7d
      `)) as unknown as HealthRow[];

      const r = rows[0];
      if (!r) throw new Error('system health returned no rows');

      // Migration tracker read separately + guarded: `_w14_schema_migrations` is
      // written by the prod migrator and is NOT in the Drizzle schema, so it may
      // be absent on a fresh database. A missing table degrades to null, never a 500.
      let migrationsApplied: number | null = null;
      let latestMigration: string | null = null;
      try {
        const m = (await app.db.execute<{ n: number; latest: string | null }>(drizzleSql`
          SELECT COUNT(*)::int AS n, MAX(filename) AS latest FROM _w14_schema_migrations
        `)) as unknown as Array<{ n: number; latest: string | null }>;
        if (m[0]) {
          migrationsApplied = Number(m[0].n);
          latestMigration = m[0].latest ?? null;
        }
      } catch {
        // tracker absent → leave null; the panel shows "unbekannt".
      }

      const dlq = Number(r.dlq_unacked);
      const running = Number(r.jobs_running);
      const chainLastOk = r.chain_last_ok ? new Date(r.chain_last_ok) : null;
      const tseDays = r.tse_days === null ? null : Number(r.tse_days);
      const alerts24 = Number(r.alerts_24h);
      const alerts7 = Number(r.alerts_7d);
      const now = Date.now();
      const chainStale = chainLastOk ? now - chainLastOk.getTime() > STALE_CHAIN_MS : false;

      const workerStatus: ComponentStatus = dlq > 0 ? 'alert' : chainStale ? 'watch' : 'ok';
      const fiscalStatus: ComponentStatus =
        tseDays === null ? 'ok' : tseDays < 7 ? 'alert' : tseDays <= 30 ? 'watch' : 'ok';
      const alertsStatus: ComponentStatus = alerts24 > 0 ? 'watch' : 'ok';
      const databaseStatus: ComponentStatus = 'ok';
      const edgeConfigured = Boolean(opts.env.CLOUDFLARE_API_TOKEN && opts.env.CLOUDFLARE_ZONE_ID);

      const integrations = [
        { key: 'cloudflare', label: 'Cloudflare Edge-Schutz', configured: edgeConfigured },
        {
          key: 'fiskaly',
          label: 'TSE-Sicherung (Fiskaly)',
          configured: Boolean(opts.env.FISKALY_API_KEY && opts.env.FISKALY_API_SECRET),
        },
        { key: 'stripe', label: 'Kartenzahlung (Stripe)', configured: Boolean(opts.env.STRIPE_SECRET_KEY) },
        { key: 'r2', label: 'Fotospeicher (R2)', configured: Boolean(opts.env.R2_BUCKET) },
        {
          key: 'opensanctions',
          label: 'Sanktionsprüfung',
          configured: Boolean(opts.env.OPENSANCTIONS_API_KEY),
        },
        { key: 'metrics', label: 'Metrik-Schutz', configured: Boolean(opts.env.METRICS_TOKEN) },
      ];

      const problems: TProblem[] = [];
      if (dlq > 0) {
        problems.push({
          id: 'worker-dlq',
          severity: 'alert',
          title: 'Hintergrundjobs fehlgeschlagen',
          detail: `${dlq} ${dlq === 1 ? 'Vorgang liegt' : 'Vorgänge liegen'} unbestätigt in der Fehler-Warteschlange.`,
          surface: '/tagebuch',
        });
      }
      if (tseDays !== null && tseDays < 7) {
        problems.push({
          id: 'tse-expiry',
          severity: 'alert',
          title: 'TSE-Zertifikat läuft ab',
          detail: `Nur noch ${tseDays} ${tseDays === 1 ? 'Tag' : 'Tage'}. Ohne gültiges Zertifikat ist kein rechtssicherer Verkauf möglich.`,
          surface: '/einstellungen',
        });
      } else if (tseDays !== null && tseDays <= 30) {
        problems.push({
          id: 'tse-expiry-soon',
          severity: 'watch',
          title: 'TSE-Zertifikat bald erneuern',
          detail: `Läuft in ${tseDays} Tagen ab.`,
          surface: '/einstellungen',
        });
      }
      if (chainStale) {
        problems.push({
          id: 'chain-stale',
          severity: 'watch',
          title: 'Prüfsummenkette nicht kürzlich verifiziert',
          detail: 'Die letzte erfolgreiche Verifizierung liegt über 24 Stunden zurück.',
          surface: '/tagebuch',
        });
      }
      if (alerts24 > 0) {
        problems.push({
          id: 'alerts-24',
          severity: 'watch',
          title: 'Neue Warnsignale',
          detail: `${alerts24} in den letzten 24 Stunden. In der Risikoanalyse prüfen.`,
          surface: '/risiko',
        });
      }
      if (!edgeConfigured) {
        problems.push({
          id: 'edge-unconfigured',
          severity: 'watch',
          title: 'Edge-Schutz nicht verbunden',
          detail:
            'Cloudflare ist noch nicht hinterlegt. Sobald der Analyse-Schlüssel gesetzt ist, erscheinen hier die abgewehrten Angriffe.',
          surface: '/risiko',
        });
      }

      // Top-line verdict = worst component. An unconfigured edge is a config gap
      // (watch), never a system alert on its own.
      const core: ComponentStatus[] = [workerStatus, fiscalStatus, alertsStatus, databaseStatus];
      const status: ComponentStatus = core.includes('alert')
        ? 'alert'
        : core.includes('watch') || !edgeConfigured
          ? 'watch'
          : 'ok';

      return reply.status(200).send({
        status,
        computedAt: new Date().toISOString(),
        components: {
          api: { status: 'ok' as const },
          database: { status: databaseStatus, migrationsApplied, latestMigration },
          worker: {
            status: workerStatus,
            deadLetter: dlq,
            oldestDeadLetterAt: r.dlq_oldest ? new Date(r.dlq_oldest).toISOString() : null,
            running,
            chainLastVerifiedAt: chainLastOk ? chainLastOk.toISOString() : null,
          },
          fiscal: {
            status: fiscalStatus,
            tseCertDaysRemaining: tseDays,
            tseCertValidUntil: r.tse_soonest ? new Date(r.tse_soonest).toISOString() : null,
          },
          alerts: { status: alertsStatus, last24h: alerts24, last7d: alerts7 },
          edge: { status: edgeConfigured ? ('ok' as const) : ('unconfigured' as const), configured: edgeConfigured },
        },
        integrations,
        problems,
      });
    },
  );
};

export default systemHealthRoutes;
