/**
 * No-show detector core (ADR-0020 §8). For each appointment whose grace window
 * has elapsed without a check-in:
 *   1. mark NO_SHOW (+ no_show_marked_at),
 *   2. RELEASE the soft viewing-holds (never DELETE — the schema forbids it; the
 *      worker has UPDATE(released_at, released_reason) only),
 *   3. queue a non-blaming follow-up notification.
 *
 * The DB side is injected (`NoShowDeps`) so the orchestration is unit-testable
 * without a live database — the job wires the real SQL.
 */

export interface ExpiredAppointment {
  id: string;
  customerId: string | null;
  /** Resolved follow-up recipient (phone/email/customer-id), or null. */
  recipient: string | null;
}

export interface NoShowDeps {
  /** Appointments past starts_at + grace, still SCHEDULED/CONFIRMED. */
  listExpired(graceMinutes: number, now: Date): Promise<ExpiredAppointment[]>;
  /** Flip status → NO_SHOW (+ marker). */
  markNoShow(appointmentId: string): Promise<void>;
  /** Release active holds for the appointment; returns rows released. */
  releaseHolds(appointmentId: string, reason: string): Promise<number>;
  /** Queue the no-show follow-up notification (skipped when recipient is null). */
  queueFollowUp(appointment: ExpiredAppointment): Promise<void>;
}

export interface NoShowResult {
  markedNoShow: string[];
  holdsReleased: number;
  followUpsQueued: number;
}

export const NO_SHOW_RELEASE_REASON = 'no_show';

/** Run the no-show sweep over expired appointments. Never throws per-row. */
export async function detectNoShows(
  deps: NoShowDeps,
  opts: { graceMinutes: number; now?: Date; log?: { warn: (m: string, e?: unknown) => void } },
): Promise<NoShowResult> {
  const now = opts.now ?? new Date();
  const expired = await deps.listExpired(opts.graceMinutes, now);

  const result: NoShowResult = { markedNoShow: [], holdsReleased: 0, followUpsQueued: 0 };
  for (const appt of expired) {
    try {
      await deps.markNoShow(appt.id);
      result.markedNoShow.push(appt.id);
      result.holdsReleased += await deps.releaseHolds(appt.id, NO_SHOW_RELEASE_REASON);
      if (appt.recipient) {
        await deps.queueFollowUp(appt);
        result.followUpsQueued += 1;
      }
    } catch (err) {
      opts.log?.warn('no-show detector: per-appointment step failed', err);
    }
  }
  return result;
}
