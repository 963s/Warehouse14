/**
 * CartPanel — right column of Verkauf.
 *
 * Renders the live cart (Zustand `useCartStore`) as a stack of Roman-numbered
 * rows + a sticky footer with subtotal/VAT/total + the Bezahlen button.
 *
 * Math: every line is passed through `computeLineMath` (bigint-cents, HALF_EVEN)
 * with its `taxTreatmentCode`. The header sum is `sumHeader` over the LineMath
 * results — never a JS-number addition. The result lands wire-ready in
 * EUR-decimal strings that the BezahlenDialog forwards to the server.
 *
 * Remove action: returns the line from the store, and the parent (Verkauf.tsx)
 * fires `POST /api/inventory/release` with the cart-line's reservationSessionId.
 * The store removal is optimistic — if the release fails the line stays gone
 * (the reservation will expire on its own via worker sweeper) but a wax-red
 * toast surfaces the network issue.
 *
 * Undo-over-confirm (design-brief §1): removing a line is INSTANT — no modal,
 * no "Sind Sie sicher?". Instead a calm ~8 s `Position entfernt — Rückgängig`
 * snackbar slides in at the foot of the cart column; tapping Rückgängig re-runs
 * the parent's reserve→add path (`onUndoRemove`) to put the piece back. Modal +
 * PIN confirmation is reserved for the fiscally-irreversible acts (finalize,
 * full Storno, Kassenabschluss) — never for a removable cart line.
 *
 * State preservation: lines + totals live in Zustand; switching to Werkstatt
 * and back rehydrates the panel without re-fetching. The cart only clears on
 * (a) finalize-success, (b) explicit "Karte leeren", or (c) sign-out cascade.
 */

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  Button,
  DiamondRule,
  Icon,
  IconButton,
  MoneyAmount,
  ParchmentCard,
  Percent,
  RomanIndex,
  Tag,
  Trash2,
  X,
} from '@warehouse14/ui-kit';

import {
  type LineMath,
  computeLineMath,
  distributeInvoiceDiscount,
  fromCents,
  percentToEur,
  sumHeader,
  toCents,
} from '../../lib/cart-math.js';
import { isMoneyInput, normalizeDecimal } from '../../lib/decimal.js';
import {
  MIN_DISCOUNT_REASON_LEN,
  discountReasonShortfall,
  isDiscountReasonValid,
} from '../../lib/discount-reason.js';
import { TAX_TREATMENT_LABEL } from '../../lib/tax-treatment-label.js';
import { type CartLine, useCartStore } from '../../state/cart-store.js';

import { BezahlenDialog } from './BezahlenDialog.js';

export interface CartPanelProps {
  lines: readonly CartLine[];
  /** Triggered by per-row × button. Parent handles release. */
  onRemoveLine: (productId: string) => void;
  /**
   * Undo affordance for a just-removed line — re-runs the parent's
   * reserve→add path (same code as a tile click) with the removed line's
   * snapshot. Drives the `Rückgängig` action on the undo snackbar.
   */
  onUndoRemove?: (line: CartLine) => void;
  /** Set of productIds currently being released (disable row click). */
  releasingProductIds: ReadonlySet<string>;
  /** Wipe-all action — invokes inventory release for every line in parallel. */
  onClearCart: () => void;
  /** True if a clear-cart batch is in progress. */
  clearingCart: boolean;
  /** Fired after a sale finalizes + the dialog closes (parent refocuses search). */
  onAfterFinalize?: () => void;
  /**
   * Notifies the parent when the Bezahlen dialog opens/closes so it can pause
   * the global barcode scanner — the payment step owns Enter + the AmountPad,
   * and a stray scan must not reserve another item mid-checkout.
   */
  onBezahlenOpenChange?: (open: boolean) => void;
}

/** How long the "Position entfernt — Rückgängig" snackbar lingers (brief: 6–10 s). */
const UNDO_WINDOW_MS = 8_000;

export function CartPanel({
  lines,
  onRemoveLine,
  onUndoRemove,
  releasingProductIds,
  onClearCart,
  clearingCart,
  onAfterFinalize,
  onBezahlenOpenChange,
}: CartPanelProps): JSX.Element {
  const [bezahlenOpen, setBezahlenOpen] = useState<boolean>(false);

  // Undo snackbar state — the single most-recently-removed line. A new removal
  // supersedes any pending snackbar (the operator only ever cares about the
  // last action; queuing would clutter the calm POS surface).
  const [undoLine, setUndoLine] = useState<CartLine | null>(null);
  const undoTimerRef = useRef<number | null>(null);

  const clearUndoTimer = useCallback((): void => {
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  }, []);

  // Instant remove + arm the undo snackbar. The actual reservation release still
  // runs in the parent via onRemoveLine — this only layers the undo affordance
  // on top; no reservation/finalize logic changes.
  const handleRemove = useCallback(
    (line: CartLine): void => {
      onRemoveLine(line.productId);
      clearUndoTimer();
      setUndoLine(line);
      undoTimerRef.current = window.setTimeout(() => {
        setUndoLine(null);
        undoTimerRef.current = null;
      }, UNDO_WINDOW_MS);
    },
    [onRemoveLine, clearUndoTimer],
  );

  const handleUndo = useCallback((): void => {
    clearUndoTimer();
    const line = undoLine;
    setUndoLine(null);
    if (line) onUndoRemove?.(line);
  }, [undoLine, onUndoRemove, clearUndoTimer]);

  const dismissUndo = useCallback((): void => {
    clearUndoTimer();
    setUndoLine(null);
  }, [clearUndoTimer]);

  // Cleanup on unmount (surface switch / sign-out) so a stray timer can't fire.
  useEffect(() => clearUndoTimer, [clearUndoTimer]);

  // Mirror the dialog's open state up to Verkauf (scanner gate). Effect, not an
  // inline setter call, so it stays correct regardless of how it's toggled.
  useEffect(() => {
    onBezahlenOpenChange?.(bezahlenOpen);
  }, [bezahlenOpen, onBezahlenOpenChange]);

  // Per-line math (kept stable across renders so we don't re-allocate cents).
  const perLine: ReadonlyArray<{ line: CartLine; math: LineMath }> = useMemo(
    () =>
      lines.map((line) => ({
        line,
        math: computeLineMath({
          taxTreatmentCode: line.taxTreatmentCode,
          listPriceEur: line.listPriceEur,
          acquisitionCostEur: line.acquisitionCostEur,
          discountEur: line.discountEur,
        }),
      })),
    [lines],
  );

  const header = useMemo(() => sumHeader(perLine.map((p) => p.math)), [perLine]);
  const totalCents = useMemo(
    () => perLine.reduce((acc, p) => acc + p.math.lineTotalCents, 0n),
    [perLine],
  );
  const canPay = lines.length > 0 && !clearingCart && totalCents > 0n;

  return (
    <section
      aria-label="Warenkorb"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 'var(--space-4)',
        gap: 'var(--space-4)',
        borderLeft: '1px solid var(--w14-rule)',
        background: 'var(--w14-parchment-1)',
      }}
    >
      {/* Header — title + permanent running-total / item-count anchor.
          The anchor sits at a FROZEN position (top of the column, never behind a
          tap, never scrolls away) so the cashier reads the live total with eyes
          on the customer. Tabular, high-contrast `--w14-ink`. Mirrored by the
          footer Gesamt row so the total is legible top OR bottom of the column. */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--space-3)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <h2
            style={{
              margin: 0,
              fontFamily: 'var(--w14-font-display)',
              fontWeight: 500,
              fontSize: '1.4rem',
              lineHeight: 1.1,
            }}
          >
            Karte
          </h2>
          <span
            className="w14-smallcaps"
            style={{
              color: 'var(--w14-ink-faded)',
              fontSize: '0.78rem',
              letterSpacing: '0.08em',
            }}
          >
            {lines.length === 0
              ? 'leer'
              : `${lines.length} Position${lines.length === 1 ? '' : 'en'}`}
          </span>
        </div>
        {lines.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 0,
              flexShrink: 0,
            }}
          >
            <span
              className="w14-smallcaps"
              style={{
                color: 'var(--w14-ink-faded)',
                fontSize: '0.68rem',
                letterSpacing: '0.1em',
              }}
            >
              Gesamt
            </span>
            <span style={{ fontSize: '1.4rem', lineHeight: 1.05, color: 'var(--w14-ink)' }}>
              <MoneyAmount valueEur={header.totalEur} emphasis />
            </span>
          </div>
        )}
      </header>

      {/* Line list */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
        }}
      >
        {perLine.length === 0 ? (
          <EmptyCart />
        ) : (
          perLine.map(({ line, math }, idx) => (
            <CartRow
              key={line.productId}
              index={idx + 1}
              line={line}
              math={math}
              releasing={releasingProductIds.has(line.productId)}
              onRemove={() => handleRemove(line)}
            />
          ))
        )}
      </div>

      {/* Undo snackbar — non-modal, slides in just above the footer. The remove
          already happened (instant); this is the 6–10 s window to take it back. */}
      {undoLine && <UndoSnackbar line={undoLine} onUndo={handleUndo} onDismiss={dismissUndo} />}

      {/* Footer — totals breakdown + the single edge-anchored primary action.
          flexShrink:0 + the fixed header keep Bezahlen at FROZEN coordinates
          regardless of cart size. */}
      <ParchmentCard padding="md" style={{ flexShrink: 0 }}>
        <DiamondRule label="Summe" />
        <table
          className="w14-tabular"
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontFamily: 'var(--w14-font-mono)',
          }}
        >
          <tbody>
            <TotalRow label="Zwischensumme" value={<MoneyAmount valueEur={header.subtotalEur} />} />
            <TotalRow label="USt" value={<MoneyAmount valueEur={header.vatEur} />} />
            <tr>
              <td colSpan={2} style={{ padding: 0 }}>
                <div
                  style={{
                    height: 1,
                    background: 'var(--w14-rule)',
                    opacity: 0.55,
                    margin: 'var(--space-2) 0',
                  }}
                />
              </td>
            </tr>
            <TotalRow
              label="Gesamt"
              value={<MoneyAmount valueEur={header.totalEur} emphasis />}
              emphasised
            />
          </tbody>
        </table>

        <InvoiceDiscount lines={lines} />

        {/* ONE obvious primary action. Bezahlen owns the full-width, ~80px,
            bottom-anchored slot (Fitts: edge-anchored, the read-from-80cm tile).
            "Karte leeren" is demoted to a quiet underlined link below so it never
            competes for the eye and isn't in the resting thumb's path. */}
        <div
          style={{
            marginTop: 'var(--space-4)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
          }}
        >
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={() => setBezahlenOpen(true)}
            disabled={!canPay}
            style={{ minHeight: 80, fontSize: '1.25rem', fontWeight: 600 }}
          >
            Bezahlen
          </Button>
          <button
            type="button"
            onClick={onClearCart}
            disabled={lines.length === 0 || clearingCart}
            style={{
              alignSelf: 'center',
              background: 'transparent',
              border: 'none',
              color: 'var(--w14-ink-faded)',
              fontFamily: 'var(--w14-font-display)',
              fontSize: '0.82rem',
              padding: '6px 10px',
              minHeight: 32,
              cursor: lines.length === 0 || clearingCart ? 'default' : 'pointer',
              opacity: lines.length === 0 || clearingCart ? 0.5 : 1,
              textDecoration: 'underline',
              textUnderlineOffset: 3,
            }}
          >
            {clearingCart ? 'Räumt…' : 'Karte leeren'}
          </button>
        </div>
      </ParchmentCard>

      <BezahlenDialog
        open={bezahlenOpen}
        onClose={() => setBezahlenOpen(false)}
        lines={lines}
        perLineMath={perLine.map((p) => p.math)}
        totals={header}
        onFinalizeSuccess={onAfterFinalize}
      />
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Undo snackbar
// ────────────────────────────────────────────────────────────────────────

/**
 * UndoSnackbar — the non-modal "Position entfernt — Rückgängig" affordance.
 * Renders inside the cart column (not a global toast) so the undo lives exactly
 * where the removed line was. Sober ease-out slide-in (POS motion budget,
 * `--w14-dur-medium`/`--w14-ease-curator`, GPU-only transform/opacity), a
 * `--w14-wax-red` accent rule (remove is a danger-class act), and a clearly
 * tappable Rückgängig button ≥48px tall. Honors prefers-reduced-motion via the
 * shared motion tokens.
 */
function UndoSnackbar({
  line,
  onUndo,
  onDismiss,
}: {
  line: CartLine;
  onUndo: () => void;
  onDismiss: () => void;
}): JSX.Element {
  const [entered, setEntered] = useState<boolean>(false);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  return (
    // <output> is the semantic live region (implicit role="status", polite).
    <output
      aria-live="polite"
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-3)',
        padding: '10px 12px 10px 16px',
        background: 'var(--w14-parchment-2)',
        border: '1px solid var(--w14-rule)',
        borderLeft: '4px solid var(--w14-wax-red)',
        borderRadius: 'var(--w14-radius-card)',
        boxShadow: 'var(--w14-shadow-modal)',
        opacity: entered ? 1 : 0,
        transform: entered ? 'translateY(0)' : 'translateY(8px)',
        transition:
          'opacity var(--w14-dur-medium) var(--w14-ease-curator),' +
          ' transform var(--w14-dur-medium) var(--w14-ease-curator)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <span
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '0.92rem',
            color: 'var(--w14-ink)',
          }}
        >
          Position entfernt
        </span>
        <span
          style={{
            fontSize: '0.8rem',
            color: 'var(--w14-ink-faded)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={line.name}
        >
          {line.name}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
        <Button
          variant="ghost"
          size="md"
          onClick={onUndo}
          style={{ minHeight: 48, color: 'var(--w14-gold)' }}
        >
          Rückgängig
        </Button>
        <IconButton
          icon={X}
          label="Hinweis schließen"
          tone="muted"
          iconSize={16}
          onClick={onDismiss}
        />
      </div>
    </output>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Row
// ────────────────────────────────────────────────────────────────────────

function CartRow({
  index,
  line,
  math,
  releasing,
  onRemove,
}: {
  index: number;
  line: CartLine;
  math: LineMath;
  releasing: boolean;
  onRemove: () => void;
}): JSX.Element {
  return (
    <ParchmentCard
      padding="md"
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        gap: 'var(--space-3)',
        alignItems: 'start',
        opacity: releasing ? 0.55 : 1,
        transition: 'opacity var(--w14-dur-short) var(--w14-ease-curator)',
      }}
    >
      <RomanIndex value={index} tone="gold" />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', minWidth: 0 }}>
        <span
          className="w14-tabular"
          style={{
            fontFamily: 'var(--w14-font-mono)',
            fontSize: '0.78rem',
            color: 'var(--w14-ink-faded)',
          }}
        >
          {line.sku}
        </span>
        <span
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1rem',
            lineHeight: 1.25,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={line.name}
        >
          {line.name}
        </span>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 'var(--space-2)',
          }}
        >
          <span
            className="w14-smallcaps"
            style={{
              color: 'var(--w14-ink-faded)',
              fontSize: '0.72rem',
              letterSpacing: '0.08em',
            }}
          >
            {TAX_TREATMENT_LABEL[line.taxTreatmentCode]}
          </span>
          {line.taxTreatmentCode === 'MARGIN_25A' && math.marginCents !== null && (
            <span
              style={{
                color: 'var(--w14-ink-faded)',
                fontFamily: 'var(--w14-font-display)',
                fontStyle: 'italic',
                fontSize: '0.78rem',
              }}
            >
              Marge {fromCents(math.marginCents)} €
            </span>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-1)',
          alignItems: 'flex-end',
        }}
      >
        {math.lineDiscountCents > 0n ? (
          <>
            <span
              className="w14-tabular"
              style={{
                fontFamily: 'var(--w14-font-mono)',
                fontSize: '0.78rem',
                color: 'var(--w14-ink-faded)',
                textDecoration: 'line-through',
              }}
            >
              {line.listPriceEur} €
            </span>
            <MoneyAmount valueEur={fromCents(math.lineTotalCents)} emphasis />
            <span
              style={{
                color: 'var(--w14-wax-red)',
                fontFamily: 'var(--w14-font-display)',
                fontStyle: 'italic',
                fontSize: '0.78rem',
              }}
            >
              Rabatt −{fromCents(math.lineDiscountCents)} €
            </span>
          </>
        ) : (
          <MoneyAmount valueEur={line.listPriceEur} emphasis />
        )}
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
          <DiscountEditor line={line} disabled={releasing} />
          {/* UX icons: universal delete action → icon-only IconButton (aria-label). */}
          <IconButton
            icon={Trash2}
            label={releasing ? 'Wird freigegeben…' : `Position ${index} entfernen`}
            tone="danger"
            iconSize={18}
            onClick={onRemove}
            disabled={releasing}
          />
        </div>
      </div>
    </ParchmentCard>
  );
}

/**
 * DiscountEditor — a per-line Rabatt control. Collapsed it's a "Rabatt"/"Rabatt
 * ändern" link; expanded it offers a EUR-off amount + a mandatory reason. The
 * amount is clamped to the list price by the cart math; an empty/zero amount
 * clears the discount. Reason is required (the backend + DB enforce it).
 */
const PCT_PRESETS = [5, 10, 15, 20] as const;
const REASON_PRESETS = [
  'Mitarbeiterrabatt',
  'Mängelnachlass',
  'Stammkunde',
  'Verhandlung',
] as const;

const CHIP_STYLE: CSSProperties = {
  minHeight: 36,
  padding: '6px 12px',
  border: '1px solid var(--w14-rule)',
  borderRadius: 999,
  background: 'var(--w14-parchment)',
  color: 'var(--w14-ink-aged)',
  fontFamily: 'var(--w14-font-display)',
  fontSize: '0.82rem',
  cursor: 'pointer',
};
const CHIP_ACTIVE: CSSProperties = {
  background: 'var(--w14-accent)',
  color: 'var(--w14-accent-ink)',
  borderColor: 'var(--w14-accent)',
};

const DISCOUNT_INPUT: CSSProperties = {
  padding: '10px 12px',
  border: '1px solid var(--w14-ink-faded)',
  borderRadius: 'var(--w14-radius-button)',
  background: 'var(--w14-parchment)',
  color: 'var(--w14-ink)',
  fontFamily: 'var(--w14-font-body)',
  fontSize: '0.95rem',
};

/** Small icon+label toggle chip (% vs €). */
function ModeChip({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof Percent;
  label: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        ...CHIP_STYLE,
        minHeight: 40,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        ...(active ? CHIP_ACTIVE : null),
      }}
    >
      <Icon icon={icon} size={16} /> {label}
    </button>
  );
}

function DiscountEditor({ line, disabled }: { line: CartLine; disabled: boolean }): JSX.Element {
  const setLineDiscount = useCartStore((s) => s.setLineDiscount);
  const [open, setOpen] = useState<boolean>(false);
  const [mode, setMode] = useState<'pct' | 'eur'>('pct');
  const [pct, setPct] = useState<string>('');
  const [amount, setAmount] = useState<string>(line.discountEur ?? '');
  const [reason, setReason] = useState<string>(line.discountReason ?? '');

  // % is a fast way to set the EUR discount — the stored value stays discountEur
  // (so cart-math + finalize are unchanged); percentToEur does the real math.
  const setPercent = (raw: string): void => {
    setPct(raw);
    const n = Number(normalizeDecimal(raw));
    setAmount(
      Number.isFinite(n) && n > 0 ? fromCents(percentToEur(toCents(line.listPriceEur), n)) : '',
    );
  };

  const amountValid = isMoneyInput(amount);
  const positive = amountValid && Number(normalizeDecimal(amount)) > 0;
  const reasonValid = isDiscountReasonValid(reason);
  const reasonShortfall = discountReasonShortfall(reason);
  const reasonTouched = reason.length > 0;
  const canApply = positive && reasonValid;

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setAmount(line.discountEur ?? '');
          setReason(line.discountReason ?? '');
          setOpen(true);
        }}
        style={{
          background: 'transparent',
          border: 'none',
          color: line.discountEur ? 'var(--w14-wax-red)' : 'var(--w14-gold)',
          fontFamily: 'var(--w14-font-display)',
          fontStyle: 'italic',
          fontSize: '0.78rem',
          cursor: disabled ? 'default' : 'pointer',
          padding: 0,
          textDecoration: 'underline',
          textUnderlineOffset: 2,
        }}
      >
        {line.discountEur ? 'Rabatt ändern' : 'Rabatt'}
      </button>
    );
  }

  // Enlarged for the 21" touchscreen: taller hit area + ≥0.9rem text.
  const inputStyle: CSSProperties = {
    padding: '10px 12px',
    border: '1px solid var(--w14-ink-faded)',
    borderRadius: 'var(--w14-radius-button)',
    background: 'var(--w14-parchment)',
    color: 'var(--w14-ink)',
    fontFamily: 'var(--w14-font-body)',
    fontSize: '0.95rem',
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        alignItems: 'stretch',
        marginTop: 'var(--space-2)',
        padding: 'var(--space-3)',
        border: '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-card)',
        background: 'var(--w14-parchment-2)',
        minWidth: 320,
      }}
    >
      {/* % (default) vs € entry */}
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <ModeChip
          active={mode === 'pct'}
          icon={Percent}
          label="Prozent"
          onClick={() => setMode('pct')}
        />
        <ModeChip active={mode === 'eur'} icon={Tag} label="Euro" onClick={() => setMode('eur')} />
      </div>

      {mode === 'pct' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {PCT_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPercent(String(p))}
                style={{
                  ...CHIP_STYLE,
                  ...(Number(normalizeDecimal(pct)) === p ? CHIP_ACTIVE : null),
                }}
              >
                {p} %
              </button>
            ))}
            <input
              type="text"
              inputMode="decimal"
              value={pct}
              onChange={(e) => setPercent(e.target.value)}
              placeholder="%"
              aria-label="Eigener Prozentsatz"
              style={{
                ...inputStyle,
                width: 72,
                textAlign: 'right',
                fontFamily: 'var(--w14-font-mono)',
              }}
            />
          </div>
          {positive && (
            <span style={{ fontSize: '0.78rem', color: 'var(--w14-ink-faded)' }}>
              Rabatt {amount} € · neuer Preis{' '}
              {fromCents(toCents(line.listPriceEur) - toCents(amount))} €
            </span>
          )}
        </div>
      ) : (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: '0.74rem', color: 'var(--w14-ink-faded)' }}>Rabatt €</span>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0,00"
            style={{
              ...inputStyle,
              flex: 1,
              textAlign: 'right',
              fontFamily: 'var(--w14-font-mono)',
            }}
          />
        </label>
      )}

      {/* Reason preset chips — prefill an EDITABLE, still-required reason. */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {REASON_PRESETS.map((r) => (
          <button key={r} type="button" onClick={() => setReason(r)} style={CHIP_STYLE}>
            {r}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={`Begründung (Pflicht, mind. ${MIN_DISCOUNT_REASON_LEN} Zeichen)`}
          aria-invalid={reasonTouched && !reasonValid}
          style={{
            ...inputStyle,
            border:
              reasonTouched && !reasonValid ? '1px solid var(--w14-wax-red)' : inputStyle.border,
          }}
        />
        {/* Live inline feedback — no more silently-disabled button. */}
        <span
          style={{
            fontSize: '0.78rem',
            color: reasonTouched && !reasonValid ? 'var(--w14-wax-red)' : 'var(--w14-ink-faded)',
          }}
        >
          {reasonValid
            ? 'Begründung ✓'
            : reasonTouched
              ? `Noch ${reasonShortfall} Zeichen (mind. ${MIN_DISCOUNT_REASON_LEN})`
              : `Pflichtfeld — mind. ${MIN_DISCOUNT_REASON_LEN} Zeichen`}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {line.discountEur && (
          <Button
            variant="ghost"
            size="md"
            style={{ minHeight: 48 }}
            onClick={() => {
              setLineDiscount(line.productId, null, '');
              setOpen(false);
            }}
          >
            Entfernen
          </Button>
        )}
        <Button variant="ghost" size="md" style={{ minHeight: 48 }} onClick={() => setOpen(false)}>
          Abbrechen
        </Button>
        <Button
          variant="primary"
          size="md"
          style={{ minHeight: 48 }}
          disabled={!canApply}
          onClick={() => {
            setLineDiscount(line.productId, normalizeDecimal(amount), reason);
            setOpen(false);
          }}
        >
          Übernehmen
        </Button>
      </div>
    </div>
  );
}

/**
 * InvoiceDiscount — a whole-cart Rabatt (UX cashier 2/3 B). A % or € is
 * distributed across the lines (Σ-EXACT, decimal-safe) and LANDS as each line's
 * own `discountEur` via `setLineDiscount` — so the per-line tax math + finalize
 * are entirely unchanged. The reason is required (compliance). Applying it
 * (re)distributes across all lines; "Rabatte entfernen" clears them.
 */
function InvoiceDiscount({ lines }: { lines: readonly CartLine[] }): JSX.Element | null {
  const setLineDiscount = useCartStore((s) => s.setLineDiscount);
  const [open, setOpen] = useState<boolean>(false);
  const [mode, setMode] = useState<'pct' | 'eur'>('pct');
  const [value, setValue] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [confirmingOverwrite, setConfirmingOverwrite] = useState<boolean>(false);

  if (lines.length === 0) return null;

  // A cart-wide Rabatt lands as each line's own discountEur, so applying it
  // REPLACES any existing per-line Rabatt + reason. Detect that up front so we
  // can warn before silently discarding the operator's per-line discounts.
  const hasExistingLineDiscounts = lines.some(
    (l) => l.discountEur !== undefined && Number(l.discountEur) > 0,
  );

  const bases = lines.map((l) => toCents(l.listPriceEur));
  const totalBase = bases.reduce((a, b) => a + b, 0n);
  const valueNum = Number(normalizeDecimal(value));
  const rawTotal =
    mode === 'pct'
      ? percentToEur(totalBase, valueNum)
      : isMoneyInput(value)
        ? toCents(normalizeDecimal(value))
        : 0n;
  const cappedTotal = rawTotal > totalBase ? totalBase : rawTotal;
  const canApply = cappedTotal > 0n && isDiscountReasonValid(reason);

  const apply = (): void => {
    if (!canApply) return;
    // Never discard existing per-line Rabatte silently — require one explicit
    // confirmation first (the button turns into "Ersetzen & übernehmen").
    if (hasExistingLineDiscounts && !confirmingOverwrite) {
      setConfirmingOverwrite(true);
      return;
    }
    const shares = distributeInvoiceDiscount(bases, cappedTotal);
    lines.forEach((l, i) => {
      const s = shares[i] ?? 0n;
      if (s > 0n) setLineDiscount(l.productId, fromCents(s), reason);
      else setLineDiscount(l.productId, null, '');
    });
    setOpen(false);
    setValue('');
    setReason('');
    setConfirmingOverwrite(false);
  };

  const clearAll = (): void => {
    for (const l of lines) setLineDiscount(l.productId, null, '');
  };

  if (!open) {
    return (
      <div
        style={{
          marginTop: 'var(--space-3)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--space-2)',
        }}
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            ...CHIP_STYLE,
            minHeight: 40,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
          }}
        >
          <Icon icon={Percent} size={16} /> Rechnungsrabatt
        </button>
        <button
          type="button"
          onClick={clearAll}
          style={{ ...CHIP_STYLE, minHeight: 40, color: 'var(--w14-wax-red)' }}
        >
          Rabatte entfernen
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        marginTop: 10,
        padding: 12,
        border: '1px solid var(--w14-gold)',
        borderRadius: 'var(--w14-radius-card)',
        background: 'var(--w14-parchment-2)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <strong style={{ fontFamily: 'var(--w14-font-display)', fontSize: '0.95rem' }}>
        Rabatt auf die ganze Rechnung
      </strong>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <ModeChip
          active={mode === 'pct'}
          icon={Percent}
          label="Prozent"
          onClick={() => setMode('pct')}
        />
        <ModeChip active={mode === 'eur'} icon={Tag} label="Euro" onClick={() => setMode('eur')} />
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={mode === 'pct' ? '%' : '€'}
          aria-label={mode === 'pct' ? 'Prozent' : 'Euro'}
          style={{
            ...DISCOUNT_INPUT,
            flex: 1,
            textAlign: 'right',
            fontFamily: 'var(--w14-font-mono)',
          }}
        />
      </div>
      {cappedTotal > 0n && (
        <span style={{ fontSize: '0.78rem', color: 'var(--w14-ink-faded)' }}>
          Verteilter Rabatt: −{fromCents(cappedTotal)} € auf {lines.length} Position
          {lines.length === 1 ? '' : 'en'}
        </span>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {REASON_PRESETS.map((r) => (
          <button key={r} type="button" onClick={() => setReason(r)} style={CHIP_STYLE}>
            {r}
          </button>
        ))}
      </div>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={`Begründung (Pflicht, mind. ${MIN_DISCOUNT_REASON_LEN} Zeichen)`}
        style={DISCOUNT_INPUT}
      />
      {confirmingOverwrite && (
        <span style={{ fontSize: '0.78rem', color: 'var(--w14-wax-red)', fontWeight: 600 }}>
          Bestehende Positions-Rabatte werden durch den Rechnungsrabatt ersetzt.
        </span>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button
          variant="ghost"
          size="md"
          style={{ minHeight: 48 }}
          onClick={() => {
            setOpen(false);
            setConfirmingOverwrite(false);
          }}
        >
          Abbrechen
        </Button>
        <Button
          variant="primary"
          size="md"
          style={{ minHeight: 48 }}
          disabled={!canApply}
          onClick={apply}
        >
          {confirmingOverwrite ? 'Ersetzen & übernehmen' : 'Übernehmen'}
        </Button>
      </div>
    </div>
  );
}

function EmptyCart(): JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        display: 'grid',
        placeItems: 'center',
        textAlign: 'center',
        padding: 'var(--space-6)',
      }}
    >
      <div style={{ maxWidth: 280 }}>
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 56,
            height: 56,
            borderRadius: '50%',
            border: '1px solid var(--w14-rule)',
            background: 'var(--w14-parchment-2)',
            marginBottom: 'var(--space-3)',
          }}
        >
          <Icon icon={Tag} size={24} color="var(--w14-gold)" />
        </span>
        <DiamondRule />
        <p
          style={{
            margin: 'var(--space-3) 0 0',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: '0.92rem',
            lineHeight: 1.5,
          }}
        >
          Wählen Sie ein Stück aus dem Katalog
          <br />
          oder scannen Sie das Etikett.
          <br />
          Es wird sofort für den Beleg reserviert.
        </p>
      </div>
    </div>
  );
}

function TotalRow({
  label,
  value,
  emphasised = false,
}: {
  label: string;
  value: JSX.Element;
  emphasised?: boolean;
}): JSX.Element {
  return (
    <tr>
      <td
        style={{
          padding: 'var(--space-1) 0',
          color: emphasised ? 'var(--w14-ink)' : 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontVariant: 'all-small-caps',
          letterSpacing: '0.08em',
          fontWeight: emphasised ? 600 : 400,
          fontSize: emphasised ? '1.05rem' : '0.82rem',
        }}
      >
        {label}
      </td>
      <td
        style={{
          padding: 'var(--space-1) 0',
          textAlign: 'right',
          fontSize: emphasised ? '1.15rem' : undefined,
          fontWeight: emphasised ? 700 : undefined,
          color: emphasised ? 'var(--w14-ink)' : undefined,
        }}
      >
        {value}
      </td>
    </tr>
  );
}
