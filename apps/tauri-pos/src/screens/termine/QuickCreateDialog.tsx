/**
 * QuickCreateDialog — fast booking from an empty calendar slot. The clicked
 * slot pre-fills the start; the current operator is the default staff. A 409
 * (slot taken / outside working hours) surfaces as a German hint.
 */

import { useState } from 'react';

import { ApiError, type AppointmentType } from '@warehouse14/api-client';
import { APPOINTMENT_TYPE_LABELS } from '@warehouse14/api-client';
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  Field,
  Input,
  Select,
  Textarea,
} from '@warehouse14/ui-kit';

import { useBookAppointment } from '../../hooks/useAppointments.js';
import { useSessionStore } from '../../state/session-store.js';
import { useToastStore } from '../../state/toast-store.js';

const APPOINTMENT_TYPES: AppointmentType[] = ['VIEWING', 'BUYBACK_EVAL', 'CONSULTATION', 'PICKUP'];

/** Mirror of packages/appointments DEFAULT_DURATION_MINUTES (kept in sync by review). */
const DEFAULT_DURATION: Record<AppointmentType, number> = {
  VIEWING: 30,
  BUYBACK_EVAL: 45,
  CONSULTATION: 30,
  PICKUP: 15,
};

const DURATION_CHOICES = [15, 30, 45, 60, 90, 120] as const;

/** ISO instant → value for `<input type="datetime-local">` (local wall clock). */
export function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

interface QuickCreateDialogProps {
  /** The clicked empty slot (local Date) — null closes the dialog. */
  slotStart: Date | null;
  onClose: () => void;
}

export function QuickCreateDialog({
  slotStart,
  onClose,
}: QuickCreateDialogProps): JSX.Element | null {
  if (!slotStart) return null;
  return (
    <Dialog open onClose={onClose} title="Neuer Termin" size="sm">
      <CreateForm key={slotStart.toISOString()} slotStart={slotStart} onClose={onClose} />
    </Dialog>
  );
}

function CreateForm({ slotStart, onClose }: { slotStart: Date; onClose: () => void }): JSX.Element {
  const actor = useSessionStore((s) => s.actor);
  const addToast = useToastStore((s) => s.addToast);
  const book = useBookAppointment();

  const [type, setType] = useState<AppointmentType>('VIEWING');
  const [startsAtLocal, setStartsAtLocal] = useState(toDatetimeLocal(slotStart));
  const [duration, setDuration] = useState<number>(DEFAULT_DURATION.VIEWING);
  const [staffUserId, setStaffUserId] = useState(actor?.id ?? '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const changeType = (t: AppointmentType): void => {
    setType(t);
    setDuration(DEFAULT_DURATION[t]);
  };

  const canSubmit = startsAtLocal.length > 0 && staffUserId.trim().length > 0 && !book.isPending;

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    book.mutate(
      {
        type,
        startsAt: new Date(startsAtLocal).toISOString(),
        staffUserId: staffUserId.trim(),
        bookedVia: 'pos',
        durationMinutes: duration,
        ...(note.trim() ? { customerNotes: note.trim() } : {}),
      },
      {
        onSuccess: () => {
          addToast({ tone: 'success', title: 'Termin gebucht' });
          onClose();
        },
        onError: (err: unknown) => {
          if (err instanceof ApiError && err.httpStatus === 409) {
            setError(
              'Dieser Slot ist nicht verfügbar — belegt oder außerhalb der Arbeitszeiten. Bitte anderen Zeitpunkt wählen.',
            );
          } else if (err instanceof ApiError) {
            setError(err.message);
          } else {
            setError('Buchung fehlgeschlagen. Bitte erneut versuchen.');
          }
        },
      },
    );
  };

  return (
    <form onSubmit={submit}>
      <DialogBody>
        <div style={{ display: 'grid', gap: 12 }}>
          <Field label="Terminart" required>
            <Select value={type} onChange={(e) => changeType(e.target.value as AppointmentType)}>
              {APPOINTMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {APPOINTMENT_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Beginn" required>
            <Input
              type="datetime-local"
              value={startsAtLocal}
              onChange={(e) => setStartsAtLocal(e.target.value)}
            />
          </Field>

          <Field label="Dauer">
            <Select value={String(duration)} onChange={(e) => setDuration(Number(e.target.value))}>
              {DURATION_CHOICES.map((m) => (
                <option key={m} value={m}>
                  {m} Minuten
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Mitarbeiter-ID"
            hint="Vorbelegt mit Ihnen — nur ändern, wenn der Termin jemand anderem gehört."
            required
          >
            <Input mono value={staffUserId} onChange={(e) => setStaffUserId(e.target.value)} />
          </Field>

          <Field label="Notiz">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Anlass, Kundenwunsch, Artikel …"
            />
          </Field>

          {error ? (
            <p role="alert" style={{ margin: 0, fontSize: '0.84rem', color: 'var(--w14-wax-red)' }}>
              {error}
            </p>
          ) : null}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" type="button" onClick={onClose}>
          Abbrechen
        </Button>
        <Button variant="primary" type="submit" disabled={!canSubmit}>
          {book.isPending ? 'Bucht …' : 'Termin buchen'}
        </Button>
      </DialogFooter>
    </form>
  );
}
