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

import {
  ApiError,
  shifts as shiftsApi,
  type CashMovementDirection,
} from '@warehouse14/api-client';
import {
  Button,
  DiamondRule,
  ParchmentCard,
} from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { useCurrentShift } from '../../hooks/useCurrentShift.js';
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

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

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

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={KIND_TITLE[kind]}
      onClick={onClose}
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
          width: 'min(460px, 100%)',
          boxShadow: 'var(--w14-shadow-modal)',
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1.5rem',
            textAlign: 'center',
          }}
        >
          {KIND_TITLE[kind]}
        </h2>
        <p
          style={{
            margin: '4px 0 0',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: '0.88rem',
            textAlign: 'center',
          }}
        >
          {KIND_HINT[kind]}
        </p>
        <DiamondRule />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <EuroInput
            label="Betrag"
            valueEur={amountEur}
            onValueChange={setAmountEur}
            autoFocus
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label
              htmlFor="cm-reason"
              className="w14-smallcaps"
              style={{ color: 'var(--w14-ink-faded)', fontSize: '0.78rem' }}
            >
              Grund (mindestens 3 Zeichen)
            </label>
            <input
              id="cm-reason"
              type="text"
              value={reason}
              onChange={(ev) => setReason(ev.target.value)}
              disabled={submitting}
              maxLength={1024}
              placeholder={kind === 'einlage' ? 'z. B. Tresor-Übernahme' : 'z. B. Bürobedarf — Tinte'}
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
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Abbrechen
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!canSubmit}>
            {submitting ? 'Buche…' : 'Buchen'}
          </Button>
        </div>
      </ParchmentCard>
    </div>
  );
}
