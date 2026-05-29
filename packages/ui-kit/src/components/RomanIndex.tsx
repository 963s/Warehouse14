/**
 * RomanIndex — renders a number as a small-caps Roman numeral with the
 * brand's diamond `◆` glyph on the left, used as a line-number affordance.
 *
 *   <RomanIndex value={1} />   →  ◆ I
 *   <RomanIndex value={47} />  →  ◆ XLVII
 *
 * Cap at 3999 (standard Roman ceiling). For lowercase use `variant="lower"`
 * — sub-items in nested cart lines.
 */

import type { CSSProperties } from 'react';

export interface RomanIndexProps {
  value: number;
  variant?: 'upper' | 'lower';
  /** Hide the leading diamond when chaining (e.g. inside a list header). */
  showDiamond?: boolean;
  /** Tone of both diamond + numeral. */
  tone?: 'ink' | 'gold' | 'wax-red' | 'faded';
  className?: string;
  style?: CSSProperties;
}

const TONE_VAR: Record<NonNullable<RomanIndexProps['tone']>, string> = {
  ink: 'var(--w14-ink)',
  gold: 'var(--w14-gold)',
  'wax-red': 'var(--w14-wax-red)',
  faded: 'var(--w14-ink-faded)',
};

const ROMAN_PAIRS: Array<[number, string]> = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

export function toRoman(n: number): string {
  if (!Number.isInteger(n) || n <= 0 || n >= 4000) {
    return String(n);
  }
  let remaining = n;
  let out = '';
  for (const [v, glyph] of ROMAN_PAIRS) {
    while (remaining >= v) {
      out += glyph;
      remaining -= v;
    }
  }
  return out;
}

export function RomanIndex({
  value,
  variant = 'upper',
  showDiamond = true,
  tone = 'ink',
  className,
  style,
}: RomanIndexProps): JSX.Element {
  const numeral = variant === 'lower' ? toRoman(value).toLowerCase() : toRoman(value);
  const merged: CSSProperties = {
    color: TONE_VAR[tone],
    fontFamily: 'var(--w14-font-display)',
    fontVariant: 'all-small-caps',
    letterSpacing: '0.08em',
    fontWeight: 500,
    display: 'inline-flex',
    alignItems: 'baseline',
    gap: '0.4em',
    ...style,
  };
  return (
    <span className={className} style={merged}>
      {showDiamond && (
        <span aria-hidden style={{ opacity: 0.55, fontSize: '0.82em' }}>
          ◆
        </span>
      )}
      <span>{numeral}</span>
    </span>
  );
}
