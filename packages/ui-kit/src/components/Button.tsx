/**
 * Button — three variants, two sizes. The primary fill is INK (the official
 * store system: ink is the accent; gold is a thread/edge/seal only, never a
 * fill). Ghost/destructive get a subtle gilt underline swash on hover.
 *
 *   <Button variant="primary">Verkauf abschließen</Button>
 *   <Button variant="destructive">Storno</Button>
 *   <Button variant="ghost">Abbrechen</Button>
 *
 * Owner-step-up actions wrap the button in a separate StepUpGuard component
 * (Phase 2 Day 3) — Button itself is presentation-only.
 */

import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: 'primary' | 'destructive' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  fullWidth?: boolean;
}

/* Min tap heights honour the accessibility floor (WCAG 2.5.5) — never below
   40px, and md (where primary money-path actions land) meets the canonical
   44px --w14-touch-min. lg stays the generous ~52px. */
const SIZE_STYLE: Record<NonNullable<ButtonProps['size']>, CSSProperties> = {
  sm: { padding: '6px 14px', fontSize: 'var(--w14-step--1)', minHeight: 40 },
  md: { padding: '8px 18px', fontSize: 'var(--w14-step-0)', minHeight: 'var(--w14-touch-min)' },
  lg: { padding: '12px 24px', fontSize: 'var(--w14-step-1)', minHeight: 52 },
};

const VARIANT_STYLE: Record<NonNullable<ButtonProps['variant']>, CSSProperties> = {
  primary: {
    /* INK is the house accent — the official store uses ink as the primary
       action fill, with gilt reserved for thread/edge/seal. */
    backgroundColor: 'var(--w14-ink)',
    color: 'var(--w14-parchment-2)',
    border: '1px solid var(--w14-ink)',
    fontWeight: 600,
  },
  destructive: {
    backgroundColor: 'transparent',
    color: 'var(--w14-wax-red)',
    border: '1px solid var(--w14-wax-red)',
  },
  ghost: {
    backgroundColor: 'transparent',
    color: 'var(--w14-ink-aged)',
    border: '1px solid transparent',
  },
};

/* Resting / hover box-shadow per variant — primary gets a confident lift so
   the main action pops; ghost/destructive keep a subtle gilt underline swash
   on hover (the only place gold appears — a thread, not a fill). */
const REST_SHADOW: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'var(--w14-shadow-card)',
  destructive: '0 1px 0 transparent',
  ghost: '0 1px 0 transparent',
};
const HOVER_SHADOW: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'var(--w14-shadow-lift)',
  destructive: '0 1px 0 var(--w14-gilt)',
  ghost: '0 1px 0 var(--w14-gilt)',
};

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  iconLeft,
  iconRight,
  fullWidth,
  className,
  style,
  onFocus,
  onBlur,
  ...rest
}: ButtonProps): JSX.Element {
  const merged: CSSProperties = {
    ...SIZE_STYLE[size],
    borderRadius: 'var(--w14-radius-button)',
    fontFamily: 'var(--w14-font-body)',
    fontWeight: 500,
    ...VARIANT_STYLE[variant],
    cursor: rest.disabled ? 'not-allowed' : 'pointer',
    opacity: rest.disabled ? 0.55 : 1,
    transition:
      'border-color var(--w14-dur-fast) var(--w14-ease-hover),' +
      ' background-color var(--w14-dur-fast) var(--w14-ease-hover),' +
      ' box-shadow var(--w14-dur-fast) var(--w14-ease-hover)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--w14-space-1)',
    width: fullWidth ? '100%' : 'auto',
    boxShadow: REST_SHADOW[variant],
    ...style,
  };
  return (
    <button
      className={['w14-button', `w14-button--${variant}`, className].filter(Boolean).join(' ')}
      style={merged}
      onMouseEnter={(ev) => {
        if (rest.disabled) return;
        const el = ev.currentTarget as HTMLButtonElement;
        el.style.boxShadow = HOVER_SHADOW[variant];
        if (variant === 'primary') el.style.backgroundColor = 'var(--w14-gold-soft)';
      }}
      onMouseLeave={(ev) => {
        const el = ev.currentTarget as HTMLButtonElement;
        el.style.boxShadow = REST_SHADOW[variant];
        if (variant === 'primary') el.style.backgroundColor = 'var(--w14-ink)';
      }}
      onFocus={(ev) => {
        if (!rest.disabled) {
          // Visible, contrast-checked ink focus halo (WCAG 2.4.7 / 1.4.11),
          // layered over the variant's resting shadow so the lift is preserved.
          const el = ev.currentTarget as HTMLButtonElement;
          el.style.boxShadow = `${REST_SHADOW[variant]}, var(--w14-focus-shadow)`;
        }
        onFocus?.(ev);
      }}
      onBlur={(ev) => {
        const el = ev.currentTarget as HTMLButtonElement;
        el.style.boxShadow = REST_SHADOW[variant];
        onBlur?.(ev);
      }}
      {...rest}
    >
      {iconLeft}
      <span>{children}</span>
      {iconRight}
    </button>
  );
}
