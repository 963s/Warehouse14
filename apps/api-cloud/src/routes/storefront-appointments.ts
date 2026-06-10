/**
 * Public storefront appointment booking — CONTRACT endpoints 1 + 2.
 *
 *   GET  /api/storefront/appointments/slots?date=YYYY-MM-DD&type=…
 *        → { date, slots: [{ startsAt, available }] }   (30-min grid)
 *   POST /api/storefront/appointments/book
 *        → 201 { id, type, startsAt, status: 'SCHEDULED' }
 *
 * DESIGN RULES (mirrors storefront-catalog.ts, the "Storefront Arms"):
 *   • Public by design — `/api/storefront/` is in PUBLIC_PREFIXES, so the
 *     staff-auth + mTLS preHandlers bypass automatically. No `req.actor`.
 *   • Strict per-route rate limits via the global @fastify/rate-limit plugin
 *     (route `config.rateLimit`): book = 5/h/IP, slots = 60/min/IP.
 *   • NO PII echo — the 201 body is exactly { id, type, startsAt, status }.
 *   • Business hours come from system_settings 'appointments.business_hours'
 *     (JSON bands mo-fr / sa / so, Europe/Berlin wall-clock; null = closed),
 *     falling back to the contract default. Slot maths run in Postgres
 *     (`::timestamp AT TIME ZONE 'Europe/Berlin'`) so DST is always correct.
 *   • Collision safety: the booking transaction takes a pg advisory xact lock
 *     keyed on the slot instant, re-checks overlap against every
 *     non-cancelled appointment, then inserts — two racing bookings for the
 *     same slot serialize and the loser gets 409.
 *   • source='WEB', booked_via='storefront', walk-in contact_* fields
 *     (migration 0062). A booking_confirmation row lands in
 *     appointment_notifications (channel 'sse' always; an additional
 *     'whatsapp' row only when the WhatsApp env is configured).
 */

import { type Static, Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { berlinBusinessDay } from '@warehouse14/appointments';

import type { Env } from '../config/env.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

// ────────────────────────────────────────────────────────────────────────
// Errors (German — they surface on the public storefront UI)
// ────────────────────────────────────────────────────────────────────────

class SlotTakenError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}
class BookingValidationError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

// ────────────────────────────────────────────────────────────────────────
// Schemas (Fastify STRIPS undeclared response fields — declare everything)
// ────────────────────────────────────────────────────────────────────────

const APPOINTMENT_TYPE_VALUES = ['VIEWING', 'BUYBACK_EVAL', 'CONSULTATION', 'PICKUP'] as const;
type PublicAppointmentType = (typeof APPOINTMENT_TYPE_VALUES)[number];
const AppointmentTypeSchema = Type.Union(APPOINTMENT_TYPE_VALUES.map((t) => Type.Literal(t)));

const SlotsQuery = Type.Object({
  date: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
  type: AppointmentTypeSchema,
});
type TSlotsQuery = Static<typeof SlotsQuery>;

const SlotsResponse = Type.Object({
  date: Type.String(),
  slots: Type.Array(
    Type.Object({
      startsAt: Type.String({ format: 'date-time' }),
      available: Type.Boolean(),
    }),
  ),
});

const BookBody = Type.Object({
  type: AppointmentTypeSchema,
  startsAt: Type.String({ format: 'date-time' }),
  name: Type.String({ minLength: 2, maxLength: 120 }),
  phone: Type.String({ minLength: 6, maxLength: 32 }),
  email: Type.Optional(Type.String({ format: 'email', maxLength: 200 })),
  note: Type.Optional(Type.String({ maxLength: 500 })),
});
type TBookBody = Static<typeof BookBody>;

const BookResponse = Type.Object({
  id: Type.String({ format: 'uuid' }),
  type: AppointmentTypeSchema,
  startsAt: Type.String({ format: 'date-time' }),
  status: Type.Literal('SCHEDULED'),
});

// ────────────────────────────────────────────────────────────────────────
// Business hours — system_settings 'appointments.business_hours'
// ────────────────────────────────────────────────────────────────────────

/** Web bookings always occupy exactly one 30-minute grid slot (CONTRACT 1). */
const SLOT_MINUTES = 30;

interface DayBand {
  open: string; // 'HH:MM' Berlin wall-clock
  close: string;
}

/** The contract default — also seeded by migration 0062 so they never diverge. */
const DEFAULT_BUSINESS_HOURS: Record<string, readonly [string, string] | null> = {
  'mo-fr': ['10:00', '18:00'],
  sa: ['10:00', '14:00'],
  so: null,
};

const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Resolve the band for a JS weekday (0=Sunday … 6=Saturday); null = closed. */
function bandForWeekday(hours: Record<string, unknown>, weekday: number): DayBand | null {
  const key = weekday === 0 ? 'so' : weekday === 6 ? 'sa' : 'mo-fr';
  const raw = hours[key];
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const [open, close] = raw as [unknown, unknown];
  if (typeof open !== 'string' || typeof close !== 'string') return null;
  if (!HM_RE.test(open) || !HM_RE.test(close) || open >= close) return null;
  return { open, close };
}

interface DbExecutor {
  execute(query: ReturnType<typeof sql>): Promise<unknown>;
}

/** Load the operator-tunable hours JSON; tolerate absent/garbage → default. */
async function loadBusinessHours(db: DbExecutor): Promise<Record<string, unknown>> {
  const rows = (await db.execute(sql`
    SELECT value FROM system_settings WHERE key = 'appointments.business_hours' LIMIT 1
  `)) as Array<{ value: unknown }>;
  const v = rows[0]?.value;
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  if (typeof v === 'string') {
    try {
      const parsed: unknown = JSON.parse(v);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* fall through to default */
    }
  }
  return DEFAULT_BUSINESS_HOURS as Record<string, unknown>;
}

/** JS weekday (0=Sunday…6=Saturday) of a pure YYYY-MM-DD calendar date. */
function weekdayOf(dateYmd: string): number {
  return new Date(`${dateYmd}T12:00:00Z`).getUTCDay();
}

/** True when YYYY-MM-DD is a real calendar date (rejects 2026-02-31). */
function isRealDate(dateYmd: string): boolean {
  const d = new Date(`${dateYmd}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dateYmd;
}

/** Loose phone sanity on top of the length bounds (digits, +, space, /, -, parens). */
const PHONE_RE = /^\+?[0-9][0-9 ()/-]{4,30}$/;

// Active appointments (the same status set as the partial index in 0012) —
// CANCELLED / NO_SHOW / RESCHEDULED never block a slot.
const BLOCKING_STATUSES_SQL = sql`('CANCELLED', 'NO_SHOW', 'RESCHEDULED')`;

export interface StorefrontAppointmentsOpts {
  env: Env;
}

type SlotRow = { slot_start: string; available: boolean };
type InsertedRow = { id: string; starts_at: string };

const storefrontAppointmentsRoutes: FastifyPluginAsync<StorefrontAppointmentsOpts> = async (
  app,
  opts,
) => {
  // ── CONTRACT 1: GET /api/storefront/appointments/slots ────────────────
  app.get<{ Querystring: TSlotsQuery }>(
    '/api/storefront/appointments/slots',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['storefront'],
        summary: 'Public 30-min appointment slot grid for one Berlin day.',
        querystring: SlotsQuery,
        response: { 200: SlotsResponse, 400: ErrorResponse, 429: ErrorResponse },
      },
    },
    async (req, reply) => {
      const q = req.query;
      if (!isRealDate(q.date)) {
        throw new BookingValidationError('Ungültiges Datum.');
      }

      const band = bandForWeekday(await loadBusinessHours(app.db), weekdayOf(q.date));
      if (!band) {
        // Closed day (e.g. Sunday) — a valid request with zero slots.
        return reply.status(200).send({ date: q.date, slots: [] });
      }

      // DST-correct: Postgres converts the Berlin wall-clock bounds to
      // instants, generate_series walks the 30-min grid, and each slot is
      // available iff NO active appointment overlaps it.
      const rows = (await app.db.execute<SlotRow>(sql`
        WITH bounds AS (
          SELECT ((${q.date} || ' ' || ${band.open})::timestamp  AT TIME ZONE 'Europe/Berlin') AS opens,
                 ((${q.date} || ' ' || ${band.close})::timestamp AT TIME ZONE 'Europe/Berlin') AS closes
        )
        SELECT gs::text AS slot_start,
               NOT EXISTS (
                 SELECT 1 FROM appointments a
                 WHERE a.status NOT IN ${BLOCKING_STATUSES_SQL}
                   AND a.starts_at < gs + make_interval(mins => ${SLOT_MINUTES})
                   AND a.ends_at   > gs
               ) AS available
        FROM bounds,
             generate_series(bounds.opens,
                             bounds.closes - make_interval(mins => ${SLOT_MINUTES}),
                             make_interval(mins => ${SLOT_MINUTES})) AS gs
        ORDER BY gs ASC
      `)) as unknown as SlotRow[];

      return reply.status(200).send({
        date: q.date,
        slots: rows.map((r) => ({
          startsAt: new Date(r.slot_start).toISOString(),
          available: r.available,
        })),
      });
    },
  );

  // ── CONTRACT 2: POST /api/storefront/appointments/book ────────────────
  app.post<{ Body: TBookBody }>(
    '/api/storefront/appointments/book',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
      schema: {
        tags: ['storefront'],
        summary: 'Public walk-in appointment booking (no login, source=WEB).',
        body: BookBody,
        response: {
          201: BookResponse,
          400: ErrorResponse,
          409: ErrorResponse,
          429: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const b = req.body;

      const startsAt = new Date(b.startsAt);
      if (Number.isNaN(startsAt.getTime())) {
        throw new BookingValidationError('Ungültiger Zeitpunkt.');
      }
      if (startsAt.getTime() <= Date.now()) {
        throw new BookingValidationError('Der Termin muss in der Zukunft liegen.');
      }
      if (!PHONE_RE.test(b.phone.trim())) {
        throw new BookingValidationError('Ungültige Telefonnummer.');
      }

      // Business-hours + 30-min-grid check, on the Berlin business day the
      // requested instant falls in.
      const day = berlinBusinessDay(startsAt);
      const band = bandForWeekday(await loadBusinessHours(app.db), weekdayOf(day));
      if (!band) {
        throw new BookingValidationError('Außerhalb der Öffnungszeiten.');
      }
      const startIso = startsAt.toISOString();
      const aligned = (await app.db.execute<{ ok: boolean }>(sql`
        SELECT EXISTS (
          SELECT 1
          FROM generate_series(
                 ((${day} || ' ' || ${band.open})::timestamp  AT TIME ZONE 'Europe/Berlin'),
                 ((${day} || ' ' || ${band.close})::timestamp AT TIME ZONE 'Europe/Berlin')
                   - make_interval(mins => ${SLOT_MINUTES}),
                 make_interval(mins => ${SLOT_MINUTES})) AS gs
          WHERE gs = ${startIso}::timestamptz
        ) AS ok
      `)) as unknown as Array<{ ok: boolean }>;
      if (!aligned[0]?.ok) {
        throw new BookingValidationError('Außerhalb der Öffnungszeiten.');
      }

      const whatsappConfigured =
        opts.env.WHATSAPP_ACCESS_TOKEN.length > 0 && opts.env.WHATSAPP_PHONE_NUMBER_ID.length > 0;

      const result = await app.db.transaction(async (txAny) => {
        const tx = txAny as unknown as typeof app.db;

        // Serialize racing bookings for the same instant — the advisory lock
        // is transaction-scoped, so the loser re-checks AFTER the winner's
        // insert is visible and gets the 409.
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(${Math.floor(startsAt.getTime() / 1000)}::bigint)
        `);

        const clash = (await tx.execute<{ hit: number }>(sql`
          SELECT 1 AS hit FROM appointments a
          WHERE a.status NOT IN ${BLOCKING_STATUSES_SQL}
            AND a.starts_at < ${startIso}::timestamptz + make_interval(mins => ${SLOT_MINUTES})
            AND a.ends_at   > ${startIso}::timestamptz
          LIMIT 1
        `)) as unknown as Array<{ hit: number }>;
        if (clash.length > 0) {
          throw new SlotTakenError('Dieser Termin ist leider bereits vergeben.');
        }

        // appointments.staff_user_id is NOT NULL — assign web bookings to the
        // owner (fallback: the longest-standing staff account).
        const staffRows = (await tx.execute<{ id: string }>(sql`
          SELECT id::text AS id FROM users
          WHERE role::text IN ('ADMIN', 'CASHIER')
          ORDER BY is_owner DESC, created_at ASC
          LIMIT 1
        `)) as unknown as Array<{ id: string }>;
        const staffId = staffRows[0]?.id;
        if (!staffId) {
          throw new BookingValidationError('Online-Terminbuchung ist derzeit nicht möglich.');
        }

        const inserted = (await tx.execute<InsertedRow>(sql`
          INSERT INTO appointments
            (appointment_type, starts_at, duration_minutes, staff_user_id, booked_via,
             source, contact_name, contact_phone, contact_email, customer_notes)
          VALUES (${b.type}::appointment_type, ${startIso}::timestamptz, ${SLOT_MINUTES},
                  ${staffId}::uuid, 'storefront',
                  'WEB', ${b.name.trim()}, ${b.phone.trim()}, ${b.email ?? null}, ${b.note ?? null})
          RETURNING id::text AS id, starts_at::text AS starts_at
        `)) as unknown as InsertedRow[];
        const row = inserted[0];
        if (!row) throw new BookingValidationError('Buchung fehlgeschlagen.');

        // Booking confirmation — 'sse' feeds the POS live tray immediately;
        // a 'whatsapp' leg is only queued when the Cloud API is configured.
        await tx.execute(sql`
          INSERT INTO appointment_notifications
            (appointment_id, notification_type, channel, recipient, scheduled_for)
          VALUES (${row.id}::uuid, 'booking_confirmation', 'sse', ${b.phone.trim()}, now())
        `);
        if (whatsappConfigured) {
          await tx.execute(sql`
            INSERT INTO appointment_notifications
              (appointment_id, notification_type, channel, recipient, scheduled_for)
            VALUES (${row.id}::uuid, 'booking_confirmation', 'whatsapp', ${b.phone.trim()}, now())
          `);
        }

        return row;
      });

      // NO PII echo — exactly the booked slot (CONTRACT 2).
      return reply.status(201).send({
        id: result.id,
        type: b.type as PublicAppointmentType,
        startsAt: new Date(result.starts_at).toISOString(),
        status: 'SCHEDULED' as const,
      });
    },
  );
};

export default storefrontAppointmentsRoutes;
