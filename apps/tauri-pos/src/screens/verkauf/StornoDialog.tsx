/**
 * StornoDialog — reverse a just-finalized sale (Sofort-Storno).
 *
 * Self-contained: POSTs /api/transactions/storno with the original transaction
 * id + a reason (≥ 8 chars). Storno is fiscally mandatory PIN step-up (the
 * api-client middleware opens the PIN modal). It creates a mirror transaction
 * with negated amounts so the Z-Bon balances; it does NOT auto-return the item
 * to stock (V1) — surfaced as a note so the operator re-lists it from Lager.
 *
 * UX (design-ux-brief §1 "Dangerous-proximity / reverse-Fitts"): Storno is
 * fiscally irreversible, so a modal confirm is the CORRECT pattern here — the
 * goal is to make the danger *unmistakable* and the destructive button *hard to
 * hit by accident*, not to remove the friction:
 *   • Redundant danger coding — red warning glyph + a red danger strip + the
 *     wax-red header (color + icon + distinct alignment), so meaning survives
 *     colour-blindness / shop glare (WCAG 1.4.1).
 *   • Reverse-Fitts — the destructive "Storno bestätigen" button is exiled to
 *     the LEFT, OUT of the bottom-right thumb cluster where the eye/finger rests
 *     after a sale; the safe "Abbrechen" escape sits in the easy primary slot.
 *   • An explicit acknowledgement checkbox gates the destructive button (a
 *     second deliberate act in front of the existing PIN step-up).
 * None of the fiscal storno logic, the request payload, error mapping, or query
 * invalidations are changed.
 */

import { useEffect, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { type ApiClient, ApiError } from '@warehouse14/api-client';
import { Button, DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';

import { currentShiftQueryKey } from '../../hooks/useCurrentShift.js';
import { dashboardQueryKey } from '../../hooks/useDashboardSummary.js';
import { useApiClient } from '../../lib/api-context.js';
import { useToastStore } from '../../state/toast-store.js';
import { describeError } from '@warehouse14/i18n-de';

/** Single canonical Storno glyph (outlined-2px, 24-grid) — a reversal arrow over
 *  a document, reused identically wherever Storno is surfaced. */
function StornoGlyph({ size = 22 }: { size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 14h4.5a2 2 0 0 0 0-4H10" />
      <path d="M10 12l-1.6-1.6M10 12l-1.6 1.6" />
    </svg>
  );
}

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
  const [acknowledged, setAcknowledged] = useState(false);
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
  const canSubmit = valid && acknowledged;

  async function submit(): Promise<void> {
    if (!canSubmit || busy) return;
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
            setError(describeError(err));
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
        padding: 'var(--space-6)',
      }}
    >
      <ParchmentCard
        padding="lg"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(460px, 100%)',
          boxShadow: 'var(--w14-shadow-modal)',
          /* Redundant danger coding #1 — a wax-red edge marks the whole surface
             as a destructive context the moment it appears. */
          borderTop: '3px solid var(--w14-wax-red)',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'var(--space-2)',
          }}
        >
          {/* Redundant danger coding #2 — a wax-red warning glyph, never used
              decoratively elsewhere. */}
          <span
            aria-hidden="true"
            style={{
              display: 'grid',
              placeItems: 'center',
              width: 44,
              height: 44,
              borderRadius: '50%',
              color: 'var(--w14-wax-red)',
              backgroundColor: 'color-mix(in srgb, var(--w14-wax-red) 12%, transparent)',
            }}
          >
            <StornoGlyph size={24} />
          </span>
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
            className="w14-tabular"
            style={{
              margin: 0,
              textAlign: 'center',
              color: 'var(--w14-ink-faded)',
              fontSize: '0.85rem',
            }}
          >
            Beleg-Nr. {receiptLocator}
          </p>
        </div>
        <DiamondRule />

        {/* Redundant danger coding #3 — a plain-German danger strip stating the
            irreversibility, icon + colour + text together. */}
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-3)',
            alignItems: 'flex-start',
            padding: 'var(--space-3) var(--space-4)',
            borderRadius: 'var(--w14-radius-button)',
            backgroundColor: 'color-mix(in srgb, var(--w14-wax-red) 9%, transparent)',
            border: '1px solid color-mix(in srgb, var(--w14-wax-red) 35%, transparent)',
          }}
        >
          <span style={{ color: 'var(--w14-wax-red)', flexShrink: 0, marginTop: 1 }}>
            <StornoGlyph size={20} />
          </span>
          <p
            style={{
              margin: 0,
              color: 'var(--w14-ink-aged)',
              fontSize: '0.82rem',
              lineHeight: 1.45,
            }}
          >
            Achtung — endgültiger Vorgang. Es wird ein Gegenbeleg mit negierten Beträgen erstellt
            (Z-Bon gleicht aus). Eine Stornierung lässt sich fiskalisch nicht zurücknehmen.
          </p>
        </div>

        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-1)',
            marginTop: 'var(--space-4)',
          }}
        >
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
            margin: 'var(--space-3) 0 0',
            color: 'var(--w14-ink-faded)',
            fontSize: '0.78rem',
            fontStyle: 'italic',
          }}
        >
          Der Artikel wird NICHT automatisch zurück in den Bestand gebucht — bei Bedarf im Lager neu
          freigeben.
        </p>

        {/* Deliberate acknowledgement — a second conscious act gating the
            destructive button, in front of the existing PIN step-up. */}
        <label
          style={{
            display: 'flex',
            gap: 'var(--space-3)',
            alignItems: 'flex-start',
            marginTop: 'var(--space-4)',
            cursor: busy ? 'not-allowed' : 'pointer',
            color: 'var(--w14-ink-aged)',
            fontSize: '0.85rem',
            lineHeight: 1.4,
          }}
        >
          <input
            type="checkbox"
            checked={acknowledged}
            disabled={busy}
            onChange={(e) => setAcknowledged(e.target.checked)}
            style={{
              width: 20,
              height: 20,
              flexShrink: 0,
              marginTop: 1,
              accentColor: 'var(--w14-wax-red)',
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          />
          <span>Ich bestätige, dass dieser Beleg endgültig storniert wird.</span>
        </label>

        {error && (
          <p
            role="alert"
            style={{
              color: 'var(--w14-wax-red)',
              margin: 'var(--space-4) 0 0',
              fontSize: '0.92rem',
              textAlign: 'center',
            }}
          >
            {error}
          </p>
        )}

        {/* Reverse-Fitts layout: the destructive action is exiled LEFT — out of
            the bottom-right thumb cluster where the finger rests after a sale —
            while the safe "Abbrechen" escape takes the easy primary slot.
            `space-between` keeps a wide dead gap between the two so an overshoot
            toward Storno lands on empty space, not the other button. */}
        <div
          style={{
            marginTop: 'var(--space-5)',
            display: 'flex',
            gap: 'var(--space-7)',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Button
            variant="destructive"
            size="sm"
            iconLeft={<StornoGlyph size={16} />}
            onClick={() => void submit()}
            disabled={!canSubmit || busy}
          >
            {busy ? 'Storniert…' : 'Storno bestätigen'}
          </Button>
          <Button variant="primary" size="lg" onClick={onClose} disabled={busy} autoFocus>
            Abbrechen
          </Button>
        </div>
      </ParchmentCard>
    </div>
  );
}
