/**
 * TerminDetailSheet — right-edge drawer for one appointment: type/status
 * badge, Berlin time, status transitions (optimistic), link to the
 * Kundenakte, and an inline staff-note editor (status-less PATCH).
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { AppointmentListItem, AppointmentPatchStatus } from '@warehouse14/api-client';
import { APPOINTMENT_STATUS_LABELS, APPOINTMENT_TYPE_LABELS } from '@warehouse14/api-client';
import { Button, DialogBody, DialogFooter, Field, Sheet, Textarea } from '@warehouse14/ui-kit';

import { useToastStore } from '../../state/toast-store.js';
import {
  ALLOWED_APPOINTMENT_TRANSITIONS,
  APPOINTMENT_TYPE_COLORS,
  TRANSITION_ACTION_LABELS,
  berlinDayKey,
  berlinTime,
  canReschedule,
} from './appointment-display.js';
import { useOptimisticStatus, useUpdateStaffNotes } from './useTermineMutations.js';

/** The list row + the note columns the route exposes for the drawer. */
export interface TermineAppointment extends AppointmentListItem {
  staff_notes?: string | null;
  customer_notes?: string | null;
}

const dayFmt = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  weekday: 'long',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

interface TerminDetailSheetProps {
  appointment: TermineAppointment | null;
  onClose: () => void;
}

export function TerminDetailSheet({
  appointment,
  onClose,
}: TerminDetailSheetProps): JSX.Element | null {
  if (!appointment) return null;
  return (
    <Sheet open onClose={onClose} title="Termin-Details">
      {/* key → the note editor re-seeds when another appointment opens */}
      <DetailContent key={appointment.id} appointment={appointment} onClose={onClose} />
    </Sheet>
  );
}

function DetailContent({
  appointment,
  onClose,
}: {
  appointment: TermineAppointment;
  onClose: () => void;
}): JSX.Element {
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const setStatus = useOptimisticStatus();
  const saveNotes = useUpdateStaffNotes();

  const seedNotes = appointment.staff_notes ?? '';
  const [notes, setNotes] = useState(seedNotes);
  const notesDirty = notes !== seedNotes;

  const color = APPOINTMENT_TYPE_COLORS[appointment.appointment_type];
  const transitions = ALLOWED_APPOINTMENT_TRANSITIONS[appointment.status];

  const transition = (status: AppointmentPatchStatus): void => {
    let reason: string | undefined;
    if (status === 'CANCELLED') {
      const input = window.prompt('Storno-Grund (mindestens 4 Zeichen):');
      if (!input || input.trim().length < 4) return;
      reason = input.trim();
    }
    setStatus.mutate(
      { id: appointment.id, status, ...(reason ? { reason } : {}) },
      {
        onError: () =>
          addToast({
            tone: 'alert',
            title: 'Statuswechsel fehlgeschlagen',
            body: 'Der Termin wurde zurückgesetzt. Bitte erneut versuchen.',
          }),
      },
    );
  };

  return (
    <>
      <DialogBody>
        <div style={{ display: 'grid', gap: 16 }}>
          {/* Type badge + status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span
              style={{
                display: 'inline-block',
                padding: '3px 10px',
                borderRadius: 999,
                background: color.bg,
                color: color.text,
                fontSize: '0.78rem',
                fontWeight: 600,
                letterSpacing: '0.03em',
              }}
            >
              {APPOINTMENT_TYPE_LABELS[appointment.appointment_type]}
            </span>
            <span style={{ fontSize: '0.85rem', color: 'var(--w14-ink-aged)' }}>
              {APPOINTMENT_STATUS_LABELS[appointment.status]}
            </span>
          </div>

          {/* When */}
          <div style={{ display: 'grid', gap: 2 }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--w14-ink-faded)' }}>
              {dayFmt.format(new Date(appointment.starts_at))}
            </span>
            <span
              className="w14-tabular"
              style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--w14-ink)' }}
            >
              {berlinTime(appointment.starts_at)} bis {berlinTime(appointment.ends_at)} Uhr
            </span>
            <span style={{ fontSize: '0.78rem', color: 'var(--w14-ink-faded)' }}>
              Dauer {appointment.duration_minutes} Minuten
              {appointment.linked_product_ids.length > 0
                ? ` · ${appointment.linked_product_ids.length} verknüpfte Artikel`
                : ''}
            </span>
          </div>

          {/* Status transitions */}
          {transitions.length > 0 ? (
            <div style={{ display: 'grid', gap: 8 }}>
              <h4 style={{ margin: 0, fontSize: '0.82rem', color: 'var(--w14-ink-faded)' }}>
                Status ändern
              </h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {transitions.map((t) => (
                  <Button
                    key={t}
                    size="sm"
                    variant={
                      t === 'CANCELLED' || t === 'NO_SHOW'
                        ? 'destructive'
                        : t === 'COMPLETED'
                          ? 'primary'
                          : 'ghost'
                    }
                    disabled={setStatus.isPending}
                    onClick={() => transition(t)}
                  >
                    {TRANSITION_ACTION_LABELS[t]}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--w14-ink-faded)' }}>
              Endzustand erreicht. Keine Statuswechsel mehr möglich.
            </p>
          )}

          {canReschedule(appointment.status) ? (
            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--w14-ink-faded)' }}>
              Tipp: Ziehen Sie den Termin im Kalender auf eine neue Uhrzeit, um ihn zu verschieben.
            </p>
          ) : null}

          {/* Customer link */}
          {appointment.customer_id ? (
            <div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(`/kunden?id=${appointment.customer_id}`)}
              >
                Kundenakte öffnen
              </Button>
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--w14-ink-faded)' }}>
              Kein Kundenkonto verknüpft.
            </p>
          )}

          {/* Customer note (read-only) */}
          {appointment.customer_notes ? (
            <div style={{ display: 'grid', gap: 4 }}>
              <h4 style={{ margin: 0, fontSize: '0.82rem', color: 'var(--w14-ink-faded)' }}>
                Kundennotiz
              </h4>
              <p
                style={{
                  margin: 0,
                  fontSize: '0.86rem',
                  color: 'var(--w14-ink-aged)',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {appointment.customer_notes}
              </p>
            </div>
          ) : null}

          {/* Staff note editor */}
          <Field label="Interne Notiz" hint="Nur für das Team sichtbar.">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Notiz zum Termin …"
            />
          </Field>
          <div>
            <Button
              variant="primary"
              size="sm"
              disabled={!notesDirty || saveNotes.isPending}
              onClick={() =>
                saveNotes.mutate(
                  { id: appointment.id, staffNotes: notes },
                  {
                    onSuccess: () => addToast({ tone: 'success', title: 'Notiz gespeichert' }),
                    onError: () =>
                      addToast({
                        tone: 'alert',
                        title: 'Notiz konnte nicht gespeichert werden',
                        body: 'Bitte erneut versuchen.',
                      }),
                  },
                )
              }
            >
              {saveNotes.isPending ? 'Speichert …' : 'Notiz speichern'}
            </Button>
          </div>

          <p
            className="w14-tabular"
            style={{
              margin: 0,
              fontFamily: 'var(--w14-font-mono)',
              fontSize: '0.7rem',
              color: 'var(--w14-ink-faded)',
            }}
          >
            {berlinDayKey(appointment.starts_at)} · {appointment.id}
          </p>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Schließen
        </Button>
      </DialogFooter>
    </>
  );
}
