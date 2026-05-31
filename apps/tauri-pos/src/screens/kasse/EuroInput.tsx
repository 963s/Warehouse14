/**
 * EuroInput — purpose-built EUR amount field for Kasse forms.
 *
 * Wire format: DecimalString matching the backend's `^\\d{1,16}(\\.\\d{1,2})?$`.
 * The visual format is German (1.234,56 €) inside a JetBrains-Mono input —
 * memory.md §10.3 + memory.md #76 strict "money uses mono".
 *
 * Local UX rules:
 *   • operator types digits + a comma OR a dot — both produce the canonical
 *     dot-decimal output via `valueEur`.
 *   • underline-only border that turns gold on focus (matches PinPad).
 *   • the suffix shows "€" + the live formatted preview to confirm parsing.
 */

import { type CSSProperties, type ChangeEvent, useId, useMemo, useState } from 'react';

export interface EuroInputProps {
  /** Canonical decimal string (e.g. "1234.50"). Always dot-decimal. */
  valueEur: string;
  /** Called with the new canonical string on every change. */
  onValueChange: (next: string) => void;
  label: string;
  /** Disables the input + greys the underline. */
  disabled?: boolean;
  /** Auto-focus when mounted. */
  autoFocus?: boolean;
  /** Max characters in the raw input string. Default 14. */
  maxLength?: number;
  className?: string;
  style?: CSSProperties;
}

/** Convert raw operator text into the canonical decimal string. */
function normalise(raw: string): string {
  // Allow only digits, dot, comma. Drop everything else.
  const cleaned = raw.replace(/[^\d.,]/g, '').replace(/,/g, '.');
  // Collapse multiple dots — keep the first.
  const dotIdx = cleaned.indexOf('.');
  if (dotIdx === -1) return cleaned;
  const head = cleaned.slice(0, dotIdx);
  const tail = cleaned
    .slice(dotIdx + 1)
    .replace(/\./g, '')
    .slice(0, 2);
  return `${head}.${tail}`;
}

function formatPreview(canonical: string): string {
  if (canonical.length === 0) return '';
  const trimmed = canonical;
  // Don't preview half-typed input — show only when there's at least one digit.
  if (!/\d/.test(trimmed)) return '';
  const [whole, frac] = trimmed.split('.');
  const wholeFmt = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fracFmt = (frac ?? '').padEnd(2, '0').slice(0, 2);
  return `${wholeFmt},${fracFmt} €`;
}

export function EuroInput({
  valueEur,
  onValueChange,
  label,
  disabled = false,
  autoFocus = false,
  maxLength = 14,
  className,
  style,
}: EuroInputProps): JSX.Element {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const preview = useMemo(() => formatPreview(valueEur), [valueEur]);

  const onChange = (ev: ChangeEvent<HTMLInputElement>): void => {
    const next = normalise(ev.target.value);
    onValueChange(next);
  };

  const wrapStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    ...style,
  };
  const inputStyle: CSSProperties = {
    width: '100%',
    border: 'none',
    outline: 'none',
    borderBottom: `2px solid ${focused ? 'var(--w14-gold)' : 'var(--w14-rule)'}`,
    background: 'transparent',
    color: 'var(--w14-ink)',
    fontFamily: 'var(--w14-font-mono)',
    fontSize: '1.65rem', // A1: larger for fast-paced retail readability
    padding: '14px 8px', // A1: taller tap target (~52px) for touch
    minHeight: 52,
    transition: 'border-color var(--w14-dur-short) var(--w14-ease-curator)',
    opacity: disabled ? 0.55 : 1,
  };

  return (
    <div className={className} style={wrapStyle}>
      <label
        htmlFor={id}
        className="w14-smallcaps"
        style={{
          color: 'var(--w14-ink-faded)',
          fontSize: '0.78rem',
        }}
      >
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        spellCheck={false}
        autoComplete="off"
        value={valueEur}
        onChange={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={disabled}
        maxLength={maxLength}
        autoFocus={autoFocus}
        style={inputStyle}
      />
      <span
        style={{
          fontFamily: 'var(--w14-font-display)',
          fontStyle: 'italic',
          fontSize: '0.82rem',
          color: 'var(--w14-ink-faded)',
          minHeight: '1.2em',
        }}
      >
        {preview || '—'}
      </span>
    </div>
  );
}
