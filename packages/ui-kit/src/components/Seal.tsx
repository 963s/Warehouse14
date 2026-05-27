/**
 * Seal — the brand's stamped "14" medallion.
 *
 * Three sizes (sm 32px, md 56px, lg 96px). Used as the persistent app icon
 * in the nav rail + as the receipt header + as an empty-state focal point.
 * The number may be overridden — useful for showing daily counters ("N° 47")
 * or shift IDs on the operator footer.
 */

import type { CSSProperties } from 'react';

export interface SealProps {
  /** What to display inside the seal. Default: "14" (the brand). */
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  /** Stroke + text colour. Default: ink. */
  tone?: 'ink' | 'gold' | 'wax-red' | 'faded';
  className?: string;
  style?: CSSProperties;
  title?: string;
}

const SIZE_PX = { sm: 32, md: 56, lg: 96 } as const;

const TONE_VAR: Record<NonNullable<SealProps['tone']>, string> = {
  ink: 'var(--w14-ink)',
  gold: 'var(--w14-gold)',
  'wax-red': 'var(--w14-wax-red)',
  faded: 'var(--w14-ink-faded)',
};

export function Seal({
  label = '14',
  size = 'md',
  tone = 'ink',
  className,
  style,
  title,
}: SealProps): JSX.Element {
  const px = SIZE_PX[size];
  const merged: CSSProperties = {
    color: TONE_VAR[tone],
    width: px,
    height: px,
    ...style,
  };

  // Font size proportional to ring radius; Cormorant takes the lead inside.
  const fontSize = Math.round(px * 0.52);

  return (
    <svg
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      viewBox="0 0 100 100"
      className={className}
      style={merged}
      fill="none"
    >
      {/* outer ring — slightly off-true to feel hand-stamped */}
      <circle cx="50" cy="50" r="46" stroke="currentColor" strokeWidth="2.5" />
      {/* inner hairline ring */}
      <circle cx="50" cy="50" r="40" stroke="currentColor" strokeWidth="0.6" opacity="0.55" />
      <text
        x="50"
        y="50"
        dominantBaseline="central"
        textAnchor="middle"
        fontFamily="var(--w14-font-display)"
        fontWeight={500}
        fontStyle="normal"
        fontSize={fontSize}
        fill="currentColor"
      >
        {label}
      </text>
    </svg>
  );
}
