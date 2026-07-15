/**
 * MCP tool: `agenda` — the Jarvis assistant's read-only "what is coming up" view.
 *
 * READ-ONLY. Mutates nothing, touches no encrypted PII. Both sub-queries are
 * copied verbatim in shape from VERIFIED route/tool queries:
 *
 *   • Upcoming appointments — the SELECT columns, `starts_at` order column and
 *     the `status NOT IN ('CANCELLED','RESCHEDULED')` filter come from the
 *     verified GET /api/appointments list + feed queries (routes/appointments.ts).
 *     Only the non-PII `contact_name` walk-in field is read — the encrypted
 *     registered-customer name is deliberately NOT joined (same rule the feed
 *     applies). `berlin_business_day()` (migrations/0002_helpers.sql) marks the
 *     rows that fall on today.
 *
 *   • Open internal tasks — the `status IN ('OPEN','IN_PROGRESS')` filter and the
 *     `due_date` column come from the verified `situation_report` tool
 *     (mcp/tools/situation-report.ts), which copied them from routes/dashboard.ts.
 *
 * The voice assistant calls this to answer "was steht heute an?" / "welche
 * Termine habe ich diese Woche?" with real rows instead of guessing.
 *
 * CONTRACT
 * ────────
 * Input:  { days?: number }  (default 7, how far ahead to look)
 * Output: {
 *   days: number,
 *   appointmentsToday: number,
 *   appointmentsUpcoming: number,
 *   openTasks: number,
 *   appointments: Array<{ id, type, subject, status, startsAt, startTimeLocal, customerName }>,
 *   tasks: Array<{ id, title, dueDate, status }>,
 *   asOf: string,   // ISO timestamp
 * }
 */

import { Type, type Static } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';

import type { ToolHandler, ToolInvocationContext, ToolRegistration, ToolResult } from '../types.js';

export const AgendaArgs = Type.Object({
  days: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 90,
      description: 'How many days ahead to look. Defaults to 7.',
    }),
  ),
});
type TAgendaArgs = Static<typeof AgendaArgs>;

/** German, speakable label per appointment type (mirrors routes/appointments.ts). */
const TYPE_LABEL_DE: Record<string, string> = {
  VIEWING: 'Besichtigung',
  BUYBACK_EVAL: 'Ankauf-Bewertung',
  CONSULTATION: 'Beratung',
  PICKUP: 'Abholung',
};

/** Europe/Berlin HH:MM for a timestamptz string, so the model can speak it. */
function berlinTime(iso: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Berlin',
  }).format(new Date(iso));
}

const handler: ToolHandler<TAgendaArgs> = async (
  ctx: ToolInvocationContext,
  args: TAgendaArgs,
): Promise<ToolResult> => {
  const days = args?.days ?? 7;

  // ── Upcoming appointments in the next N days ────────────────────────────
  // Columns + status filter copied from the verified GET /api/appointments
  // list query (routes/appointments.ts). Only the non-PII contact_name is read.
  const apptRows = (await ctx.db.execute<{
    id: string;
    appointment_type: string;
    status: string;
    starts_at: string;
    contact_name: string | null;
    is_today: boolean;
  }>(sql`
    SELECT a.id::text                                                 AS id,
           a.appointment_type::text                                   AS appointment_type,
           a.status::text                                             AS status,
           a.starts_at::text                                          AS starts_at,
           a.contact_name                                             AS contact_name,
           (berlin_business_day(a.starts_at) = berlin_business_day(now())) AS is_today
      FROM appointments a
     WHERE a.starts_at >= now()
       AND a.starts_at <  now() + make_interval(days => ${days}::int)
       AND a.status NOT IN ('CANCELLED', 'RESCHEDULED')
     ORDER BY a.starts_at ASC
     LIMIT 100
  `)) as unknown as Array<{
    id: string;
    appointment_type: string;
    status: string;
    starts_at: string;
    contact_name: string | null;
    is_today: boolean;
  }>;

  // ── Open internal tasks ─────────────────────────────────────────────────
  // Filter + due_date column copied from the verified situation_report tool.
  const taskRows = (await ctx.db.execute<{
    id: string;
    title: string;
    due_date: string | null;
    status: string;
  }>(sql`
    SELECT t.id::text        AS id,
           t.title           AS title,
           t.due_date::text  AS due_date,
           t.status::text    AS status
      FROM internal_tasks t
     WHERE t.status IN ('OPEN', 'IN_PROGRESS')
     ORDER BY t.due_date ASC NULLS LAST, t.created_at DESC
     LIMIT 100
  `)) as unknown as Array<{
    id: string;
    title: string;
    due_date: string | null;
    status: string;
  }>;

  const appointments = apptRows.map((r) => ({
    id: r.id,
    type: r.appointment_type,
    subject: TYPE_LABEL_DE[r.appointment_type] ?? r.appointment_type,
    status: r.status,
    startsAt: r.starts_at,
    startTimeLocal: berlinTime(r.starts_at),
    customerName: r.contact_name ?? null,
  }));

  const tasks = taskRows.map((r) => ({
    id: r.id,
    title: r.title,
    dueDate: r.due_date ?? null,
    status: r.status,
  }));

  const appointmentsToday = apptRows.filter((r) => r.is_today === true).length;

  const data = {
    days,
    appointmentsToday,
    appointmentsUpcoming: appointments.length,
    openTasks: tasks.length,
    appointments,
    tasks,
    asOf: new Date().toISOString(),
  };

  // ── Compact German summary the voice model can speak directly ───────────
  const termWord = appointmentsToday === 1 ? 'Termin' : 'Termine';
  const taskWord = tasks.length === 1 ? 'offene Aufgabe' : 'offene Aufgaben';

  const next = appointments[0];
  const nextLine = next
    ? `Nächster Termin: ${next.subject}${next.customerName ? ` mit ${next.customerName}` : ''} um ${next.startTimeLocal} Uhr.`
    : `In den nächsten ${days} Tagen sind keine Termine geplant.`;

  const taskPreview = tasks
    .slice(0, 3)
    .map((t) => (t.dueDate ? `${t.title} (fällig ${t.dueDate})` : t.title))
    .join(', ');
  const taskLine = tasks.length > 0 ? ` Aufgaben: ${taskPreview}.` : '';

  const summary = `Heute ${appointmentsToday} ${termWord}, ${tasks.length} ${taskWord}. ${nextLine}${taskLine}`;

  return {
    content: [{ type: 'text', text: summary }],
    data,
  };
};

export const agendaTool: ToolRegistration = {
  manifest: {
    name: 'agenda',
    description:
      'READ-ONLY. Returns what is coming up: upcoming appointments in the next N days (id, type, ' +
      'German subject label, start time, contact name if present) and open internal tasks (id, ' +
      'title, due date, status). Optional argument { days } (default 7). Use this to answer ' +
      '"was steht heute an?", "welche Termine habe ich diese Woche?", or "welche Aufgaben sind ' +
      'offen?". Reads no encrypted personal data and mutates nothing.',
    inputSchema: AgendaArgs,
    requiredRoles: ['ADMIN', 'CASHIER'],
    isMutation: false,
    // Read-only agenda, only the non-PII contact name is surfaced — safe for the assistant.
    assistantExposed: true,
  },
  handler: handler as ToolHandler<unknown>,
};
