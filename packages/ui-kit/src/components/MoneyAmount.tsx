/**
 * MoneyAmount — formatted EUR display with tabular figures.
 *
 *   <MoneyAmount valueEur="1234.50" />              →  €&nbsp;1.234,50
 *   <MoneyAmount valueEur="1234.50" emphasis />     →  large Cormorant
 *   <MoneyAmount valueEur="-99.99" signed />        →  shows leading minus in wax-red
 *
 * Accepts string values (the only safe wire format — never JS numbers for
 * money). German locale by default (1.234,50 €).
 */

import type { CSSProperties } from 'react';

export interface MoneyAmountProps {
  /** EUR amount as a decimal STRING (never a number). */
  valueEur: string;
  /** Use the Cormorant display face + larger size. */
  emphasis?: boolean;
  /** When `valueEur` is negative, render the minus in wax-red. */
  signed?: boolean;
  /** Locale — default `'de-DE'`. */
  locale?: string;
  /** Currency symbol — default `'EUR'`. */
  currency?: string;
  /** Hide the currency symbol entirely. */
  bareNumber?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Optional title (tooltip) — useful for showing the raw value on hover. */
  title?: string;
}

export function MoneyAmount({
  valueEur,
  emphasis = false,
  signed = false,
  locale = 'de-DE',
  currency = 'EUR',
  bareNumber = false,
  className,
  style,
  title,
}: MoneyAmountProps): JSX.Element {
  // Parse the string to two-decimal-precision integer cents so the formatter
  // never sees floating-point noise. Empty / undefined / non-numeric → render
  // an em-dash placeholder.
  const trimmed = (valueEur ?? '').trim();
  if (trimmed.length === 0 || !/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return (
      <span
        className={className}
        style={{ color: 'var(--w14-ink-faded)', fontFamily: 'var(--w14-font-mono)', ...style }}
        title={title}
      >
        —
      </span>
    );
  }

  const negative = trimmed.startsWith('-');
  const abs = negative ? trimmed.slice(1) : trimmed;
  const [intPart, fracPart = ''] = abs.split('.');
  const cents = Number(`${intPart}${fracPart.padEnd(2, '0').slice(0, 2)}`);
  const amount = cents / 100;

  const formatted = bareNumber
    ? new Intl.NumberFormat(locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount)
    : new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount);

  const merged: CSSProperties = {
    fontFamily: emphasis ? 'var(--w14-font-display)' : 'var(--w14-font-mono)',
    fontWeight: emphasis ? 500 : 400,
    fontSize: emphasis ? '1.6rem' : '1rem',
    fontFeatureSettings: '"tnum"',
    fontVariantNumeric: 'tabular-nums',
    color: negative && signed ? 'var(--w14-wax-red)' : 'inherit',
    whiteSpace: 'nowrap',
    ...style,
  };

  return (
    <span className={className} style={merged} title={title ?? valueEur}>
      {negative ? '−' : ''}
      {formatted}
    </span>
  );
}
