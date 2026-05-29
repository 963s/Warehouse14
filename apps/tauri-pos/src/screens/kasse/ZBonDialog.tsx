/**
 * ZBonDialog — Blindsturz close-out (memory.md #67).
 *
 * The cashier counts the physical drawer FIRST and types the result; the
 * route then reveals the system-computed expected balance + the variance.
 * The Owner audit chain requires the operator's number land BEFORE seeing
 * what the system thinks — otherwise the "blind" guarantee is broken.
 *
 * Step-up: the `/api/shifts/:id/close` route returns 403 STEP_UP_REQUIRED
 * when the session is not fresh. Our wrapWithStepUp interceptor (memory.md
 * #76 ⑦) catches it transparently — this dialog never needs to ask for PIN
 * explicitly. The brand StepUpModal pops, the operator types PIN, and the
 * close call retries.
 *
 * Two phases:
 *   1. INPUT  — operator types blindCountEur, optional note
 *   2. RESULT — once `/close` returns, render variance + reset CTA
 */

import { useCallback, useEffect, useState } from 'react';

import { ApiError, type ShiftView, shifts as shiftsApi } from '@warehouse14/api-client';
import { Button, DiamondRule, MoneyAmount, ParchmentCard } from '@warehouse14/ui-kit';

import { useCurrentShift } from '../../hooks/useCurrentShift.js';
import { useApiClient } from '../../lib/api-context.js';
import { useToastStore } from '../../state/toast-store.js';

import { EuroInput } from './EuroInput.js';

export interface ZBonDialogProps {
  open: boolean;
  shiftId: string;
  onClose: () => void;
}

export function ZBonDialog({ open, shiftId, onClose }: ZBonDialogProps): JSX.Element | null {
  const api = useApiClient();
  const { invalidateShiftScope } = useCurrentShift();
  const addToast = useToastStore((s) => s.addToast);

  const [blindCountEur, setBlindCountEur] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState<ShiftView | null>(null);

  // Reset on open.
  useEffect(() => {
    if (open) {
      setBlindCountEur('');
      setNotes('');
      setError(null);
      setClosed(null);
    }
  }, [open]);

  // Esc closes (only when we're not mid-submit).
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape' && !submitting) {
        ev.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, submitting]);

  const validAmount = /^\d{1,16}(\.\d{1,2})?$/.test(blindCountEur);
  const canSubmit = validAmount && !submitting && closed === null;

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const body =
        notes.trim().length > 0 ? { blindCountEur, notes: notes.trim() } : { blindCountEur };
      // The api client is wrapped with wrapWithStepUp — if step-up is
      // required the brand StepUpModal opens, the operator enters PIN,
      // and this call resolves once /api/auth/step-up succeeds.
      const result = await shiftsApi.close(api, shiftId, body);
      setClosed(result);
      const varianceCents = parseCents(result.varianceEur);
      addToast({
        tone: varianceCents === 0n ? 'success' : 'alert',
        title: 'Z-Bon ausgegeben',
        body:
          varianceCents === 0n
            ? 'Schicht ohne Differenz geschlossen.'
            : `Varianz: ${result.varianceEur} €`,
      });
      await invalidateShiftScope();
    } catch (err) {
      if (err instanceof ApiError) {
        // STEP_UP_REQUIRED is handled by the interceptor (it never reaches
        // here unless the operator cancelled the modal). All other API
        // errors land as inline messages.
        if (err.code === 'STEP_UP_REQUIRED') {
          setError('PIN-Bestätigung wurde abgebrochen.');
        } else {
          setError(err.message);
        }
      } else {
        setError('Verbindung gestört — Netzwerk prüfen.');
      }
    } finally {
      setSubmitting(false);
    }
  }, [addToast, api, blindCountEur, canSubmit, invalidateShiftScope, notes, onClose, shiftId]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Z-Bon"
      onClick={() => {
        if (!submitting) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--w14-overlay)',
        zIndex: 1050,
        display: 'grid',
        placeItems: 'center',
        padding: 24,
      }}
    >
      <ParchmentCard
        padding="lg"
        onClick={(ev) => ev.stopPropagation()}
        style={{
          width: 'min(520px, 100%)',
          boxShadow: 'var(--w14-shadow-modal)',
        }}
      >
        {closed === null ? (
          <BlindsturzInput
            blindCountEur={blindCountEur}
            setBlindCountEur={setBlindCountEur}
            notes={notes}
            setNotes={setNotes}
            error={error}
            submitting={submitting}
            canSubmit={canSubmit}
            onSubmit={() => void submit()}
            onCancel={onClose}
          />
        ) : (
          <ZBonResult shift={closed} onDismiss={onClose} />
        )}
      </ParchmentCard>
    </div>
  );
}

function BlindsturzInput({
  blindCountEur,
  setBlindCountEur,
  notes,
  setNotes,
  error,
  submitting,
  canSubmit,
  onSubmit,
  onCancel,
}: {
  blindCountEur: string;
  setBlindCountEur: (v: string) => void;
  notes: string;
  setNotes: (v: string) => void;
  error: string | null;
  submitting: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <>
      <h2
        style={{
          margin: 0,
          fontFamily: 'var(--w14-font-display)',
          fontWeight: 500,
          fontSize: '1.5rem',
          textAlign: 'center',
        }}
      >
        Tagesabschluss · Blindsturz
      </h2>
      <p
        style={{
          margin: '6px 0 0',
          color: 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontStyle: 'italic',
          fontSize: '0.92rem',
          textAlign: 'center',
        }}
      >
        Zählen Sie die Schublade jetzt körperlich. Geben Sie das Ergebnis ein, bevor das System den
        erwarteten Betrag enthüllt.
      </p>
      <DiamondRule label="Gezählter Betrag" />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <EuroInput
          label="Bargeld in der Schublade (gezählt)"
          valueEur={blindCountEur}
          onValueChange={setBlindCountEur}
          autoFocus
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label
            htmlFor="zbon-notes"
            className="w14-smallcaps"
            style={{ color: 'var(--w14-ink-faded)', fontSize: '0.78rem' }}
          >
            Notiz (optional)
          </label>
          <input
            id="zbon-notes"
            type="text"
            value={notes}
            onChange={(ev) => setNotes(ev.target.value)}
            disabled={submitting}
            maxLength={1024}
            style={{
              width: '100%',
              border: 'none',
              outline: 'none',
              borderBottom: '2px solid var(--w14-rule)',
              background: 'transparent',
              color: 'var(--w14-ink)',
              fontFamily: 'var(--w14-font-body)',
              fontSize: '0.95rem',
              padding: '8px 4px',
            }}
          />
        </div>
      </div>

      {error && (
        <p
          role="alert"
          style={{
            color: 'var(--w14-wax-red)',
            margin: '14px 0 0',
            fontSize: '0.92rem',
            textAlign: 'center',
          }}
        >
          {error}
        </p>
      )}

      <div
        style={{
          marginTop: 24,
          display: 'flex',
          gap: 12,
          justifyContent: 'flex-end',
        }}
      >
        <Button variant="ghost" onClick={onCancel} disabled={submitting}>
          Abbrechen
        </Button>
        <Button variant="destructive" onClick={onSubmit} disabled={!canSubmit}>
          {submitting ? 'Schließe…' : 'Schließen und Z-Bon ausgeben'}
        </Button>
      </div>
    </>
  );
}

function ZBonResult({
  shift,
  onDismiss,
}: {
  shift: ShiftView;
  onDismiss: () => void;
}): JSX.Element {
  const varianceCents = parseCents(shift.varianceEur);
  const hasVariance = varianceCents !== 0n;

  return (
    <>
      <h2
        style={{
          margin: 0,
          fontFamily: 'var(--w14-font-display)',
          fontWeight: 500,
          fontSize: '1.5rem',
          textAlign: 'center',
        }}
      >
        Z-Bon · Schicht geschlossen
      </h2>
      <DiamondRule />

      <table
        className="w14-tabular"
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontFamily: 'var(--w14-font-mono)',
        }}
      >
        <tbody>
          <Row label="Gezählt" value={<MoneyAmount valueEur={shift.blindCountEur ?? '0'} />} />
          <Row label="Erwartet" value={<MoneyAmount valueEur={shift.systemExpectedEur ?? '0'} />} />
          <Row label="Wechselgeld" value={<MoneyAmount valueEur={shift.openingFloatEur} />} />
          <Row
            label="Varianz"
            valueColor={hasVariance ? 'var(--w14-wax-red)' : 'var(--w14-ink-aged)'}
            value={<MoneyAmount valueEur={shift.varianceEur ?? '0'} signed emphasis />}
          />
        </tbody>
      </table>

      <p
        style={{
          margin: '14px 0 0',
          color: 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontStyle: 'italic',
          fontSize: '0.85rem',
          textAlign: 'center',
        }}
      >
        Geschlossen {shift.closedAt ? new Date(shift.closedAt).toLocaleString('de-DE') : ''}
        {' · ID '}
        {shift.id.slice(0, 8)}…
      </p>

      <div style={{ marginTop: 20, display: 'flex', justifyContent: 'center' }}>
        <Button variant="primary" onClick={onDismiss}>
          Schließen
        </Button>
      </div>
    </>
  );
}

function Row({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: JSX.Element;
  valueColor?: string;
}): JSX.Element {
  return (
    <tr>
      <td
        style={{
          padding: '8px 0',
          color: 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontVariant: 'all-small-caps',
          letterSpacing: '0.08em',
          fontSize: '0.85rem',
        }}
      >
        {label}
      </td>
      <td
        style={{
          padding: '8px 0',
          textAlign: 'right',
          color: valueColor ?? 'var(--w14-ink-aged)',
        }}
      >
        {value}
      </td>
    </tr>
  );
}

/** Parse a decimal-string EUR amount into bigint cents (no float drift). */
function parseCents(raw: string | null | undefined): bigint {
  if (!raw) return 0n;
  const trimmed = raw.trim();
  const sign = trimmed.startsWith('-') ? -1n : 1n;
  const abs = sign === -1n ? trimmed.slice(1) : trimmed;
  const [whole = '0', frac = ''] = abs.split('.');
  const fracPadded = frac.padEnd(2, '0').slice(0, 2);
  return sign * (BigInt(whole) * 100n + BigInt(fracPadded || '0'));
}
