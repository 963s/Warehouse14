/**
 * Button — three variants, two sizes, one accent that gets the gold underline
 * swash on hover (the Didone-style flourish that ties to the wordmark).
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

const SIZE_STYLE: Record<NonNullable<ButtonProps['size']>, CSSProperties> = {
  sm: { padding: '4px 12px', fontSize: '0.85rem', minHeight: 32 },
  md: { padding: '8px 18px', fontSize: '0.95rem', minHeight: 40 },
  lg: { padding: '12px 24px', fontSize: '1.05rem', minHeight: 52 },
};

const VARIANT_STYLE: Record<NonNullable<ButtonProps['variant']>, CSSProperties> = {
  primary: {
    backgroundColor: 'var(--w14-accent)',
    color: 'var(--w14-accent-ink)',
    border: '1px solid var(--w14-accent)',
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
   the main action pops; the others keep the subtle gold underline swash. */
const REST_SHADOW: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: '0 1px 2px rgba(16, 24, 40, 0.12), 0 1px 3px rgba(16, 24, 40, 0.10)',
  destructive: '0 1px 0 transparent',
  ghost: '0 1px 0 transparent',
};
const HOVER_SHADOW: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: '0 2px 6px rgba(16, 24, 40, 0.18), 0 1px 3px rgba(16, 24, 40, 0.12)',
  destructive: '0 1px 0 var(--w14-gold)',
  ghost: '0 1px 0 var(--w14-gold)',
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
      'border-color var(--w14-dur-short) var(--w14-ease-curator),' +
      ' background-color var(--w14-dur-short) var(--w14-ease-curator),' +
      ' box-shadow var(--w14-dur-short) var(--w14-ease-curator)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-2)',
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
        if (variant === 'primary') el.style.backgroundColor = 'var(--w14-accent-hover)';
      }}
      onMouseLeave={(ev) => {
        const el = ev.currentTarget as HTMLButtonElement;
        el.style.boxShadow = REST_SHADOW[variant];
        if (variant === 'primary') el.style.backgroundColor = 'var(--w14-accent)';
      }}
      onFocus={(ev) => {
        if (!rest.disabled) {
          // Visible, contrast-checked brass focus halo (WCAG 2.4.7 / 1.4.11),
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
