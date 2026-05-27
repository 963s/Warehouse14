/**
 * SurfaceChip — one chip in the Karteikasten-Index top rail.
 *
 * Locked by memory.md §11.2:
 *   <mono digit>  ·  <Cormorant small-caps label>
 *
 * Visual states (resting / hover / active) implemented inline so the rail
 * never blinks during route transitions. The active state owns a 2 px
 * gold hairline; hover raises a 2 px gold-soft hairline. No box, no fill.
 */

import type { CSSProperties } from 'react';

export interface SurfaceChipProps {
  digit: number;
  label: string;
  description: string;
  active: boolean;
  onActivate: () => void;
  className?: string;
  style?: CSSProperties;
}

export function SurfaceChip({
  digit,
  label,
  description,
  active,
  onActivate,
  className,
  style,
}: SurfaceChipProps): JSX.Element {
  const containerStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'baseline',
    gap: 8,
    padding: '6px 10px',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    color: active ? 'var(--w14-ink-aged)' : 'var(--w14-ink-faded)',
    borderBottom: active
      ? '2px solid var(--w14-gold)'
      : '2px solid transparent',
    transition:
      'border-color var(--w14-dur-short) var(--w14-ease-curator),' +
      ' color var(--w14-dur-short) var(--w14-ease-curator)',
    ...style,
  };

  const digitStyle: CSSProperties = {
    fontFamily: 'var(--w14-font-mono)',
    fontWeight: 500,
    fontSize: '0.86rem',
    color: active ? 'var(--w14-gold)' : 'inherit',
  };

  const labelStyle: CSSProperties = {
    fontFamily: 'var(--w14-font-display)',
    fontVariant: 'all-small-caps',
    letterSpacing: '0.08em',
    fontSize: '0.84rem',
    fontWeight: 500,
  };

  return (
    <button
      type="button"
      title={description}
      aria-current={active ? 'page' : undefined}
      onClick={onActivate}
      onMouseEnter={(ev) => {
        if (active) return;
        (ev.currentTarget as HTMLButtonElement).style.borderBottomColor =
          'var(--w14-gold-soft)';
        (ev.currentTarget as HTMLButtonElement).style.color = 'var(--w14-ink-aged)';
      }}
      onMouseLeave={(ev) => {
        if (active) return;
        (ev.currentTarget as HTMLButtonElement).style.borderBottomColor = 'transparent';
        (ev.currentTarget as HTMLButtonElement).style.color = 'var(--w14-ink-faded)';
      }}
      className={className}
      style={containerStyle}
    >
      <span style={digitStyle}>{digit}</span>
      <span aria-hidden style={{ opacity: 0.45 }}>·</span>
      <span style={labelStyle}>{label}</span>
    </button>
  );
}
