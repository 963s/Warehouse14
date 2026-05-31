/**
 * Owner Control Desktop — the Bridge overview aggregator (ADR-0019 §1).
 *
 *   GET /api/bridge/overview   (ADMIN only)
 *
 * One round-trip assembles the whole three-pane Bridge view-model the
 * control-desktop renders (counts · watch · feed · quickActions · stats ·
 * briefing · bot · appointments). Tuned for "fast first paint": one aggregate
 * CTE plus two small index-hitting reads (feed → ledger PK desc, watch → the
 * tiny `tse_clients` table). Every sub-query targets an existing index:
 *   • transactions          → transactions_direction_day_idx (direction, berlin_business_day)
 *   • products DRAFT count   → products (status, created_at DESC)
 *   • whatsapp unread        → partial idx WHERE handled_at IS NULL
 *   • ledger feed            → PK (id) DESC
 *   • approval anti-join     → ledger_events_event_type_idx (event_type, id DESC)
 *
 * The response shape mirrors the frontend `BridgeData` exactly, so the
 * control-desktop hook is a straight `client.request('GET', …)` swap.
 */

import { type Static, Type } from '@sinclair/typebox';
import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { requireAuth, requireRole } from '../lib/auth-policy.js';

// ── Response schema (mirrors control-desktop BridgeData) ────────────────────

const StatusTone = Type.Union([
  Type.Literal('ok'),
  Type.Literal('watch'),
  Type.Literal('alert'),
  Type.Literal('info'),
]);

const LiveEvent = Type.Object({
  id: Type.String(),
  time: Type.String(),
  tone: StatusTone,
  title: Type.String(),
  detail: Type.String(),
});

const WatchItem = Type.Object({
  id: Type.String(),
  tone: StatusTone,
  text: Type.String(),
});

const QuickAction = Type.Object({
  id: Type.String(),
  label: Type.String(),
  count: Type.Integer(),
  surface: Type.Integer(),
});

const BridgeOverviewResponse = Type.Object({
  briefing: Type.Object({
    greeting: Type.String(),
    lines: Type.Array(Type.String()),
  }),
  feed: Type.Array(LiveEvent),
  watch: Type.Array(WatchItem),
  counts: Type.Object({
    alert: Type.Integer(),
    watch: Type.Integer(),
    ok: Type.Integer(),
  }),
  quickActions: Type.Array(QuickAction),
  bot: Type.Object({
    active: Type.Integer(),
    awaitingHuman: Type.Integer(),
  }),
  appointments: Type.Object({
    next: Type.Union([Type.String(), Type.Null()]),
    today: Type.Integer(),
  }),
  stats: Type.Object({
    revenueEur: Type.String(),
    salesCount: Type.Integer(),
    ankaufCount: Type.Integer(),
    ankaufEur: Type.String(),
  }),
});

export type TBridgeOverviewResponse = Static<typeof BridgeOverviewResponse>;

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
  }),
});

// ── /api/bridge/summary — compact owner KPI snapshot (Task 7) ───────────────
// A flatter, cents-based view-model for the three-column Übersicht. Computed
// from the SAME real columns the rest of the app uses (transactions.total_eur,
// whatsapp_inbound_messages.handled_at, tse_clients.cert_valid_to,
// worker_job_dlq.acked_at) — only the wire contract is cents/camelCase.

const BridgeSummaryResponse = Type.Object({
  todayRevenueCents: Type.Integer(),
  todaySalesCount: Type.Integer(),
  todayAnkaufCount: Type.Integer(),
  todayAnkaufValueCents: Type.Integer(),
  intakeDraftsPending: Type.Integer(),
  approvalsPending: Type.Integer(),
  whatsappUnreadCount: Type.Integer(),
  nextAppointmentAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  todayAppointmentCount: Type.Integer(),
  tseCertDaysRemaining: Type.Union([Type.Integer(), Type.Null()]),
  workerDlqUnacked: Type.Integer(),
  systemStatus: Type.Union([Type.Literal('ok'), Type.Literal('watch'), Type.Literal('alert')]),
  computedAt: Type.String({ format: 'date-time' }),
});

export type TBridgeSummaryResponse = Static<typeof BridgeSummaryResponse>;

type SummaryRow = {
  today_revenue_cents: string | number;
  today_sales_count: number;
  today_ankauf_count: number;
  today_ankauf_value_cents: string | number;
  intake_drafts_pending: number;
  approvals_pending: number;
  whatsapp_unread_count: number;
  next_appointment_at: Date | null;
  today_appointment_count: number;
  tse_cert_days_remaining: number | null;
  worker_dlq_unacked: number;
};

function deriveStatus(
  tseDays: number | null,
  dlq: number,
  approvals: number,
): 'ok' | 'watch' | 'alert' {
  if (tseDays !== null && tseDays < 7) return 'alert';
  if ((tseDays !== null && tseDays <= 30) || dlq > 0 || approvals > 0) return 'watch';
  return 'ok';
}

type StatusToneValue = 'ok' | 'watch' | 'alert' | 'info';

// ── Aggregate + feed row shapes (db.execute generic needs Record types) ─────

type AggRow = {
  alarms: number;
  tse_expiring: number;
  dlq_unacked: number;
  watchlist: number;
  drafts: number;
  unread: number;
  pending_approvals: number;
  revenue: string;
  sales_count: number;
  ankauf_eur: string;
  ankauf_count: number;
  bot_active: number;
  bot_awaiting: number;
  appt_today: number;
  appt_next: string | null;
};

type FeedRow = {
  id: string;
  event_type: string;
  entity_table: string;
  entity_id: string;
  created_at: Date;
};

type TseExpiringRow = {
  id: string;
  description: string | null;
  days_left: number;
};

// ── Presentation helpers ────────────────────────────────────────────────────

/** Berlin wall-clock `HH:MM` for a feed timestamp. */
function berlinHHMM(d: Date): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/** German label for the most common ledger event types; falls back to raw. */
const EVENT_LABELS: Record<string, string> = {
  'transaction.finalized': 'Transaktion abgeschlossen',
  'transaction.storno': 'Storno gebucht',
  'product.reserved': 'Produkt reserviert',
  'product.sold': 'Produkt verkauft',
  'product.ebay_listed': 'eBay-Listing veröffentlicht',
  'alert.ebay_sale_conflict': 'eBay-Verkaufskonflikt',
  'alert.duress': 'Stiller Alarm',
  'alert.sanctions_match': 'Sanktionstreffer',
  'alert.smurfing_detected': 'Smurfing erkannt',
  'command.approval_requested': 'Freigabe angefordert',
  'kyc.captured': 'KYC erfasst',
};

const ENTITY_LABELS: Record<string, string> = {
  transactions: 'Transaktion',
  products: 'Produkt',
  customers: 'Kunde',
  appointments: 'Termin',
};

/** Map a ledger event type onto the status-dot tone (ADR-0019 §5 discipline). */
function toneForEvent(eventType: string): StatusToneValue {
  if (eventType.startsWith('alert.')) return 'alert';
  if (eventType.startsWith('command.')) return 'watch';
  if (/(reserved|draft|pending|requested)/.test(eventType)) return 'watch';
  if (/(finalized|sold|paid|completed|success)/.test(eventType)) return 'ok';
  return 'info';
}

const bridgeRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/bridge/overview',
    {
      schema: {
        tags: ['bridge'],
        summary: 'Live three-pane Bridge overview for the Owner Control Desktop.',
        description:
          'One round-trip assembling alerts, the live feed, quick-action counts, ' +
          "today's stats, and a live Arabic morning briefing. ADMIN only.",
        response: {
          200: BridgeOverviewResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      // ── 1. Aggregate CTE — one snapshot for every counter ───────────────
      const aggRows = (await app.db.execute<AggRow>(drizzleSql`
        WITH
          alarms AS (
            SELECT COUNT(*)::int AS n FROM ledger_events
             WHERE event_type IN (
                     'alert.duress', 'alert.sanctions_match',
                     'alert.smurfing_detected', 'alert.hash_chain_verification_failed'
                   )
               AND created_at > now() - interval '24 hours'
          ),
          tse_exp AS (
            SELECT COUNT(*)::int AS n FROM tse_clients
             WHERE cert_valid_to <= now() + interval '30 days'
          ),
          dlq AS (
            SELECT COUNT(*)::int AS n FROM worker_job_dlq WHERE acked_at IS NULL
          ),
          watchlist AS (
            SELECT COUNT(*)::int AS n FROM customers
             WHERE soft_deleted_at IS NULL
               AND trust_level IN ('SUSPICIOUS', 'BANNED')
          ),
          drafts AS (
            SELECT COUNT(*)::int AS n FROM products WHERE status = 'DRAFT'
          ),
          unread AS (
            SELECT COUNT(*)::int AS n FROM whatsapp_inbound_messages WHERE handled_at IS NULL
          ),
          approvals AS (
            SELECT COUNT(*)::int AS n FROM ledger_events e
             WHERE e.event_type = 'command.approval_requested'
               AND e.created_at > now() - interval '24 hours'
               AND NOT EXISTS (
                 SELECT 1 FROM ledger_events r
                  WHERE r.entity_id = e.entity_id
                    AND r.event_type IN ('command.dispatched', 'command.approval_resolved')
                    AND r.id > e.id
               )
          ),
          sales AS (
            SELECT COALESCE(SUM(total_eur), 0)::text AS revenue, COUNT(*)::int AS n
              FROM transactions
             WHERE direction = 'VERKAUF'
               AND storno_of_transaction_id IS NULL
               AND berlin_business_day(finalized_at) = berlin_business_day(now())
          ),
          ankauf AS (
            SELECT COALESCE(SUM(total_eur), 0)::text AS amount, COUNT(*)::int AS n
              FROM transactions
             WHERE direction = 'ANKAUF'
               AND storno_of_transaction_id IS NULL
               AND berlin_business_day(finalized_at) = berlin_business_day(now())
          ),
          bot AS (
            SELECT
              COUNT(*) FILTER (WHERE ai_active)::int      AS active,
              COUNT(*) FILTER (WHERE NOT ai_active)::int  AS awaiting
              FROM whatsapp_conversations
             WHERE anonymized_at IS NULL
          ),
          appt_today AS (
            SELECT COUNT(*)::int AS n FROM appointments
             WHERE berlin_business_day(starts_at) = berlin_business_day(now())
               AND status NOT IN ('CANCELLED', 'NO_SHOW', 'RESCHEDULED')
          ),
          appt_next AS (
            SELECT to_char(starts_at AT TIME ZONE 'Europe/Berlin', 'HH24:MI') AS t
              FROM appointments
             WHERE starts_at >= now()
               AND status NOT IN ('CANCELLED', 'NO_SHOW', 'RESCHEDULED')
             ORDER BY starts_at ASC
             LIMIT 1
          )
        SELECT
          (SELECT n       FROM alarms)    AS alarms,
          (SELECT n       FROM tse_exp)   AS tse_expiring,
          (SELECT n       FROM dlq)       AS dlq_unacked,
          (SELECT n       FROM watchlist) AS watchlist,
          (SELECT n       FROM drafts)    AS drafts,
          (SELECT n       FROM unread)    AS unread,
          (SELECT n       FROM approvals) AS pending_approvals,
          (SELECT revenue FROM sales)     AS revenue,
          (SELECT n       FROM sales)     AS sales_count,
          (SELECT amount  FROM ankauf)    AS ankauf_eur,
          (SELECT n       FROM ankauf)    AS ankauf_count,
          (SELECT active  FROM bot)       AS bot_active,
          (SELECT awaiting FROM bot)      AS bot_awaiting,
          (SELECT n       FROM appt_today) AS appt_today,
          (SELECT t       FROM appt_next)  AS appt_next
      `)) as unknown as AggRow[];

      const agg = aggRows[0];
      if (!agg) {
        throw new Error('bridge overview aggregate returned no rows');
      }

      // ── 2. Live feed — last 20 ledger events (PK desc) ──────────────────
      const feedRows = (await app.db.execute<FeedRow>(drizzleSql`
        SELECT id::text AS id, event_type, entity_table, entity_id::text AS entity_id, created_at
          FROM ledger_events
         ORDER BY id DESC
         LIMIT 20
      `)) as unknown as FeedRow[];

      const feed = feedRows.map((row) => ({
        id: row.id,
        time: berlinHHMM(row.created_at),
        tone: toneForEvent(row.event_type),
        title: EVENT_LABELS[row.event_type] ?? row.event_type,
        detail: `${ENTITY_LABELS[row.entity_table] ?? row.entity_table} · ${row.entity_id.slice(0, 8)}`,
      }));

      // ── 3. Dynamic watch items (left rail) ──────────────────────────────
      const tseRows = (await app.db.execute<TseExpiringRow>(drizzleSql`
        SELECT id::text AS id, description,
               GREATEST(0, CEIL(EXTRACT(EPOCH FROM (cert_valid_to - now())) / 86400))::int AS days_left
          FROM tse_clients
         WHERE cert_valid_to <= now() + interval '30 days'
         ORDER BY cert_valid_to ASC
         LIMIT 5
      `)) as unknown as TseExpiringRow[];

      const watch: Array<{ id: string; tone: StatusToneValue; text: string }> = [];
      for (const t of tseRows) {
        const name = t.description ? ` (${t.description})` : '';
        watch.push({
          id: `tse-${t.id}`,
          tone: t.days_left <= 7 ? 'alert' : 'watch',
          text: `TSE-Zertifikat${name} läuft in ${t.days_left} Tagen ab`,
        });
      }
      if (agg.dlq_unacked > 0) {
        watch.push({
          id: 'reconciler-dlq',
          tone: 'watch',
          text: `Reconciler-Warteschlange: ${agg.dlq_unacked} unbestätigte Einträge`,
        });
      }
      if (agg.watchlist > 0) {
        watch.push({
          id: 'watchlist',
          tone: 'watch',
          text: `${agg.watchlist} Kunden auf der Beobachtungsliste`,
        });
      }

      // ── 4. Counts (🔴 / 🟡 / 🟢) ────────────────────────────────────────
      const counts = {
        alert: agg.alarms,
        watch: watch.length,
        ok: agg.sales_count + agg.ankauf_count,
      };

      // ── 5. Quick actions (→ Karteikasten surfaces) ──────────────────────
      const quickActions = [
        { id: 'drafts', label: 'Intake-Entwürfe', count: agg.drafts, surface: 2 },
        { id: 'inbox', label: 'Posteingang', count: agg.unread, surface: 4 },
        { id: 'approvals', label: 'Genehmigungen', count: agg.pending_approvals, surface: 2 },
      ];

      // ── 6. Live Arabic morning briefing (template + today's real numbers) ─
      const lines: string[] = [
        `${agg.drafts} مسودات بانتظار موافقتك`,
        `${agg.unread} رسائل غير مقروءة في الوارد`,
      ];
      if (agg.pending_approvals > 0) {
        lines.push(`${agg.pending_approvals} عملية بيع بانتظار موافقتك`);
      }
      lines.push(
        `${agg.appt_today} مواعيد اليوم${agg.appt_next ? ` — أولها ${agg.appt_next}` : ''}`,
      );
      lines.push(
        `مبيعات اليوم: €${agg.revenue} · ${agg.sales_count} بيع · ${agg.ankauf_count} شراء`,
      );
      if (agg.tse_expiring > 0) {
        lines.push(`تنبيه: ${agg.tse_expiring} شهادة TSE تنتهي خلال 30 يوم`);
      }

      return reply.status(200).send({
        briefing: { greeting: 'صباح الخير. اليوم عندك:', lines },
        feed,
        watch,
        counts,
        quickActions,
        bot: { active: agg.bot_active, awaitingHuman: agg.bot_awaiting },
        appointments: { next: agg.appt_next, today: agg.appt_today },
        stats: {
          revenueEur: agg.revenue,
          salesCount: agg.sales_count,
          ankaufCount: agg.ankauf_count,
          ankaufEur: agg.ankauf_eur,
        },
      });
    },
  );

  // ── GET /api/bridge/summary — compact cents-based KPI snapshot (Task 7) ────
  app.get(
    '/api/bridge/summary',
    {
      schema: {
        tags: ['bridge'],
        summary: 'Compact owner KPI snapshot for the three-column Übersicht. ADMIN only.',
        description:
          "Today's revenue/Ankauf (cents), the four queues, the next appointment, and " +
          'system health (TSE cert headroom + worker DLQ) in one CTE round-trip.',
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

      const rows = (await app.db.execute<SummaryRow>(drizzleSql`
        WITH
          sales AS (
            SELECT COALESCE(SUM(total_eur), 0) AS revenue, COUNT(*)::int AS n
              FROM transactions
             WHERE direction = 'VERKAUF'
               AND storno_of_transaction_id IS NULL
               AND berlin_business_day(finalized_at) = berlin_business_day(now())
          ),
          ankauf AS (
            SELECT COALESCE(SUM(total_eur), 0) AS amount, COUNT(*)::int AS n
              FROM transactions
             WHERE direction = 'ANKAUF'
               AND storno_of_transaction_id IS NULL
               AND berlin_business_day(finalized_at) = berlin_business_day(now())
          ),
          drafts AS (
            SELECT COUNT(*)::int AS n FROM products WHERE status = 'DRAFT'
          ),
          approvals AS (
            SELECT COUNT(*)::int AS n FROM ledger_events e
             WHERE e.event_type = 'command.approval_requested'
               AND e.created_at > now() - interval '24 hours'
               AND NOT EXISTS (
                 SELECT 1 FROM ledger_events r
                  WHERE r.entity_id = e.entity_id
                    AND r.event_type IN ('command.dispatched', 'command.approval_resolved')
                    AND r.id > e.id
               )
          ),
          unread AS (
            SELECT COUNT(*)::int AS n FROM whatsapp_inbound_messages WHERE handled_at IS NULL
          ),
          appt_next AS (
            SELECT starts_at
              FROM appointments
             WHERE starts_at > now()
               AND status NOT IN ('CANCELLED', 'NO_SHOW', 'RESCHEDULED')
             ORDER BY starts_at ASC
             LIMIT 1
          ),
          appt_today AS (
            SELECT COUNT(*)::int AS n FROM appointments
             WHERE berlin_business_day(starts_at) = berlin_business_day(now())
               AND status NOT IN ('CANCELLED', 'NO_SHOW', 'RESCHEDULED')
          ),
          tse AS (
            SELECT FLOOR(MIN(EXTRACT(EPOCH FROM (cert_valid_to - now()))) / 86400)::int AS days
              FROM tse_clients
          ),
          dlq AS (
            SELECT COUNT(*)::int AS n FROM worker_job_dlq WHERE acked_at IS NULL
          )
        SELECT
          (SELECT (revenue * 100)::bigint FROM sales)  AS today_revenue_cents,
          (SELECT n FROM sales)                        AS today_sales_count,
          (SELECT n FROM ankauf)                       AS today_ankauf_count,
          (SELECT (amount * 100)::bigint FROM ankauf)  AS today_ankauf_value_cents,
          (SELECT n FROM drafts)                       AS intake_drafts_pending,
          (SELECT n FROM approvals)                    AS approvals_pending,
          (SELECT n FROM unread)                       AS whatsapp_unread_count,
          (SELECT starts_at FROM appt_next)            AS next_appointment_at,
          (SELECT n FROM appt_today)                   AS today_appointment_count,
          (SELECT days FROM tse)                       AS tse_cert_days_remaining,
          (SELECT n FROM dlq)                          AS worker_dlq_unacked
      `)) as unknown as SummaryRow[];

      const r = rows[0];
      if (!r) {
        throw new Error('bridge summary returned no rows');
      }

      const tseCertDaysRemaining =
        r.tse_cert_days_remaining === null ? null : Number(r.tse_cert_days_remaining);
      const approvalsPending = Number(r.approvals_pending);
      const workerDlqUnacked = Number(r.worker_dlq_unacked);

      return reply.status(200).send({
        todayRevenueCents: Number(r.today_revenue_cents),
        todaySalesCount: Number(r.today_sales_count),
        todayAnkaufCount: Number(r.today_ankauf_count),
        todayAnkaufValueCents: Number(r.today_ankauf_value_cents),
        intakeDraftsPending: Number(r.intake_drafts_pending),
        approvalsPending,
        whatsappUnreadCount: Number(r.whatsapp_unread_count),
        nextAppointmentAt: r.next_appointment_at ? r.next_appointment_at.toISOString() : null,
        todayAppointmentCount: Number(r.today_appointment_count),
        tseCertDaysRemaining,
        workerDlqUnacked,
        systemStatus: deriveStatus(tseCertDaysRemaining, workerDlqUnacked, approvalsPending),
        computedAt: new Date().toISOString(),
      });
    },
  );
};

export default bridgeRoutes;
