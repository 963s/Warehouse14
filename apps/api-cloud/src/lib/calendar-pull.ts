/**
 * calendar-pull — the inbound half of the two-way Google Calendar sync.
 *
 * The outbound half (appointment-calendar-sync.ts) mirrors every booking INTO
 * Google. This pulls changes made directly IN Google (e.g. the owner drags an
 * appointment to a new time, or adds/deletes an event from his phone) back into
 * the `appointments` table — so the Termine cockpit, the no-show detector and
 * the double-booking guard all stay in step with the calendar.
 *
 * No ping-pong: this writes the DB DIRECTLY (never via the mirroring routes),
 * so a Google→DB change is not re-pushed to Google. Matching is by
 * `google_event_id`. A new Google-only event becomes a fresh appointment
 * (source='GOOGLE'); a slot already holding an unlinked system booking is left
 * alone (race guard while the outbound mirror links it).
 *
 * Runs on a ~90s interval in the api process (see startCalendarPoller), using a
 * persisted Google syncToken for cheap incremental polling.
 */

import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { calendarConfigured, syncEvents } from './google-calendar.js';

const SYNC_TOKEN_KEY = 'calendar.pull_sync_token';
const TERMINAL_STATUSES = new Set(['COMPLETED', 'NO_SHOW', 'CANCELLED', 'RESCHEDULED']);

export interface PullEvent {
  id: string;
  status: string;
  startIso: string | null;
  endIso: string | null;
  summary: string | null;
  description: string | null;
  created: string | null;
}

export interface MatchedAppointment {
  id: string;
  status: string;
  startsAt: string;
  durationMinutes: number;
}

export type PullAction =
  | { kind: 'skip' }
  | { kind: 'cancel'; appointmentId: string }
  | { kind: 'reschedule'; appointmentId: string; startIso: string; durationMinutes: number }
  | { kind: 'import'; startIso: string; durationMinutes: number; title: string; notes: string | null };

/** Pure decision: given a changed Google event + the local state, what to do. */
export function decidePullAction(
  event: PullEvent,
  matched: MatchedAppointment | null,
  unlinkedAppointmentAtStart: boolean,
): PullAction {
  // Deleted / cancelled in Google.
  if (event.status === 'cancelled') {
    if (matched && !TERMINAL_STATUSES.has(matched.status)) {
      return { kind: 'cancel', appointmentId: matched.id };
    }
    return { kind: 'skip' };
  }

  // Active event needs a concrete start + end (ignore all-day / malformed).
  if (!event.startIso || !event.endIso) return { kind: 'skip' };
  const durationMinutes = Math.max(
    1,
    Math.round((new Date(event.endIso).getTime() - new Date(event.startIso).getTime()) / 60_000),
  );

  if (matched) {
    if (TERMINAL_STATUSES.has(matched.status)) return { kind: 'skip' };
    const sameStart =
      new Date(matched.startsAt).getTime() === new Date(event.startIso).getTime();
    const sameDuration = matched.durationMinutes === durationMinutes;
    if (sameStart && sameDuration) return { kind: 'skip' };
    return { kind: 'reschedule', appointmentId: matched.id, startIso: event.startIso, durationMinutes };
  }

  // No local appointment carries this event id.
  if (unlinkedAppointmentAtStart) return { kind: 'skip' }; // outbound mirror is linking it
  return {
    kind: 'import',
    startIso: event.startIso,
    durationMinutes,
    title: event.summary ?? 'Termin (Kalender)',
    notes: event.description ?? null,
  };
}

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}
interface LoggerLike {
  info(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

async function loadSyncToken(db: DbLike): Promise<string | null> {
  const rows = (await db.execute(
    sql`SELECT value #>> '{}' AS token FROM system_settings WHERE key = ${SYNC_TOKEN_KEY}`,
  )) as unknown as Array<{ token: string | null }>;
  return rows[0]?.token ?? null;
}

async function saveSyncToken(db: DbLike, token: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO system_settings (key, value, description)
    VALUES (${SYNC_TOKEN_KEY}, to_jsonb(${token}::text), 'Google Calendar incremental sync token')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `);
}

/** One incremental sync pass: Google → appointments table. Best-effort. */
export async function runCalendarPull(db: DbLike, log: LoggerLike): Promise<void> {
  if (!calendarConfigured()) return;

  let token = await loadSyncToken(db);
  let res = await syncEvents(token);
  if (res.fullResyncNeeded) {
    log.info({}, 'calendar pull: sync token expired — full resync');
    token = null;
    res = await syncEvents(null);
  }

  let imported = 0;
  let rescheduled = 0;
  let cancelled = 0;

  for (const event of res.events) {
    if (!event.id) continue;

    const matchRows = (await db.execute(sql`
      SELECT id::text AS id, status::text AS status, starts_at::text AS "startsAt", duration_minutes AS "durationMinutes"
      FROM appointments WHERE google_event_id = ${event.id} LIMIT 1
    `)) as unknown as MatchedAppointment[];
    const matched = matchRows[0] ?? null;

    let unlinkedAtStart = false;
    if (!matched && event.status !== 'cancelled' && event.startIso) {
      const u = (await db.execute(sql`
        SELECT 1 AS hit FROM appointments
        WHERE starts_at = ${event.startIso}::timestamptz
          AND google_event_id IS NULL
          AND status NOT IN ('CANCELLED', 'NO_SHOW', 'RESCHEDULED')
        LIMIT 1
      `)) as unknown as Array<{ hit: number }>;
      unlinkedAtStart = u.length > 0;
    }

    const action = decidePullAction(event, matched, unlinkedAtStart);
    try {
      if (action.kind === 'cancel') {
        await db.execute(sql`
          UPDATE appointments
          SET status = 'CANCELLED', cancelled_at = now(),
              cancellation_reason = 'Im Google Kalender gelöscht'
          WHERE id = ${action.appointmentId}::uuid
        `);
        cancelled++;
      } else if (action.kind === 'reschedule') {
        await db.execute(sql`
          UPDATE appointments
          SET starts_at = ${action.startIso}::timestamptz, duration_minutes = ${action.durationMinutes}
          WHERE id = ${action.appointmentId}::uuid
        `);
        rescheduled++;
      } else if (action.kind === 'import') {
        const staffRows = (await db.execute(sql`
          SELECT id::text AS id FROM users
          WHERE role::text IN ('ADMIN', 'CASHIER')
          ORDER BY is_owner DESC, created_at ASC LIMIT 1
        `)) as unknown as Array<{ id: string }>;
        const staffId = staffRows[0]?.id;
        if (staffId) {
          await db.execute(sql`
            INSERT INTO appointments
              (appointment_type, starts_at, duration_minutes, staff_user_id, booked_via, source,
               customer_notes, google_event_id)
            VALUES ('CONSULTATION'::appointment_type, ${action.startIso}::timestamptz,
                    ${action.durationMinutes}, ${staffId}::uuid, 'google_calendar', 'GOOGLE',
                    ${action.title}, ${event.id})
            ON CONFLICT DO NOTHING
          `);
          imported++;
        }
      }
    } catch (err) {
      log.error({ err, eventId: event.id, action: action.kind }, 'calendar pull: apply failed');
    }
  }

  if (res.nextSyncToken) await saveSyncToken(db, res.nextSyncToken);
  if (imported || rescheduled || cancelled) {
    log.info({ imported, rescheduled, cancelled }, 'calendar pull: applied changes');
  }
}

/** Start the ~90s background poller (production only — called from server.ts). */
export function startCalendarPoller(app: FastifyInstance): NodeJS.Timeout | null {
  if (!calendarConfigured()) {
    app.log.info({}, 'calendar poller: not configured — skipping');
    return null;
  }
  const tick = () => {
    void runCalendarPull(app.db as unknown as DbLike, app.log).catch((err: unknown) =>
      app.log.error({ err }, 'calendar pull tick failed'),
    );
  };
  setTimeout(tick, 5_000); // first pass shortly after boot
  const handle = setInterval(tick, 90_000);
  handle.unref?.();
  app.log.info({}, 'calendar poller: started (90s interval)');
  return handle;
}
