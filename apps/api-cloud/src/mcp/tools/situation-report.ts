/**
 * MCP tool: `situation_report` — the Jarvis assistant's read-only view of
 * "how is the day going".
 *
 * READ-ONLY. Touches no PII, mutates nothing. Every sub-query here is copied
 * from the verified `/api/dashboard/summary` aggregator (routes/dashboard.ts),
 * so the columns + functions are known-good. The voice assistant calls this
 * to answer "wie ist der Stand heute?" with real numbers instead of guessing.
 *
 * CONTRACT
 * ────────
 * Input:  {}  (no arguments)
 * Output: {
 *   openShiftRevenueEur: string,   // sum of finalized VERKAUF on the open shift
 *   openShiftId: string | null,
 *   tasksDueToday: number,
 *   tasksOverdue: number,
 *   pendingAppraisals: number,
 *   watchlistCustomers: number,
 *   metalPricesEurPerGram: { gold, silver, platinum, palladium },
 *   asOf: string,                   // ISO timestamp
 * }
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';

import type { ToolHandler, ToolInvocationContext, ToolRegistration, ToolResult } from '../types.js';

export const SituationReportArgs = Type.Object({});

const handler: ToolHandler<Record<string, never>> = async (
  ctx: ToolInvocationContext,
): Promise<ToolResult> => {
  const rows = await ctx.db.execute<{
    open_shift_id: string | null;
    open_shift_revenue_eur: string;
    tasks_due_today: number;
    tasks_overdue: number;
    pending_appraisals: number;
    watchlist_customers: number;
    gold: string | null;
    silver: string | null;
    platinum: string | null;
    palladium: string | null;
  }>(sql`
    WITH
      current_shift AS (
        SELECT id FROM shifts
         WHERE status = 'OPEN'
         ORDER BY opened_at DESC LIMIT 1
      ),
      shift_rev AS (
        SELECT COALESCE(SUM(t.total_eur), 0)::text AS s
          FROM transactions t
          JOIN current_shift cs ON cs.id = t.shift_id
         WHERE t.direction = 'VERKAUF'
           AND t.storno_of_transaction_id IS NULL
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
      watchlist AS (
        SELECT COUNT(*)::int AS n FROM customers
         WHERE soft_deleted_at IS NULL
           AND trust_level IN ('SUSPICIOUS','BANNED')
      ),
      metal_gold      AS (SELECT current_metal_price_eur_per_gram('gold')::text      AS v),
      metal_silver    AS (SELECT current_metal_price_eur_per_gram('silver')::text    AS v),
      metal_platinum  AS (SELECT current_metal_price_eur_per_gram('platinum')::text  AS v),
      metal_palladium AS (SELECT current_metal_price_eur_per_gram('palladium')::text AS v)
    SELECT
      (SELECT id::text FROM current_shift)  AS open_shift_id,
      (SELECT s FROM shift_rev)             AS open_shift_revenue_eur,
      (SELECT n FROM t_due_today)           AS tasks_due_today,
      (SELECT n FROM t_overdue)             AS tasks_overdue,
      (SELECT n FROM appr)                  AS pending_appraisals,
      (SELECT n FROM watchlist)             AS watchlist_customers,
      (SELECT v FROM metal_gold)            AS gold,
      (SELECT v FROM metal_silver)          AS silver,
      (SELECT v FROM metal_platinum)        AS platinum,
      (SELECT v FROM metal_palladium)       AS palladium
  `);

  const r = (rows as unknown as Array<Record<string, unknown>>)[0] ?? {};
  const data = {
    openShiftId: (r.open_shift_id as string | null) ?? null,
    openShiftRevenueEur: (r.open_shift_revenue_eur as string) ?? '0',
    tasksDueToday: Number(r.tasks_due_today ?? 0),
    tasksOverdue: Number(r.tasks_overdue ?? 0),
    pendingAppraisals: Number(r.pending_appraisals ?? 0),
    watchlistCustomers: Number(r.watchlist_customers ?? 0),
    metalPricesEurPerGram: {
      gold: (r.gold as string | null) ?? null,
      silver: (r.silver as string | null) ?? null,
      platinum: (r.platinum as string | null) ?? null,
      palladium: (r.palladium as string | null) ?? null,
    },
    asOf: new Date().toISOString(),
  };

  // A compact German summary line so the voice model can speak it directly.
  const summary =
    `Umsatz offene Schicht: ${data.openShiftRevenueEur} EUR. ` +
    `Aufgaben heute fällig: ${data.tasksDueToday}, überfällig: ${data.tasksOverdue}. ` +
    `Offene Bewertungen: ${data.pendingAppraisals}. ` +
    `Kunden auf der Beobachtungsliste: ${data.watchlistCustomers}.`;

  return {
    content: [{ type: 'text', text: summary }],
    data,
  };
};

export const situationReportTool: ToolRegistration = {
  manifest: {
    name: 'situation_report',
    description:
      'READ-ONLY. Returns the current business situation: open-shift revenue, tasks due today and ' +
      'overdue, pending appraisals, watchlist customers, and current metal prices. No arguments. ' +
      'Use this to answer "wie ist der Stand heute?" with real numbers. Touches no personal data.',
    inputSchema: SituationReportArgs,
    requiredRoles: ['ADMIN', 'CASHIER'],
    isMutation: false,
  },
  handler: handler as ToolHandler<unknown>,
};
