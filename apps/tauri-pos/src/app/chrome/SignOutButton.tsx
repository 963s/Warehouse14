/**
 * SignOutButton — inline-confirm style. First click flips to a
 * "Bestätigen / Abbrechen" pair; second click on Bestätigen performs the
 * sign-out. Avoids browser confirm() — keeps brand integrity.
 *
 * The actual sign-out (clearing session, ledger buffer, cart, recents)
 * is handled by the parent's `onConfirm` so this component stays purely
 * presentational.
 */

import { useEffect, useRef, useState } from 'react';

import type { CSSProperties } from 'react';

const RESET_AFTER_MS = 4_000;

export interface SignOutButtonProps {
  onConfirm: () => void;
}

export function SignOutButton({ onConfirm }: SignOutButtonProps): JSX.Element {
  const [armed, setArmed] = useState(false);
  const resetTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!armed) return;
    resetTimer.current = window.setTimeout(() => setArmed(false), RESET_AFTER_MS);
    return () => {
      if (resetTimer.current !== null) {
        window.clearTimeout(resetTimer.current);
        resetTimer.current = null;
      }
    };
  }, [armed]);

  const baseBtn: CSSProperties = {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    padding: '6px 10px',
    color: 'var(--w14-ink-faded)',
    fontFamily: 'var(--w14-font-display)',
    fontVariant: 'all-small-caps',
    letterSpacing: '0.08em',
    fontSize: '0.82rem',
    borderBottom: '2px solid transparent',
    transition:
      'color var(--w14-dur-short) var(--w14-ease-curator),' +
      ' border-color var(--w14-dur-short) var(--w14-ease-curator)',
  };

  if (!armed) {
    return (
      <button
        type="button"
        title="Abmelden"
        aria-label="Abmelden"
        style={baseBtn}
        onClick={() => setArmed(true)}
        onMouseEnter={(ev) => {
          (ev.currentTarget as HTMLButtonElement).style.color = 'var(--w14-wax-red)';
        }}
        onMouseLeave={(ev) => {
          (ev.currentTarget as HTMLButtonElement).style.color = 'var(--w14-ink-faded)';
        }}
      >
        ⏻ Ab
      </button>
    );
  }

  return (
    <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <button
        type="button"
        style={{
          ...baseBtn,
          color: 'var(--w14-wax-red)',
          borderBottom: '2px solid var(--w14-wax-red)',
        }}
        onClick={onConfirm}
      >
        Bestätigen
      </button>
      <button
        type="button"
        style={baseBtn}
        onClick={() => setArmed(false)}
      >
        Abbrechen
      </button>
    </div>
  );
}
