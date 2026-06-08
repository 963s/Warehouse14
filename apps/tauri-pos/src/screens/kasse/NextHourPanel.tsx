/**
 * NextHourPanel — cashier widget (ADR-0020 §7, ADR-0018 §7). Shows the
 * appointments arriving in the next ~2 hours; one tap checks the customer in
 * and (for VIEWING appointments) hands the linked product ids to the Kasse so
 * it can load them into the checkout tray.
 *
 * The reservation + cart insertion itself lives in the Kasse (it owns the
 * inventory-lock flow); this widget surfaces the items via `onLoadItems`.
 */

import { useMemo } from 'react';

import { APPOINTMENT_TYPE_LABELS, type AppointmentListItem } from '@warehouse14/api-client';
import { berlinTimeHm } from '@warehouse14/appointments';

import { useAppointments, useSetAppointmentStatus } from '../../hooks/useAppointments.js';

export interface NextHourPanelProps {
  /** Called with the appointment's linked product ids on check-in (VIEWING). */
  onLoadItems?: (productIds: string[]) => void;
}

const UPCOMING_STATUSES = new Set(['SCHEDULED', 'CONFIRMED']);

export function NextHourPanel({ onLoadItems }: NextHourPanelProps): JSX.Element {
  const { fromIso, toIso } = useMemo(() => {
    const now = new Date();
    const to = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    return { fromIso: now.toISOString(), toIso: to.toISOString() };
  }, []);

  const { data, isLoading } = useAppointments(fromIso, toIso);
  const setStatus = useSetAppointmentStatus();

  const upcoming = data.filter((a) => UPCOMING_STATUSES.has(a.status));

  const checkIn = (appt: AppointmentListItem) => {
    setStatus.mutate(
      { id: appt.id, status: 'CHECKED_IN' },
      {
        onSuccess: () => {
          if (appt.linked_product_ids.length > 0) onLoadItems?.(appt.linked_product_ids);
        },
      },
    );
  };

  return (
    <section className="next-hour-panel" aria-label="Nächste Termine">
      <h3>Nächste Termine</h3>
      {isLoading ? <p>Lade…</p> : null}
      {!isLoading && upcoming.length === 0 ? <p>Keine Termine in der nächsten Stunde.</p> : null}
      <ul>
        {upcoming.map((appt) => (
          <li key={appt.id} className="next-hour-row">
            <span className="next-hour-time">{berlinTimeHm(new Date(appt.starts_at))}</span>
            <span className="next-hour-type">
              {APPOINTMENT_TYPE_LABELS[appt.appointment_type] ?? appt.appointment_type}
            </span>
            {appt.linked_product_ids.length > 0 ? (
              <span className="next-hour-items">{appt.linked_product_ids.length} Artikel</span>
            ) : null}
            <button type="button" onClick={() => checkIn(appt)} disabled={setStatus.isPending}>
              Check-In
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
