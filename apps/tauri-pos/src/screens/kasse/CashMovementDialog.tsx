/**
 * CashMovementDialog — brand-themed modal for Einlage / Entnahme.
 *
 * Direction mapping (memory.md backend audit):
 *   • "Einlage"  → INJECTION   (cash deposited into drawer)
 *   • "Entnahme" → SAFE_TRANSIT (cash removed for safe / petty expenses)
 *
 * The backend's `cash_movements.reason` has minLength=3 — we mirror that
 * client-side and surface a brand error when violated.
 */

import { useCallback, useEffect, useState } from 'react';

import { ApiError, type CashMovementDirection, shifts as shiftsApi } from '@warehouse14/api-client';
import { Button, Dialog, DialogBody, DialogFooter, Field, Input } from '@warehouse14/ui-kit';

import { useCurrentShift } from '../../hooks/useCurrentShift.js';
import { useApiClient } from '../../lib/api-context.js';
import { useToastStore } from '../../state/toast-store.js';

import { EuroInput } from './EuroInput.js';

export type MovementKind = 'einlage' | 'entnahme';

export interface CashMovementDialogProps {
  open: boolean;
  kind: MovementKind;
  shiftId: string;
  onClose: () => void;
}

const KIND_TITLE: Record<MovementKind, string> = {
  einlage: 'Einlage',
  entnahme: 'Entnahme',
};

const KIND_DIRECTION: Record<MovementKind, CashMovementDirection> = {
  einlage: 'INJECTION',
  entnahme: 'SAFE_TRANSIT',
};

const KIND_HINT: Record<MovementKind, string> = {
  einlage: 'Bargeld, das in die Schublade eingelegt wird (z. B. Tresor-Übernahme).',
  entnahme: 'Bargeld, das die Schublade verlässt (Geschäftsausgaben, Safe-Transit).',
};

export function CashMovementDialog({
  open,
  kind,
  shiftId,
  onClose,
}: CashMovementDialogProps): JSX.Element | null {
  const api = useApiClient();
  const { invalidateShiftScope } = useCurrentShift();
  const addToast = useToastStore((s) => s.addToast);

  const [amountEur, setAmountEur] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on open.
  useEffect(() => {
    if (open) {
      setAmountEur('');
      setReason('');
      setError(null);
    }
  }, [open]);

  // Esc + backdrop close are now handled by the shared <Dialog/> core.

  const validAmount = /^\d{1,16}(\.\d{1,2})?$/.test(amountEur) && Number(amountEur) > 0;
  const validReason = reason.trim().length >= 3;
  const canSubmit = validAmount && validReason && !submitting;

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await shiftsApi.recordCashMovement(api, shiftId, {
        direction: KIND_DIRECTION[kind],
        amountEur,
        reason: reason.trim(),
      });
      addToast({
        tone: kind === 'einlage' ? 'success' : 'info',
        title: `${KIND_TITLE[kind]} verzeichnet`,
        body: `${reason.trim()} · ${amountEur} €`,
      });
      await invalidateShiftScope();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Verbindung gestört — Netzwerk prüfen.');
      }
    } finally {
      setSubmitting(false);
    }
  }, [addToast, amountEur, api, canSubmit, invalidateShiftScope, kind, onClose, reason, shiftId]);

  return (
    <Dialog open={open} onClose={onClose} title={KIND_TITLE[kind]} size="md">
      <DialogBody>
        <p
          style={{
            margin: '0 0 16px',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: '0.88rem',
          }}
        >
          {KIND_HINT[kind]}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <EuroInput label="Betrag" valueEur={amountEur} onValueChange={setAmountEur} autoFocus />
          <Field label="Grund (mindestens 3 Zeichen)">
            <Input
              value={reason}
              onChange={(ev) => setReason(ev.target.value)}
              disabled={submitting}
              maxLength={1024}
              placeholder={
                kind === 'einlage' ? 'z. B. Tresor-Übernahme' : 'z. B. Bürobedarf — Tinte'
              }
            />
          </Field>
        </div>

        {error && (
          <p
            role="alert"
            style={{
              color: 'var(--w14-wax-red)',
              margin: '16px 0 0',
              fontSize: '0.92rem',
            }}
          >
            {error}
          </p>
        )}
      </DialogBody>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={submitting}>
          Abbrechen
        </Button>
        <Button variant="primary" onClick={() => void submit()} disabled={!canSubmit}>
          {submitting ? 'Buche…' : 'Buchen'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
