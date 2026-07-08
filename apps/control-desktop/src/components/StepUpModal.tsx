/**
 * StepUpModal — the Owner Desktop's global PIN re-confirmation modal.
 *
 * Wired to `step-up-store`. When the ApiClient's step-up middleware catches
 * `STEP_UP_REQUIRED`, the store flips `active = true` and this renders. The
 * owner types the PIN → we POST `/api/auth/step-up` → on success the store
 * resolves the pending promise and the middleware replays the original request
 * transparently.
 *
 * Reuses `<PinPad/>` so the keypad UX matches the POS exactly. Esc / backdrop
 * cancels — the original call then receives back its `STEP_UP_REQUIRED` error
 * for inline handling.
 */

import { useEffect, useMemo, useState } from 'react';

import { ApiError, authPin } from '@warehouse14/api-client';
import { DiamondRule, ParchmentCard, PinPad, RomanIndex, Seal } from '@warehouse14/ui-kit';

import { useApiClient } from '../api-context.js';
import { useStepUpStore } from '../state/step-up-store.js';
import { describeError } from '@warehouse14/i18n-de';

/**
 * Name the guarded action in German from the request path, so the owner sees
 * WHICH action the PIN confirms. Unknown paths fall back to the generic line.
 */
function describeStepUpAction(path: string | undefined): string | null {
  if (!path) return null;
  if (path.includes('/erase')) return 'Kundendaten löschen (Art. 17)';
  if (path.includes('/kyc-documents')) return 'Ausweisdokument löschen';
  if (path.endsWith('/kyc')) return 'KYC-Prüfung stempeln';
  if (path.includes('/trust')) return 'Vertrauensstufe ändern';
  if (path.includes('/closings/finalize')) return 'Tagesabschluss erstellen';
  if (path.includes('/export/datev')) return 'DATEV-Export';
  if (path.includes('/export/dsfinvk')) return 'DSFinV-K-Export';
  if (path.includes('/registers/an-verkaufsbuch')) return 'An-/Verkaufsbuch-Export';
  if (path.includes('/settings/')) return 'Einstellung ändern';
  return null;
}

export function StepUpModal(): JSX.Element | null {
  const active = useStepUpStore((s) => s.active);
  const complete = useStepUpStore((s) => s.complete);
  const cancel = useStepUpStore((s) => s.cancel);
  const reason = useStepUpStore((s) => s.reason);

  const { client } = useApiClient();

  const [pin, setPin] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [failedAttempts, setFailedAttempts] = useState<number>(0);
  const [lockedUntilIso, setLockedUntilIso] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  // Reset on open.
  useEffect(() => {
    if (active) {
      setPin('');
      setErrorMsg(null);
      setFailedAttempts(0);
      setLockedUntilIso(null);
    }
  }, [active]);

  // Lockout countdown tick.
  useEffect(() => {
    if (!lockedUntilIso) return;
    const t = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(t);
  }, [lockedUntilIso]);

  const lockoutSecondsLeft = useMemo(() => {
    if (!lockedUntilIso) return 0;
    return Math.max(0, Math.ceil((new Date(lockedUntilIso).getTime() - now) / 1_000));
  }, [lockedUntilIso, now]);
  const locked = lockoutSecondsLeft > 0;

  useEffect(() => {
    if (lockedUntilIso && lockoutSecondsLeft === 0) {
      setLockedUntilIso(null);
      setErrorMsg(null);
    }
  }, [lockedUntilIso, lockoutSecondsLeft]);

  // Esc anywhere cancels.
  useEffect(() => {
    if (!active) return;
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        cancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, cancel]);

  async function handleSubmit(): Promise<void> {
    if (locked || submitting || pin.length !== 4) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await authPin.stepUp(client, { pin });
      complete();
    } catch (err) {
      if (err instanceof ApiError) {
        switch (err.code) {
          case 'UNAUTHORIZED':
            setFailedAttempts((n) => n + 1);
            setErrorMsg('Falsche PIN.');
            break;
          case 'PIN_LOCKED': {
            const details = err.details as { lockedUntil?: string } | undefined;
            if (details?.lockedUntil) setLockedUntilIso(details.lockedUntil);
            setErrorMsg('Konto gesperrt. Bitte Geduld.');
            break;
          }
          default:
            setErrorMsg(describeError(err));
        }
      } else {
        setErrorMsg('Verbindung gestört. Netzwerk prüfen.');
      }
      setPin('');
    } finally {
      setSubmitting(false);
    }
  }

  const lockoutLabel = useMemo(() => {
    if (!locked) return null;
    const m = Math.floor(lockoutSecondsLeft / 60);
    const s = lockoutSecondsLeft % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }, [locked, lockoutSecondsLeft]);

  if (!active) return null;

  return (
    // biome-ignore lint/a11y/useSemanticElements: backdrop-overlay modal; a native <dialog> needs imperative showModal()/focus-trap wiring beyond this scope.
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click dismisses; Esc is handled by a global keydown listener.
    <div
      role="dialog"
      aria-modal="true"
      aria-label="PIN-Bestätigung"
      onClick={cancel}
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
        onClick={(ev) => ev.stopPropagation()}
        style={{
          width: 'min(420px, 100%)',
          textAlign: 'center',
          boxShadow: 'var(--w14-shadow-modal)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Seal size="md" tone="gold" label="🔒" />
        </div>
        <h2
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1.4rem',
            margin: '14px 0 2px',
          }}
        >
          PIN bestätigen
        </h2>
        <p
          style={{
            margin: 0,
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: '0.92rem',
          }}
        >
          Dieser Schritt erfordert eine frische Bestätigung.
        </p>
        {describeStepUpAction(reason?.path) && (
          <p
            style={{
              margin: '6px 0 0',
              color: 'var(--w14-ink)',
              fontFamily: 'var(--w14-font-display)',
              fontSize: '0.92rem',
            }}
          >
            Aktion: {describeStepUpAction(reason?.path)}
          </p>
        )}
        <DiamondRule />

        <PinPad
          value={pin}
          onChange={setPin}
          onSubmit={() => void handleSubmit()}
          disabled={locked || submitting}
          bindKeyboard
        />

        {errorMsg && (
          <p
            role="alert"
            style={{ color: 'var(--w14-wax-red)', margin: '14px 0 0', fontSize: '0.92rem' }}
          >
            {errorMsg}
          </p>
        )}

        {failedAttempts > 0 && !locked && (
          <p style={{ margin: '12px 0 0', color: 'var(--w14-wax-red-soft)' }}>
            <RomanIndex value={failedAttempts} variant="lower" tone="wax-red" />
            &nbsp;
            <span style={{ fontFamily: 'var(--w14-font-display)', fontStyle: 'italic' }}>
              Fehlversuch{failedAttempts === 1 ? '' : 'e'}
            </span>
          </p>
        )}

        {locked && lockoutLabel && (
          <p
            style={{
              color: 'var(--w14-wax-red)',
              margin: '12px 0 0',
              fontFamily: 'var(--w14-font-mono)',
              fontSize: '1.1rem',
            }}
          >
            ⌛ {lockoutLabel}
          </p>
        )}

        <button
          type="button"
          onClick={cancel}
          style={{
            marginTop: 16,
            background: 'transparent',
            border: 'none',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: '0.85rem',
            cursor: 'pointer',
          }}
        >
          Abbrechen
        </button>
      </ParchmentCard>
    </div>
  );
}
