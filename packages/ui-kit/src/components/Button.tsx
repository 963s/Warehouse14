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
    backgroundColor: 'var(--w14-parchment-2)',
    color: 'var(--w14-ink)',
    border: '1px solid var(--w14-rule)',
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

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  iconLeft,
  iconRight,
  fullWidth,
  className,
  style,
  ...rest
}: ButtonProps): JSX.Element {
  const merged: CSSProperties = {
    ...SIZE_STYLE[size],
    ...VARIANT_STYLE[variant],
    borderRadius: 'var(--w14-radius-button)',
    fontFamily: 'var(--w14-font-body)',
    fontWeight: 500,
    cursor: rest.disabled ? 'not-allowed' : 'pointer',
    opacity: rest.disabled ? 0.55 : 1,
    transition: 'border-color var(--w14-dur-short) var(--w14-ease-curator),' +
                ' background-color var(--w14-dur-short) var(--w14-ease-curator),' +
                ' box-shadow var(--w14-dur-short) var(--w14-ease-curator)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: fullWidth ? '100%' : 'auto',
    boxShadow: '0 1px 0 transparent',
    ...style,
  };
  return (
    <button
      className={['w14-button', `w14-button--${variant}`, className].filter(Boolean).join(' ')}
      style={merged}
      onMouseEnter={(ev) => {
        if (rest.disabled) return;
        (ev.currentTarget as HTMLButtonElement).style.boxShadow = '0 1px 0 var(--w14-gold)';
      }}
      onMouseLeave={(ev) => {
        (ev.currentTarget as HTMLButtonElement).style.boxShadow = '0 1px 0 transparent';
      }}
      {...rest}
    >
      {iconLeft}
      <span>{children}</span>
      {iconRight}
    </button>
  );
}
