/**
 * StatusDot — the ADR-0019 §2 status atom (red / yellow / green, never
 * decorative). ui-kit does not yet ship this primitive, so it lives locally in
 * the Control Desktop until it graduates into `@warehouse14/ui-kit`.
 *
 * Discipline (ADR-0019 §5, §10): the four tones map onto the brand accent
 * tokens — wax-red = alert, gold = watch, verdigris = ok, faded ink = info —
 * so the "Editorial Luxury*" palette stays intact while still reading as the
 * universal 🔴🟡🟢. The dot is graphical; an accessible label is always
 * provided so screen readers announce the state (ADR-0019 §12).
 */

import type { CSSProperties } from 'react';

export type StatusTone = 'ok' | 'watch' | 'alert' | 'info';

const TONE: Record<StatusTone, { color: string; label: string }> = {
  ok: { color: 'var(--w14-verdigris)', label: 'In Ordnung' },
  watch: { color: 'var(--w14-gold)', label: 'Beobachten' },
  alert: { color: 'var(--w14-wax-red)', label: 'Achtung' },
  info: { color: 'var(--w14-ink-faded)', label: 'Information' },
};

export interface StatusDotProps {
  tone: StatusTone;
  /** Diameter in px. Default 10. */
  size?: number;
  /** Override the default German accessible label. */
  label?: string;
  style?: CSSProperties;
}

export function StatusDot({ tone, size = 10, label, style }: StatusDotProps): JSX.Element {
  const meta = TONE[tone];
  return (
    <span
      role="img"
      aria-label={label ?? meta.label}
      style={{
        display: 'inline-block',
        flex: '0 0 auto',
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: meta.color,
        boxShadow: 'inset 0 0 0 1px rgba(15, 15, 15, 0.18)',
        ...style,
      }}
    />
  );
}
