/**
 * LocalLock — the mandatory local device gate (Track A2). Sits over an
 * already-authenticated Google session. If a code is set, it asks for it; if
 * none is set, it requires creating one now (no skip). The real login is always
 * Google — this is the fast, per-device re-entry layer that is never optional.
 */

import { useEffect, useState } from 'react';

import { DiamondRule, ParchmentCard, PinPad, Seal } from '@warehouse14/ui-kit';

import { hasLocalPin, setLocalPin, verifyLocalPin } from '../lib/local-lock.js';

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

  useEffect(() => {
    if (pin.length !== 4 || busy) return;
    void handleComplete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  async function handleComplete(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      if (step === 'enter') {
        const ok = await verifyLocalPin(pin);
        if (ok) {
          onUnlocked();
        } else {
          setError('Falscher Code.');
          setPin('');
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
          disabled={busy}
          bindKeyboard
        />

        {error && (
          <p role="alert" style={{ color: 'var(--w14-wax-red)', margin: '14px 0 0', fontSize: '0.92rem' }}>
            {error}
          </p>
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
