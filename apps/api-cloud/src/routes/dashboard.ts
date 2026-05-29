/**
 * Dashboard summary aggregator (Phase 2 Day 2).
 *
 *   GET /api/dashboard/summary
 *
 * Single round-trip endpoint feeding the Werkstatt + Übersicht tiles on
 * tauri-pos + desktop-control. Replaces 8+ separate fetches per dashboard
 * render. Tuned for "fast first paint" — every sub-query is either a
 * partial-index hit (status='OPEN' / valid_to IS NULL) or a 1-row scan
 * (`worker_job_runs LIMIT 1`).
 *
 * Auth: ADMIN + CASHIER. The shape is identical for both roles; counters
 * the cashier doesn't have permission to act on still appear (read-only).
 */

import { type Static, Type } from '@sinclair/typebox';
import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { requireAuth, requireRole } from '../lib/auth-policy.js';

const DashboardSummaryResponse = Type.Object({
  /** Tasks assigned to req.actor with status IN (OPEN, IN_PROGRESS, BLOCKED). */
  openTasksMine: Type.Integer(),
  /** Tasks (any assignee) with status IN (OPEN, IN_PROGRESS) and due_date ≤ today. */
  tasksDueToday: Type.Integer(),
  /** Tasks past their due_date that are still not DONE. */
  tasksOverdue: Type.Integer(),

  /** Appraisals with status IN ('DRAFT','COMPLETED') — awaiting Owner decision. */
  pendingAppraisals: Type.Integer(),

  /** Photos still awaiting assignment (orphan + workflow_state < ZUGEORDNET). */
  unassignedPhotos: Type.Integer(),

  /** Products currently RESERVED via EBAY channel — eBay's "sold but not yet shipped" pipeline depth. */
  ebayPipelineDepth: Type.Integer(),
  /** Distinct alert.ebay_sale_conflict ledger rows in the last 7 days. */
  ebayConflictsWeek: Type.Integer(),

  /** Current shift id (NULL when no shift open on this device). */
  currentShiftId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  /** Sum of finalized transaction totals on the open shift, EUR. */
  currentShiftRevenueEur: Type.String(),

  /** Customers in trust_level IN ('SUSPICIOUS','BANNED'). */
  watchlistCustomerCount: Type.Integer(),

  /** Worker daemons that have a RUNNING row right now (no SUCCESS terminal yet). */
  workerJobsRunning: Type.Array(Type.String()),
  /** ISO timestamp of the most recent chain-verifier SUCCESS, or null. */
  lastChainVerifiedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  /** Worker DLQ rows that have not been acknowledged. */
  workerDlqUnacked: Type.Integer(),

  /** Current metal prices keyed by metal — null entries when no row recorded. */
  currentMetalPrices: Type.Object({
    gold: Type.Union([Type.String(), Type.Null()]),
    silver: Type.Union([Type.String(), Type.Null()]),
    platinum: Type.Union([Type.String(), Type.Null()]),
    palladium: Type.Union([Type.String(), Type.Null()]),
  }),

  /** When the snapshot was assembled (server time). */
  computedAt: Type.String({ format: 'date-time' }),
});

export type TDashboardSummaryResponse = Static<typeof DashboardSummaryResponse>;

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
  }),
});

const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/dashboard/summary',
    {
      schema: {
        tags: ['dashboard'],
        summary: 'Aggregate counters for the Werkstatt + Übersicht tiles.',
        description:
          'One round-trip replaces the 10+ fetches a dashboard would otherwise need. ' +
          'Every sub-query targets a partial index or a single-row aggregate.',
        response: { 200: DashboardSummaryResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const actorId = req.actor.id;
      const deviceId = req.deviceId ?? null;

      // One big read transaction — gives all sub-queries the same snapshot.
      const rows = await app.db.execute<{
        open_tasks_mine: number;
        tasks_due_today: number;
        tasks_overdue: number;
        pending_appraisals: number;
        unassigned_photos: number;
        ebay_pipeline_depth: number;
        ebay_conflicts_week: number;
        current_shift_id: string | null;
        current_shift_revenue_eur: string;
        watchlist_customer_count: number;
        worker_jobs_running: string[];
        last_chain_verified_at: Date | null;
        worker_dlq_unacked: number;
        gold: string | null;
        silver: string | null;
        platinum: string | null;
        palladium: string | null;
      }>(drizzleSql`
      WITH
        t_mine AS (
          SELECT COUNT(*)::int AS n FROM internal_tasks
           WHERE assigned_to_user_id = ${actorId}
             AND status IN ('OPEN','IN_PROGRESS','BLOCKED')
        ),
        t_due_today AS (
          SELECT COUNT(*)::int AS n FROM internal_tasks
           WHERE status IN ('OPEN','IN_PROGRESS')
             AND due_date IS NOT NULL
             AND due_date <= current_date
        ),
        t_overdue AS (
          SELECT COUNT(*)::int AS n FROM internal_tasks
           WHERE status IN ('OPEN','IN_PROGRESS','BLOCKED')
             AND due_date IS NOT NULL
             AND due_date < current_date
        ),
        appr AS (
          SELECT COUNT(*)::int AS n FROM appraisals
           WHERE status IN ('DRAFT','COMPLETED')
        ),
        photos_un AS (
          SELECT COUNT(*)::int AS n FROM product_photos
           WHERE product_id IS NULL
             AND workflow_state IN ('FOTOGRAFIERT','BEARBEITET','FREIGESTELLT')
        ),
        ebay_pipeline AS (
          SELECT COUNT(*)::int AS n FROM products
           WHERE status = 'RESERVED'
             AND reserved_by_channel = 'EBAY'
        ),
        ebay_conflicts AS (
          SELECT COUNT(*)::int AS n FROM ledger_events
           WHERE event_type = 'alert.ebay_sale_conflict'
             AND created_at > now() - interval '7 days'
        ),
        current_shift AS (
          SELECT id FROM shifts
           WHERE status = 'OPEN'
             ${
               // Filter to the calling device when known so cashiers see THEIR shift.
               deviceId ? drizzleSql`AND device_id = ${deviceId}::uuid` : drizzleSql``
             }
           ORDER BY opened_at DESC LIMIT 1
        ),
        shift_rev AS (
          SELECT COALESCE(SUM(t.total_eur), 0)::text AS s
            FROM transactions t
            JOIN current_shift cs ON cs.id = t.shift_id
           WHERE t.direction = 'VERKAUF'
             AND t.storno_of_transaction_id IS NULL
        ),
        watchlist AS (
          SELECT COUNT(*)::int AS n FROM customers
           WHERE soft_deleted_at IS NULL
             AND trust_level IN ('SUSPICIOUS','BANNED')
        ),
        wj_running AS (
          SELECT COALESCE(array_agg(DISTINCT job_name), ARRAY[]::text[]) AS arr
            FROM worker_job_runs
           WHERE status = 'RUNNING'
        ),
        wj_chain AS (
          SELECT MAX(finished_at) AS t FROM worker_job_runs
           WHERE job_name = 'chain_verifier'
             AND status = 'SUCCESS'
        ),
        wj_dlq AS (
          SELECT COUNT(*)::int AS n FROM worker_job_dlq
           WHERE acked_at IS NULL
        ),
        metal_gold      AS (SELECT current_metal_price_eur_per_gram('gold')::text      AS v),
        metal_silver    AS (SELECT current_metal_price_eur_per_gram('silver')::text    AS v),
        metal_platinum  AS (SELECT current_metal_price_eur_per_gram('platinum')::text  AS v),
        metal_palladium AS (SELECT current_metal_price_eur_per_gram('palladium')::text AS v)
      SELECT
        (SELECT n FROM t_mine)              AS open_tasks_mine,
        (SELECT n FROM t_due_today)         AS tasks_due_today,
        (SELECT n FROM t_overdue)           AS tasks_overdue,
        (SELECT n FROM appr)                AS pending_appraisals,
        (SELECT n FROM photos_un)           AS unassigned_photos,
        (SELECT n FROM ebay_pipeline)       AS ebay_pipeline_depth,
        (SELECT n FROM ebay_conflicts)      AS ebay_conflicts_week,
        (SELECT id::text FROM current_shift) AS current_shift_id,
        (SELECT s FROM shift_rev)           AS current_shift_revenue_eur,
        (SELECT n FROM watchlist)           AS watchlist_customer_count,
        (SELECT arr FROM wj_running)        AS worker_jobs_running,
        (SELECT t FROM wj_chain)            AS last_chain_verified_at,
        (SELECT n FROM wj_dlq)              AS worker_dlq_unacked,
        (SELECT v FROM metal_gold)          AS gold,
        (SELECT v FROM metal_silver)        AS silver,
        (SELECT v FROM metal_platinum)      AS platinum,
        (SELECT v FROM metal_palladium)     AS palladium
    `);

      const r = (
        rows as unknown as Array<{
          open_tasks_mine: number;
          tasks_due_today: number;
          tasks_overdue: number;
          pending_appraisals: number;
          unassigned_photos: number;
          ebay_pipeline_depth: number;
          ebay_conflicts_week: number;
          current_shift_id: string | null;
          current_shift_revenue_eur: string;
          watchlist_customer_count: number;
          worker_jobs_running: string[];
          last_chain_verified_at: Date | null;
          worker_dlq_unacked: number;
          gold: string | null;
          silver: string | null;
          platinum: string | null;
          palladium: string | null;
        }>
      )[0];

      if (!r) {
        throw new Error('dashboard summary returned no rows');
      }

      return reply.status(200).send({
        openTasksMine: Number(r.open_tasks_mine ?? 0),
        tasksDueToday: Number(r.tasks_due_today ?? 0),
        tasksOverdue: Number(r.tasks_overdue ?? 0),
        pendingAppraisals: Number(r.pending_appraisals ?? 0),
        unassignedPhotos: Number(r.unassigned_photos ?? 0),
        ebayPipelineDepth: Number(r.ebay_pipeline_depth ?? 0),
        ebayConflictsWeek: Number(r.ebay_conflicts_week ?? 0),
        currentShiftId: r.current_shift_id,
        currentShiftRevenueEur: r.current_shift_revenue_eur ?? '0',
        watchlistCustomerCount: Number(r.watchlist_customer_count ?? 0),
        workerJobsRunning: Array.isArray(r.worker_jobs_running) ? r.worker_jobs_running : [],
        lastChainVerifiedAt: r.last_chain_verified_at
          ? r.last_chain_verified_at.toISOString()
          : null,
        workerDlqUnacked: Number(r.worker_dlq_unacked ?? 0),
        currentMetalPrices: {
          gold: r.gold,
          silver: r.silver,
          platinum: r.platinum,
          palladium: r.palladium,
        },
        computedAt: new Date().toISOString(),
      });
    },
  );
};

export default dashboardRoutes;
