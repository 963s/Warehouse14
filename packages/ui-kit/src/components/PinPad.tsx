/**
 * PinPad — the brand 4-digit numeric keypad.
 *
 * Used by PinLogin (the first authenticated screen) AND by the global
 * StepUpModal (memory.md #76). Pure presentation: the parent owns the
 * PIN state + submission. Physical keyboard handling is OPT-IN — pass
 * `bindKeyboard` when the pad is the only focusable surface.
 *
 *   <PinPad
 *     value={pin}
 *     onChange={setPin}
 *     onSubmit={runSubmit}
 *     disabled={lockoutActive}
 *     bindKeyboard
 *   />
 *
 * The pad shows 4 dotted underline slots above a 3×4 keypad with a Backspace
 * `⌫` and an OK button that wears the MagnifierIcon (the brand search/seal
 * affordance — same one PinLogin uses).
 */

import { type CSSProperties, useEffect } from 'react';

import { Button } from './Button.js';
import { MagnifierIcon } from './MagnifierIcon.js';

export interface PinPadProps {
  /** Current PIN (0..PIN_LENGTH digits). */
  value: string;
  /** Called with the new value when a digit / backspace is pressed. */
  onChange: (next: string) => void;
  /**
   * Called when the operator confirms — either by pressing OK explicitly,
   * by pressing Enter (when `bindKeyboard` is true), or implicitly once
   * the last digit lands (when `submitOnComplete` is true).
   */
  onSubmit: () => void;
  /** Greys out the pad — used during submit + during lockout countdowns. */
  disabled?: boolean;
  /** Length of the PIN. Defaults to 4. */
  pinLength?: number;
  /**
   * When true, the pad listens to window-level keydown events for digits +
   * Backspace + Enter. Use ONLY when this pad is the only interactive
   * element on the page (login screen, step-up modal).
   */
  bindKeyboard?: boolean;
  /** Auto-fire `onSubmit` when the operator types the final digit. Default true. */
  submitOnComplete?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function PinPad({
  value,
  onChange,
  onSubmit,
  disabled = false,
  pinLength = 4,
  bindKeyboard = false,
  submitOnComplete = true,
  className,
  style,
}: PinPadProps): JSX.Element {
  const canSubmit = !disabled && value.length === pinLength;

  // Auto-fire submit once the final digit lands.
  useEffect(() => {
    if (submitOnComplete && value.length === pinLength) {
      onSubmit();
    }
  }, [value.length, pinLength, submitOnComplete, onSubmit, value]);

  // Optional global keyboard handler.
  useEffect(() => {
    if (!bindKeyboard) return;
    const onKey = (ev: KeyboardEvent): void => {
      if (disabled) return;
      if (/^[0-9]$/.test(ev.key)) {
        if (value.length < pinLength) onChange(value + ev.key);
      } else if (ev.key === 'Backspace') {
        onChange(value.slice(0, -1));
      } else if (ev.key === 'Enter') {
        onSubmit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bindKeyboard, disabled, onChange, onSubmit, pinLength, value]);

  const onDigit = (d: string): void => {
    if (disabled) return;
    if (value.length < pinLength) onChange(value + d);
  };
  const onBackspace = (): void => {
    if (disabled) return;
    onChange(value.slice(0, -1));
  };

  return (
    <div className={className} style={style}>
      <div
        aria-label="PIN"
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 12,
          marginBottom: 18,
        }}
      >
        {Array.from({ length: pinLength }).map((_, i) => (
          <div
            key={i}
            style={{
              width: 48,
              height: 56,
              borderBottom: '2px solid var(--w14-rule)',
              fontFamily: 'var(--w14-font-mono)',
              fontSize: '1.6rem',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--w14-ink)',
            }}
          >
            {value[i] ? '●' : ''}
          </div>
        ))}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 8,
        }}
      >
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Button
            key={d}
            variant="primary"
            size="lg"
            onClick={() => onDigit(d)}
            disabled={disabled}
            style={{ fontFamily: 'var(--w14-font-mono)', fontSize: '1.4rem' }}
          >
            {d}
          </Button>
        ))}
        <Button
          variant="ghost"
          size="lg"
          onClick={onBackspace}
          disabled={disabled || value.length === 0}
          aria-label="Zurück"
        >
          ⌫
        </Button>
        <Button
          variant="primary"
          size="lg"
          onClick={() => onDigit('0')}
          disabled={disabled}
          style={{ fontFamily: 'var(--w14-font-mono)', fontSize: '1.4rem' }}
        >
          0
        </Button>
        <Button
          variant="ghost"
          size="lg"
          onClick={onSubmit}
          disabled={!canSubmit}
          aria-label="Anmelden"
          iconLeft={<MagnifierIcon size={18} />}
        >
          OK
        </Button>
      </div>
    </div>
  );
}
