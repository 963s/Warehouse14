/**
 * LocalLock — the mandatory local device gate (Track A2). Sits over an
 * already-authenticated Google session. If a code is set, it asks for it; if
 * none is set, it requires creating one now (no skip). The real login is always
 * Google — this is the fast, per-device re-entry layer that is never optional.
 */

import { useEffect, useState } from 'react';

import { DiamondRule, ParchmentCard, PinPad, Seal } from '@warehouse14/ui-kit';

import {
  clearAttempts,
  hasLocalPin,
  readAttempts,
  recordFailedAttempt,
  setLocalPin,
  verifyLocalPin,
  WIPE_AFTER,
} from '../lib/local-lock.js';

export function LocalLock({
  onUnlocked,
  onSignOut,
}: {
  onUnlocked: () => void;
  onSignOut: () => void;
}): JSX.Element {
  const isSet = hasLocalPin();
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [step, setStep] = useState<'enter' | 'new' | 'confirm'>(isSet ? 'enter' : 'new');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Brute-force lockout (security review 2026-07-21): epoch-ms locked until, and
  // the live countdown seconds shown to the operator.
  const [lockedUntil, setLockedUntil] = useState(() => {
    const a = readAttempts();
    return a.lockedUntil > Date.now() ? a.lockedUntil : 0;
  });
  const [lockSecs, setLockSecs] = useState(0);

  useEffect(() => {
    if (pin.length !== 4 || busy) return;
    void handleComplete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  // Live countdown while locked; clears itself when the window elapses.
  useEffect(() => {
    if (lockedUntil <= Date.now()) {
      setLockSecs(0);
      return;
    }
    const tick = (): void => {
      const secs = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
      setLockSecs(secs);
      if (secs === 0) setLockedUntil(0);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lockedUntil]);

  async function handleComplete(): Promise<void> {
    if (step === 'enter' && lockedUntil > Date.now()) {
      setPin('');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (step === 'enter') {
        const ok = await verifyLocalPin(pin);
        if (ok) {
          clearAttempts();
          setLockedUntil(0);
          onUnlocked();
        } else {
          const r = recordFailedAttempt();
          setPin('');
          if (r.wiped) {
            onSignOut();
            return;
          }
          if (r.lockedUntil > Date.now()) setLockedUntil(r.lockedUntil);
          const remaining = WIPE_AFTER - r.fails;
          setError(
            r.lockedUntil > Date.now()
              ? `Falscher Code. Kurz gesperrt. Noch ${remaining} Versuch${remaining === 1 ? '' : 'e'}.`
              : `Falscher Code. Noch ${remaining} Versuch${remaining === 1 ? '' : 'e'}, dann ist eine neue Google-Anmeldung nötig.`,
          );
        }
      } else if (step === 'new') {
        setConfirmPin(pin);
        setStep('confirm');
        setPin('');
      } else {
        // confirm
        if (pin === confirmPin) {
          await setLocalPin(pin);
          onUnlocked();
        } else {
          setError('Die Codes stimmen nicht überein.');
          setPin('');
          setConfirmPin('');
          setStep('new');
        }
      }
    } finally {
      setBusy(false);
    }
  }

  const heading =
    step === 'enter'
      ? 'Schnellcode eingeben'
      : step === 'new'
        ? 'Schnellcode einrichten'
        : 'Code bestätigen';
  const subline =
    step === 'enter'
      ? 'Zum Entsperren dieses Geräts.'
      : step === 'new'
        ? 'Ein 4-stelliger Code für die schnelle Rückkehr. Die eigentliche Anmeldung bleibt Google.'
        : 'Bitte den Code erneut eingeben.';

  return (
    <div
      className="w14-paper-noise"
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'var(--w14-parchment)',
      }}
    >
      <ParchmentCard padding="lg" style={{ width: 'min(440px, 100%)', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Seal size="lg" tone="gold" />
        </div>
        <h1
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1.4rem',
            margin: '14px 0 2px',
          }}
        >
          {heading}
        </h1>
        <p style={{ margin: 0, color: 'var(--w14-ink-faded)', fontSize: '0.9rem', lineHeight: 1.5 }}>
          {subline}
        </p>
        <DiamondRule />

        <PinPad
          value={pin}
          onChange={setPin}
          onSubmit={() => void handleComplete()}
          disabled={busy || (step === 'enter' && lockedUntil > Date.now())}
          bindKeyboard
        />

        {step === 'enter' && lockedUntil > Date.now() ? (
          <p role="alert" style={{ color: 'var(--w14-wax-red)', margin: '14px 0 0', fontSize: '0.92rem' }}>
            {`Zu viele Fehlversuche. In ${lockSecs} Sekunden wieder versuchen.`}
          </p>
        ) : (
          error && (
            <p role="alert" style={{ color: 'var(--w14-wax-red)', margin: '14px 0 0', fontSize: '0.92rem' }}>
              {error}
            </p>
          )
        )}

        <DiamondRule />
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
          <button
            type="button"
            onClick={onSignOut}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--w14-ink-faded)',
              fontFamily: 'var(--w14-font-display)',
              fontStyle: 'italic',
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            Mit Google neu anmelden
          </button>
        </div>
      </ParchmentCard>
    </div>
  );
}
