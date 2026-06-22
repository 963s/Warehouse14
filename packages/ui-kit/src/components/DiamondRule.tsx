/**
 * DiamondRule — section divider with a centered `◆` glyph, mirroring the
 * cartouche horizontal rule on the brand wordmark.
 *
 *   ─────────────── ◆ ───────────────
 *
 * Use between major card sections (e.g. between "Beleg" and "Zahlung" on
 * the receipt preview). NEVER use stock <hr/> — it breaks the antique
 * typesetting illusion.
 */

import type { CSSProperties } from 'react';

export interface DiamondRuleProps {
  /** Diamond + line tone. Default: faded ink. */
  tone?: 'ink' | 'gold' | 'wax-red' | 'faded';
  /** Empty label = bare diamond. Provide text to make a section caption. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

const TONE_VAR: Record<NonNullable<DiamondRuleProps['tone']>, string> = {
  ink: 'var(--w14-ink)',
  gold: 'var(--w14-gilt)',
  'wax-red': 'var(--w14-wax-red)',
  faded: 'var(--w14-ink-faded)',
};

export function DiamondRule({
  tone = 'faded',
  label,
  className,
  style,
}: DiamondRuleProps): JSX.Element {
  const color = TONE_VAR[tone];
  const merged: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    color,
    margin: '16px 0',
    ...style,
  };
  const line: CSSProperties = {
    flex: 1,
    height: 0,
    borderTop: `1px solid ${color}`,
    opacity: 0.6,
  };
  // A purely decorative divider. When a `label` is supplied it reads as a
  // visible section caption, so we keep that text in the accessibility tree;
  // the bare-diamond variant is hidden. We avoid role="separator" because a
  // focusable/`<hr>` separator is wrong for what is a typographic flourish.
  return (
    <div className={className} style={merged}>
      <span aria-hidden style={line} />
      {label ? (
        <span
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontVariant: 'all-small-caps',
            letterSpacing: '0.14em',
            fontSize: '0.82rem',
          }}
        >
          <span aria-hidden>◆ </span>
          {label}
          <span aria-hidden> ◆</span>
        </span>
      ) : (
        <span aria-hidden style={{ lineHeight: 1, fontSize: '0.9em' }}>
          ◆
        </span>
      )}
      <span style={line} />
    </div>
  );
}
