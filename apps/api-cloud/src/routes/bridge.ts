/**
 * Bridge routes — Owner Control Desktop command-centre endpoints.
 *
 *   GET /api/bridge/summary   (ADMIN only)
 *
 * Single-CTE aggregate that powers the three-column Übersicht dashboard.
 * Every sub-query targets an existing partial index so the round-trip
 * stays well under 50ms.
 *
 * Column mapping (real schema → response contract):
 *   transactions.total_eur × 100          → todayRevenueCents / todayAnkaufValueCents
 *   intake_sessions.status='READY_FOR_REVIEW' → intakeDraftsPending
 *   ledger_events (approval anti-join)    → approvalsPending
 *   whatsapp_inbound_messages.handled_at  → whatsappUnreadCount
 *   appointments.starts_at                → nextAppointmentAt / todayAppointmentCount
 *   devices.cert_expires_at (CONTROL_DESKTOP) → tseCertDaysRemaining
 *   worker_job_dlq.acked_at               → workerDlqUnacked
 */

import { type Static, Type } from '@sinclair/typebox';
import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { requireAuth, requireRole } from '../lib/auth-policy.js';

// ── Response schema ──────────────────────────────────────────────────────

const BridgeSummaryResponse = Type.Object({
  /** VERKAUF total in cents for today (Europe/Berlin business day). */
  todayRevenueCents: Type.Integer(),
  /** Number of VERKAUF transactions finalized today. */
  todaySalesCount: Type.Integer(),
  /** Number of ANKAUF transactions finalized today. */
  todayAnkaufCount: Type.Integer(),
  /** ANKAUF total in cents for today. */
  todayAnkaufValueCents: Type.Integer(),

  /** intake_sessions with status='READY_FOR_REVIEW'. */
  intakeDraftsPending: Type.Integer(),
  /** Unresolved command.approval_requested ledger events. */
  approvalsPending: Type.Integer(),
  /** whatsapp_inbound_messages with handled_at IS NULL. */
  whatsappUnreadCount: Type.Integer(),

  /** ISO timestamp of next upcoming appointment (starts_at > now()), or null. */
  nextAppointmentAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  /** Count of today's appointments (Europe/Berlin business day, non-cancelled). */
  todayAppointmentCount: Type.Integer(),

  /**
   * Days until the shortest-lived CONTROL_DESKTOP device cert expires.
   * Null when no CONTROL_DESKTOP device exists.
   */
  tseCertDaysRemaining: Type.Union([Type.Integer(), Type.Null()]),
  /** worker_job_dlq rows with acked_at IS NULL. */
  workerDlqUnacked: Type.Integer(),

  /**
   * Server-derived status:
   *   alert = tseCertDaysRemaining < 7
   *   watch = tseCertDaysRemaining between 7..30 OR dlqUnacked > 0 OR approvalsPending > 0
   *   ok    = everything else
   */
  systemStatus: Type.Union([Type.Literal('ok'), Type.Literal('watch'), Type.Literal('alert')]),

  computedAt: Type.String({ format: 'date-time' }),
});

export type TBridgeSummaryResponse = Static<typeof BridgeSummaryResponse>;

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
  }),
});

// ── Plugin ───────────────────────────────────────────────────────────────

const bridgeRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/bridge/summary',
    {
      schema: {
        tags: ['bridge'],
        summary: 'Owner Bridge — aggregate snapshot for the Übersicht dashboard.',
        description:
          'ADMIN-only. One CTE replaces all individual dashboard fetches. ' +
          'Targets existing partial indexes; p99 < 50ms.',
        response: {
          200: BridgeSummaryResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      type Row = {
        today_revenue_eur: string | null;
        today_sales_count: string | null;
        today_ankauf_count: string | null;
        today_ankauf_eur: string | null;
        intake_drafts_pending: string | null;
        approvals_pending: string | null;
        whatsapp_unread: string | null;
        next_appointment_at: Date | null;
        today_appt_count: string | null;
        cert_days_remaining: string | null;
        dlq_unacked: string | null;
      };

      const rows = await app.db.execute<Row>(drizzleSql`
        WITH
        -- ── Today's VERKAUF & ANKAUF ────────────────────────────────────
        today_txn AS (
          SELECT
            SUM(CASE WHEN direction = 'VERKAUF' AND storno_of_transaction_id IS NULL
                     THEN total_eur ELSE 0 END)               AS revenue_eur,
            COUNT(CASE WHEN direction = 'VERKAUF' AND storno_of_transaction_id IS NULL
                       THEN 1 END)                             AS sales_count,
            COUNT(CASE WHEN direction = 'ANKAUF'
                       THEN 1 END)                             AS ankauf_count,
            SUM(CASE WHEN direction = 'ANKAUF'
                     THEN total_eur ELSE 0 END)               AS ankauf_eur
          FROM transactions
          WHERE DATE(finalized_at AT TIME ZONE 'Europe/Berlin')
              = DATE(now() AT TIME ZONE 'Europe/Berlin')
        ),
        -- ── Intake sessions awaiting review ─────────────────────────────
        intake_pending AS (
          SELECT COUNT(*)::int AS n
          FROM   intake_sessions
          WHERE  status = 'READY_FOR_REVIEW'
        ),
        -- ── Open approvals (approval_requested without a matching resolved) ──
        approvals AS (
          SELECT COUNT(*)::int AS n
          FROM   ledger_events req
          WHERE  req.event_type = 'command.approval_requested'
            AND  NOT EXISTS (
                   SELECT 1 FROM ledger_events res
                   WHERE  res.event_type IN (
                            'command.approval_resolved',
                            'command.approval_dispatched'
                          )
                     AND  res.payload->>'approval_request_id' = req.payload->>'id'
                 )
        ),
        -- ── WhatsApp unread (partial index: whatsapp_inbound_unhandled_idx) ─
        wa_unread AS (
          SELECT COUNT(*)::int AS n
          FROM   whatsapp_inbound_messages
          WHERE  handled_at IS NULL
        ),
        -- ── Next appointment & today count ──────────────────────────────
        appt_next AS (
          SELECT starts_at
          FROM   appointments
          WHERE  starts_at > now()
            AND  status NOT IN ('CANCELLED', 'NO_SHOW', 'RESCHEDULED')
          ORDER  BY starts_at
          LIMIT  1
        ),
        appt_today AS (
          SELECT COUNT(*)::int AS n
          FROM   appointments
          WHERE  DATE(starts_at AT TIME ZONE 'Europe/Berlin')
               = DATE(now() AT TIME ZONE 'Europe/Berlin')
            AND  status NOT IN ('CANCELLED', 'NO_SHOW', 'RESCHEDULED')
        ),
        -- ── Device cert expiry (CONTROL_DESKTOP class) ──────────────────
        cert_expiry AS (
          SELECT EXTRACT(DAY FROM MIN(cert_expires_at) - now())::int AS days_remaining
          FROM   devices
          WHERE  device_class = 'CONTROL_DESKTOP'
            AND  status = 'active'
        ),
        -- ── Worker DLQ unacked ──────────────────────────────────────────
        dlq AS (
          SELECT COUNT(*)::int AS n
          FROM   worker_job_dlq
          WHERE  acked_at IS NULL
        )
        SELECT
          (SELECT revenue_eur   FROM today_txn)           AS today_revenue_eur,
          (SELECT sales_count   FROM today_txn)           AS today_sales_count,
          (SELECT ankauf_count  FROM today_txn)           AS today_ankauf_count,
          (SELECT ankauf_eur    FROM today_txn)           AS today_ankauf_eur,
          (SELECT n             FROM intake_pending)      AS intake_drafts_pending,
          (SELECT n             FROM approvals)           AS approvals_pending,
          (SELECT n             FROM wa_unread)           AS whatsapp_unread,
          (SELECT starts_at     FROM appt_next)           AS next_appointment_at,
          (SELECT n             FROM appt_today)          AS today_appt_count,
          (SELECT days_remaining FROM cert_expiry)        AS cert_days_remaining,
          (SELECT n             FROM dlq)                 AS dlq_unacked
      `);

      const r = (rows as unknown as Row[])[0];
      if (!r) throw new Error('bridge summary returned no rows');

      const todayRevenueCents = Math.round(Number(r.today_revenue_eur ?? 0) * 100);
      const todaySalesCount = Number(r.today_sales_count ?? 0);
      const todayAnkaufCount = Number(r.today_ankauf_count ?? 0);
      const todayAnkaufValueCents = Math.round(Number(r.today_ankauf_eur ?? 0) * 100);
      const intakeDraftsPending = Number(r.intake_drafts_pending ?? 0);
      const approvalsPending = Number(r.approvals_pending ?? 0);
      const whatsappUnreadCount = Number(r.whatsapp_unread ?? 0);
      const nextAppointmentAt = r.next_appointment_at ? r.next_appointment_at.toISOString() : null;
      const todayAppointmentCount = Number(r.today_appt_count ?? 0);
      const tseCertDaysRemaining =
        r.cert_days_remaining != null ? Number(r.cert_days_remaining) : null;
      const workerDlqUnacked = Number(r.dlq_unacked ?? 0);

      // Derive systemStatus server-side per the spec contract.
      let systemStatus: 'ok' | 'watch' | 'alert' = 'ok';
      if (tseCertDaysRemaining != null && tseCertDaysRemaining < 7) {
        systemStatus = 'alert';
      } else if (
        (tseCertDaysRemaining != null && tseCertDaysRemaining <= 30) ||
        workerDlqUnacked > 0 ||
        approvalsPending > 0
      ) {
        systemStatus = 'watch';
      }

      return reply.status(200).send({
        todayRevenueCents,
        todaySalesCount,
        todayAnkaufCount,
        todayAnkaufValueCents,
        intakeDraftsPending,
        approvalsPending,
        whatsappUnreadCount,
        nextAppointmentAt,
        todayAppointmentCount,
        tseCertDaysRemaining,
        workerDlqUnacked,
        systemStatus,
        computedAt: new Date().toISOString(),
      });
    },
  );
};

export default bridgeRoutes;
