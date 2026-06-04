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
 * State preservation: lines + totals live in Zustand; switching to Werkstatt
 * and back rehydrates the panel without re-fetching. The cart only clears on
 * (a) finalize-success, (b) explicit "Karte leeren", or (c) sign-out cascade.
 */

import { type CSSProperties, useMemo, useState } from 'react';

import { Button, DiamondRule, MoneyAmount, ParchmentCard, RomanIndex } from '@warehouse14/ui-kit';

import { type LineMath, computeLineMath, fromCents, sumHeader } from '../../lib/cart-math.js';
import { isMoneyInput, normalizeDecimal } from '../../lib/decimal.js';
import { TAX_TREATMENT_LABEL } from '../../lib/tax-treatment-label.js';
import { type CartLine, useCartStore } from '../../state/cart-store.js';

import { BezahlenDialog } from './BezahlenDialog.js';

export interface CartPanelProps {
  lines: readonly CartLine[];
  /** Triggered by per-row × button. Parent handles release. */
  onRemoveLine: (productId: string) => void;
  /** Set of productIds currently being released (disable row click). */
  releasingProductIds: ReadonlySet<string>;
  /** Wipe-all action — invokes inventory release for every line in parallel. */
  onClearCart: () => void;
  /** True if a clear-cart batch is in progress. */
  clearingCart: boolean;
}

export function CartPanel({
  lines,
  onRemoveLine,
  releasingProductIds,
  onClearCart,
  clearingCart,
}: CartPanelProps): JSX.Element {
  const [bezahlenOpen, setBezahlenOpen] = useState<boolean>(false);

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
        padding: 16,
        gap: 14,
        borderLeft: '1px solid var(--w14-rule)',
        background: 'var(--w14-parchment-1)',
      }}
    >
      {/* Header */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1.4rem',
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
      </header>

      {/* Line list */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
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
              onRemove={() => onRemoveLine(line.productId)}
            />
          ))
        )}
      </div>

      {/* Footer — totals + actions */}
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
                    margin: '6px 0',
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

        <div
          style={{
            marginTop: 14,
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: 10,
          }}
        >
          <Button
            variant="ghost"
            size="md"
            onClick={onClearCart}
            disabled={lines.length === 0 || clearingCart}
          >
            {clearingCart ? 'Räumt…' : 'Karte leeren'}
          </Button>
          <Button
            variant="primary"
            size="lg"
            onClick={() => setBezahlenOpen(true)}
            disabled={!canPay}
          >
            Bezahlen
          </Button>
        </div>
      </ParchmentCard>

      <BezahlenDialog
        open={bezahlenOpen}
        onClose={() => setBezahlenOpen(false)}
        lines={lines}
        perLineMath={perLine.map((p) => p.math)}
        totals={header}
      />
    </section>
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
        gap: 12,
        alignItems: 'start',
        opacity: releasing ? 0.55 : 1,
      }}
    >
      <RomanIndex value={index} tone="gold" />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
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
            gap: 8,
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
          gap: 4,
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
        <div style={{ display: 'flex', gap: 10 }}>
          <DiscountEditor line={line} disabled={releasing} />
          <button
            type="button"
            onClick={onRemove}
            disabled={releasing}
            aria-label={`Position ${index} entfernen`}
            title="Entfernen"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--w14-ink-faded)',
              fontFamily: 'var(--w14-font-display)',
              fontStyle: 'italic',
              fontSize: '0.78rem',
              cursor: releasing ? 'default' : 'pointer',
              padding: 0,
              textDecoration: 'underline',
              textUnderlineOffset: 2,
            }}
          >
            {releasing ? 'gibt frei…' : 'entfernen'}
          </button>
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
function DiscountEditor({ line, disabled }: { line: CartLine; disabled: boolean }): JSX.Element {
  const setLineDiscount = useCartStore((s) => s.setLineDiscount);
  const [open, setOpen] = useState<boolean>(false);
  const [amount, setAmount] = useState<string>(line.discountEur ?? '');
  const [reason, setReason] = useState<string>(line.discountReason ?? '');

  const amountValid = isMoneyInput(amount);
  const positive = amountValid && Number(normalizeDecimal(amount)) > 0;
  const reasonValid = reason.trim().length >= 3;
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

  const inputStyle: CSSProperties = {
    padding: '5px 8px',
    border: '1px solid var(--w14-ink-faded)',
    borderRadius: 'var(--w14-radius-button)',
    background: 'var(--w14-parchment)',
    color: 'var(--w14-ink)',
    fontFamily: 'var(--w14-font-body)',
    fontSize: '0.82rem',
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        alignItems: 'stretch',
        marginTop: 6,
        padding: 8,
        border: '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-card)',
        background: 'var(--w14-parchment-2)',
        minWidth: 200,
      }}
    >
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: '0.74rem', color: 'var(--w14-ink-faded)' }}>Rabatt €</span>
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0,00"
          style={{ ...inputStyle, flex: 1, textAlign: 'right', fontFamily: 'var(--w14-font-mono)' }}
        />
      </label>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Begründung (Pflicht)"
        style={inputStyle}
      />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {line.discountEur && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setLineDiscount(line.productId, null, '');
              setOpen(false);
            }}
          >
            Entfernen
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Abbrechen
        </Button>
        <Button
          variant="primary"
          size="sm"
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

function EmptyCart(): JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        display: 'grid',
        placeItems: 'center',
        textAlign: 'center',
        padding: 24,
      }}
    >
      <div>
        <DiamondRule />
        <p
          style={{
            margin: '8px 0 0',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: '0.92rem',
          }}
        >
          Wählen Sie ein Stück aus dem Katalog.
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
          padding: '6px 0',
          color: emphasised ? 'var(--w14-ink-aged)' : 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontVariant: 'all-small-caps',
          letterSpacing: '0.08em',
          fontSize: emphasised ? '0.95rem' : '0.82rem',
        }}
      >
        {label}
      </td>
      <td style={{ padding: '6px 0', textAlign: 'right' }}>{value}</td>
    </tr>
  );
}
