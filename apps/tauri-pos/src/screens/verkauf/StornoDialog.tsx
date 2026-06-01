/**
 * StornoDialog — reverse a just-finalized sale (Sofort-Storno).
 *
 * Self-contained: POSTs /api/transactions/storno with the original transaction
 * id + a reason (≥ 8 chars). Storno is fiscally mandatory PIN step-up (the
 * api-client middleware opens the PIN modal). It creates a mirror transaction
 * with negated amounts so the Z-Bon balances; it does NOT auto-return the item
 * to stock (V1) — surfaced as a note so the operator re-lists it from Lager.
 */

import { useEffect, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { type ApiClient, ApiError } from '@warehouse14/api-client';
import { Button, DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';

import { currentShiftQueryKey } from '../../hooks/useCurrentShift.js';
import { dashboardQueryKey } from '../../hooks/useDashboardSummary.js';
import { useApiClient } from '../../lib/api-context.js';
import { useToastStore } from '../../state/toast-store.js';

export function StornoDialog({
  transactionId,
  receiptLocator,
  onClose,
  onStornoed,
}: {
  transactionId: string;
  receiptLocator: string;
  onClose: () => void;
  onStornoed: () => void;
}): JSX.Element {
  const api = useApiClient() as ApiClient;
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const valid = reason.trim().length >= 8;

  async function submit(): Promise<void> {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.request('POST', '/api/transactions/storno', {
        originalTransactionId: transactionId,
        reason: reason.trim(),
      });
      addToast({
        tone: 'alert',
        title: 'Storniert',
        body: `Beleg ${receiptLocator} wurde storniert.`,
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: dashboardQueryKey }),
        qc.invalidateQueries({ queryKey: ['products', 'list'] }),
        qc.invalidateQueries({ queryKey: currentShiftQueryKey }),
      ]);
      onStornoed();
    } catch (err) {
      if (err instanceof ApiError) {
        switch (err.code) {
          case 'STEP_UP_REQUIRED':
            setError('PIN-Bestätigung wurde abgebrochen.');
            break;
          case 'CONFLICT':
            setError('Dieser Beleg wurde bereits storniert.');
            break;
          case 'DEVICE_NOT_AUTHORIZED':
            setError('Storno erfordert ein gekoppeltes Gerät (mTLS).');
            break;
          default:
            setError(err.message);
        }
      } else {
        setError('Verbindung gestört — bitte erneut versuchen.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: backdrop-overlay modal; a native <dialog> needs imperative showModal()/focus-trap wiring beyond this scope.
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click dismisses; Esc handled by the window listener.
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Beleg stornieren"
      onClick={() => {
        if (!busy) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--w14-overlay)',
        zIndex: 1100,
        display: 'grid',
        placeItems: 'center',
        padding: 24,
      }}
    >
      <ParchmentCard
        padding="lg"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(460px, 100%)', boxShadow: 'var(--w14-shadow-modal)' }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1.4rem',
            textAlign: 'center',
            color: 'var(--w14-wax-red)',
          }}
        >
          Beleg stornieren
        </h2>
        <p
          style={{
            margin: '4px 0 0',
            textAlign: 'center',
            color: 'var(--w14-ink-faded)',
            fontSize: '0.85rem',
          }}
        >
          Beleg-Nr. {receiptLocator}
        </p>
        <DiamondRule />

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span
            className="w14-smallcaps"
            style={{ color: 'var(--w14-ink-faded)', fontSize: '0.72rem', letterSpacing: '0.08em' }}
          >
            Grund (mind. 8 Zeichen) *
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="z. B. Falsch erfasst — doppelt gebucht"
            style={{
              border: 'none',
              outline: 'none',
              borderBottom: '2px solid var(--w14-rule)',
              background: 'transparent',
              padding: '6px 4px',
              resize: 'vertical',
              fontFamily: 'var(--w14-font-body)',
              fontSize: '0.92rem',
              color: 'var(--w14-ink)',
            }}
          />
        </label>

        <p
          style={{
            margin: '12px 0 0',
            color: 'var(--w14-ink-faded)',
            fontSize: '0.78rem',
            fontStyle: 'italic',
          }}
        >
          Erstellt einen Gegenbeleg mit negierten Beträgen (Z-Bon gleicht aus). Der Artikel wird
          NICHT automatisch zurück in den Bestand gebucht — bei Bedarf im Lager neu freigeben.
        </p>

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

        <div style={{ marginTop: 20, display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button variant="destructive" onClick={() => void submit()} disabled={!valid || busy}>
            {busy ? 'Storniert…' : 'Storno bestätigen'}
          </Button>
        </div>
      </ParchmentCard>
    </div>
  );
}
