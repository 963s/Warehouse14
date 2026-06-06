/**
 * IconButton — an icon-only button for universal actions. ALWAYS requires an
 * accessible name (`label` → aria-label + title). Touch-first: ≥44px target,
 * brand hover (parchment-3) + a gold focus ring. Use for delete/close/search/
 * add/print/back/edit; anything non-obvious must use a label, not an icon alone.
 */
import { type ButtonHTMLAttributes, type CSSProperties, forwardRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';

import { Icon } from './Icon.js';

export type IconButtonTone = 'default' | 'muted' | 'danger';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  icon: LucideIcon;
  /** REQUIRED accessible name — becomes aria-label + the hover title. */
  label: string;
  /** Icon pixel size (the button stays ≥44px regardless). */
  iconSize?: number;
  tone?: IconButtonTone;
}

const TONE_COLOR: Record<IconButtonTone, string> = {
  default: 'var(--w14-ink-aged)',
  muted: 'var(--w14-ink-faded)',
  danger: 'var(--w14-wax-red)',
};

const BASE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 44,
  minHeight: 44,
  padding: 0,
  border: 'none',
  background: 'transparent',
  borderRadius: 'var(--w14-radius-button)',
  cursor: 'pointer',
  transition:
    'background-color var(--w14-dur-short) var(--w14-ease-curator),' +
    ' box-shadow var(--w14-dur-short) var(--w14-ease-curator)',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, iconSize = 20, tone = 'default', disabled, style, onMouseEnter, onMouseLeave, onFocus, onBlur, ...rest },
  ref,
) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onMouseEnter={(e) => {
        setHover(true);
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        setHover(false);
        onMouseLeave?.(e);
      }}
      onFocus={(e) => {
        setFocus(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocus(false);
        onBlur?.(e);
      }}
      style={{
        ...BASE,
        color: TONE_COLOR[tone],
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'default' : 'pointer',
        background: hover && !disabled ? 'var(--w14-parchment-3)' : 'transparent',
        boxShadow: focus ? '0 0 0 3px rgba(191, 148, 48, 0.35)' : 'none',
        ...style,
      }}
      {...rest}
    >
      <Icon icon={icon} size={iconSize} />
    </button>
  );
});
