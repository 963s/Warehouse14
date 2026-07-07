/**
 * KassenbuchPanel — the Kasse "open shift" sub-view.
 *
 * Reads the shift snapshot + the dashboard summary (for `currentShiftRevenueEur`,
 * which the Werkstatt also surfaces). The expected drawer balance is computed
 * client-side from the opening float + the shift's cash sales — the
 * server's final number lands inside the Z-Bon close. We label the
 * client-side estimate as such so the operator never confuses it with the
 * authoritative Z-Bon result.
 */

import { useMemo, useState } from 'react';

import type { ShiftView } from '@warehouse14/api-client';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Button,
  DiamondRule,
  Icon,
  MoneyAmount,
  ParchmentCard,
} from '@warehouse14/ui-kit';

import { useDashboardSummary } from '../../hooks/useDashboardSummary.js';
import { useReceiptPrinter } from '../../hooks/useReceiptPrinter.js';
import { RECEIPT_VAT_LOCK_REASON } from '../../lib/shop-info.js';
import { useLastReceiptStore } from '../../state/last-receipt-store.js';

import { ReceiptPreview } from '../verkauf/ReceiptPreview.js';

import { CashMovementDialog, type MovementKind } from './CashMovementDialog.js';
import { RecentSalesPanel } from './RecentSalesPanel.js';
import { ZBonDialog } from './ZBonDialog.js';

export interface KassenbuchPanelProps {
  shift: ShiftView;
}

function openedAtLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  });
}

export function KassenbuchPanel({ shift }: KassenbuchPanelProps): JSX.Element {
  const { data: dashboard } = useDashboardSummary();
  const [cashKind, setCashKind] = useState<MovementKind | null>(null);
  const [zbonOpen, setZbonOpen] = useState<boolean>(false);
  const [reprintOpen, setReprintOpen] = useState<boolean>(false);
  const lastReceipt = useLastReceiptStore((s) => s.lastReceipt);
  const { canPrint, printing, print } = useReceiptPrinter();

  // Live revenue from dashboard summary (sums VERKAUF on this shift via the
  // SQL aggregator). It refreshes whenever the SSE bridge invalidates the
  // dashboard query.
  const cashRevenueEur = dashboard?.currentShiftRevenueEur ?? '0.00';

  const estimatedExpectedEur = useMemo(
    () => addEur(shift.openingFloatEur, cashRevenueEur),
    [shift.openingFloatEur, cashRevenueEur],
  );

  return (
    <div
      style={{
        flex: 1,
        display: 'grid',
        placeItems: 'start center',
        padding: 'var(--space-7)',
      }}
    >
      <div style={{ width: 'min(680px, 100%)' }}>
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 'var(--space-5)',
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                fontFamily: 'var(--w14-font-display)',
                fontWeight: 500,
                fontSize: '1.8rem',
              }}
            >
              Kassentag
            </h1>
            <p
              style={{
                margin: 0,
                color: 'var(--w14-ink-faded)',
                fontFamily: 'var(--w14-font-display)',
                fontStyle: 'italic',
                fontSize: '0.9rem',
              }}
            >
              Schicht <span className="w14-tabular">{shift.id.slice(0, 8)}…</span>
              {' · seit '}
              {openedAtLabel(shift.openedAt)}
            </p>
          </div>
          <span
            className="w14-smallcaps"
            style={{
              color: 'var(--w14-gold)',
              fontSize: '0.82rem',
              padding: 'var(--space-1) var(--space-3)',
              border: '1px solid var(--w14-gold)',
              borderRadius: 'var(--w14-radius-button)',
            }}
          >
            Schicht OPEN
          </span>
        </header>

        <ParchmentCard padding="lg">
          <DiamondRule label="Erwarteter Kassenbestand" />
          <table
            className="w14-tabular"
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontFamily: 'var(--w14-font-mono)',
            }}
          >
            <tbody>
              <Row
                label="Startgeld (Tagesbeginn)"
                value={<MoneyAmount valueEur={shift.openingFloatEur} />}
              />
              <Row
                label="+ Bareinnahmen (aus Verkauf)"
                value={<MoneyAmount valueEur={cashRevenueEur} />}
              />
              <RowSeparator />
              <Row
                label="= Erwarteter Kassenbestand"
                value={<MoneyAmount valueEur={estimatedExpectedEur} emphasis />}
                emphasised
              />
            </tbody>
          </table>
          <p
            style={{
              margin: 'var(--space-3) 0 0',
              color: 'var(--w14-ink-aged)',
              fontFamily: 'var(--w14-font-body)',
              fontSize: '0.84rem',
              lineHeight: 1.4,
            }}
          >
            Jeder Barverkauf aus <strong style={{ color: 'var(--w14-ink)' }}>Verkauf</strong> landet
            automatisch hier.
          </p>
          <p
            style={{
              margin: 'var(--space-1) 0 0',
              color: 'var(--w14-ink-faded)',
              fontFamily: 'var(--w14-font-display)',
              fontStyle: 'italic',
              fontSize: '0.78rem',
            }}
          >
            Geschätzt — Einlagen und Entnahmen werden im Z-Bon endgültig verrechnet.
          </p>
        </ParchmentCard>

        {/* The Kassenbuch in plain language: today's money in / out (UX §4.3 D). */}
        <DiamondRule label="Heute · Ein- und Auszahlungen" />

        <div
          style={{
            marginTop: 'var(--space-1)',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 'var(--space-3)',
          }}
        >
          <Button
            variant="ghost"
            size="lg"
            iconLeft={<Icon icon={ArrowDownToLine} size={18} />}
            onClick={() => setCashKind('einlage')}
            style={{ border: '1px solid var(--w14-rule)' }}
          >
            Einlage (Geld rein)
          </Button>
          <Button
            variant="ghost"
            size="lg"
            iconLeft={<Icon icon={ArrowUpFromLine} size={18} />}
            onClick={() => setCashKind('entnahme')}
            style={{ border: '1px solid var(--w14-rule)' }}
          >
            Entnahme (Geld raus)
          </Button>
        </div>

        <div style={{ marginTop: 'var(--space-3)', display: 'flex', justifyContent: 'center' }}>
          <Button
            variant="ghost"
            size="md"
            onClick={() => setReprintOpen(true)}
            disabled={lastReceipt === null}
          >
            Letzten Beleg erneut drucken
          </Button>
        </div>

        <RecentSalesPanel />

        <DiamondRule label="Tagesabschluss" />

        <ParchmentCard padding="md">
          <p
            style={{
              margin: 0,
              fontFamily: 'var(--w14-font-display)',
              fontStyle: 'italic',
              color: 'var(--w14-ink-faded)',
              textAlign: 'center',
            }}
          >
            Der Z-Bon ist der gesetzliche Tagesabschluss (KassenSichV) — er schließt die Schicht
            endgültig. PIN-Bestätigung erforderlich.
          </p>
          <div
            style={{
              marginTop: 'var(--space-4)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 'var(--space-1)',
            }}
          >
            <Button variant="destructive" size="lg" onClick={() => setZbonOpen(true)}>
              Tag abschließen
            </Button>
            <span
              className="w14-smallcaps"
              style={{
                color: 'var(--w14-ink-faded)',
                fontSize: '0.74rem',
                letterSpacing: '0.08em',
              }}
            >
              Tagesabschluss · Z-Bon
            </span>
          </div>
        </ParchmentCard>
      </div>

      <CashMovementDialog
        open={cashKind !== null}
        kind={cashKind ?? 'einlage'}
        shiftId={shift.id}
        onClose={() => setCashKind(null)}
      />
      <ZBonDialog open={zbonOpen} shiftId={shift.id} onClose={() => setZbonOpen(false)} />

      {reprintOpen && lastReceipt && (
        <ReceiptPreview
          data={lastReceipt}
          printing={printing}
          canPrint={canPrint}
          // Phase 7.2 lock also guards the REPRINT: a stored receipt whose
          // USt-IdNr. is blank must never be re-printed with a fake or empty VAT
          // id (GoBD/§14 UStG). Same rule + same wording as the first-sale path.
          lockedReason={lastReceipt.shopVatId.trim() ? null : RECEIPT_VAT_LOCK_REASON}
          onPrint={() => {
            void print(lastReceipt).then((ok) => {
              if (ok) setReprintOpen(false);
            });
          }}
          onClose={() => setReprintOpen(false)}
        />
      )}
    </div>
  );
}

function Row({
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
          padding: 'var(--space-3) 0',
          color: emphasised ? 'var(--w14-ink-aged)' : 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontVariant: 'all-small-caps',
          letterSpacing: '0.08em',
          fontSize: emphasised ? '0.95rem' : '0.85rem',
        }}
      >
        {label}
      </td>
      <td
        style={{
          padding: 'var(--space-3) 0',
          textAlign: 'right',
        }}
      >
        {value}
      </td>
    </tr>
  );
}

function RowSeparator(): JSX.Element {
  return (
    <tr>
      <td colSpan={2} style={{ padding: 0 }}>
        <div
          style={{
            height: 1,
            background: 'var(--w14-rule)',
            opacity: 0.55,
            margin: '4px 0',
          }}
        />
      </td>
    </tr>
  );
}

/** Add two decimal EUR strings without float drift. */
function addEur(a: string, b: string): string {
  const toCents = (s: string): bigint => {
    const [whole = '0', frac = ''] = s.split('.');
    return BigInt(whole) * 100n + BigInt(`${frac}00`.slice(0, 2) || '0');
  };
  const total = toCents(a) + toCents(b);
  return `${total / 100n}.${String(total % 100n).padStart(2, '0')}`;
}
