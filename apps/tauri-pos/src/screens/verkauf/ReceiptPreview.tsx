/**
 * ReceiptPreview — the floating receipt preview that pops up after a sale, so
 * the operator SEES the Kassenbon before it goes to the thermal printer.
 *
 * Renders the exact `ThermalReceiptData` the printer will receive, styled like
 * thermal paper (narrow, monospace, ink on near-white) with the engraved shop
 * seal at the top. "Drucken" sends it to the printer; "Schließen" dismisses
 * without printing (the sale is already finalized — the receipt can be
 * re-printed later).
 *
 * The TSE QR is shown as a labelled placeholder here: the legally-binding QR is
 * rendered by the Rust ESC/POS layer on the actual paper (no QR dependency in
 * the POS bundle).
 */

import { Button } from '@warehouse14/ui-kit';

import type { ThermalReceiptData } from '../../lib/hardware-client.js';

const PAPER = '#fbf8f1';
const INK = '#1c1814';
const FADED = '#6b6354';

const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  fontFamily: 'var(--w14-font-mono, monospace)',
  fontSize: '0.8rem',
  color: INK,
};

function Rule(): JSX.Element {
  return (
    <div
      aria-hidden="true"
      style={{ borderTop: '1px dashed #b9ad97', margin: '8px 0', height: 0 }}
    />
  );
}

export function ReceiptPreview({
  data,
  onPrint,
  onClose,
  printing,
  canPrint,
}: {
  data: ThermalReceiptData;
  onPrint: () => void;
  onClose: () => void;
  printing: boolean;
  canPrint: boolean;
}): JSX.Element {
  return (
    // biome-ignore lint/a11y/useSemanticElements: backdrop-overlay modal; a native <dialog> needs imperative showModal()/focus-trap wiring beyond this scope.
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click dismisses; the dialog has explicit buttons + the parent handles Esc.
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Belegvorschau"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--w14-overlay)',
        zIndex: 1200,
        display: 'grid',
        placeItems: 'center',
        padding: 20,
      }}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: non-interactive content guard — stops backdrop-dismiss from firing when clicking the receipt; keyboard dismiss is handled by the parent dialog. */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          alignItems: 'center',
          maxHeight: '92vh',
        }}
      >
        {/* The paper */}
        <div
          style={{
            width: 340,
            maxHeight: '74vh',
            overflowY: 'auto',
            background: PAPER,
            color: INK,
            borderRadius: 6,
            boxShadow: 'var(--w14-shadow-modal, 0 12px 40px rgba(0,0,0,0.45))',
            padding: '22px 20px 26px',
          }}
        >
          {/* Engraved shop logo + identity */}
          <div style={{ display: 'grid', placeItems: 'center', gap: 6, textAlign: 'center' }}>
            <img
              src="/shop-logo.svg"
              alt={data.shopName}
              style={{ width: 240, maxWidth: '100%', height: 'auto', marginBottom: 4 }}
            />
            <div style={{ fontFamily: 'var(--w14-font-mono, monospace)', fontSize: '0.74rem' }}>
              {data.shopAddress.map((line) => (
                <div key={line}>{line}</div>
              ))}
              {data.shopPhone && <div>Tel.: {data.shopPhone}</div>}
              <div>USt-IdNr.: {data.shopVatId}</div>
            </div>
          </div>

          <Rule />

          {/* Meta */}
          <div style={{ display: 'grid', gap: 2 }}>
            <div style={rowStyle}>
              <span>Beleg-Nr.</span>
              <span>{data.receiptLocator}</span>
            </div>
            <div style={rowStyle}>
              <span>Datum</span>
              <span>{data.printedAt}</span>
            </div>
            <div style={rowStyle}>
              <span>Kassierer</span>
              <span>{data.cashierName}</span>
            </div>
          </div>

          <Rule />

          {/* Items */}
          <div style={{ display: 'grid', gap: 6 }}>
            {data.items.map((it, i) => (
              <div key={`${it.name}-${i}`} style={{ display: 'grid', gap: 1 }}>
                <div style={{ ...rowStyle, fontSize: '0.82rem' }}>
                  <span style={{ maxWidth: 200 }}>
                    {it.quantity} × {it.name}
                  </span>
                  <span>{it.lineTotalEur} €</span>
                </div>
                {it.vatLabel && (
                  <div
                    style={{
                      fontFamily: 'var(--w14-font-mono, monospace)',
                      fontSize: '0.68rem',
                      color: FADED,
                    }}
                  >
                    USt {it.vatLabel}
                  </div>
                )}
              </div>
            ))}
          </div>

          <Rule />

          {/* Totals */}
          <div style={{ display: 'grid', gap: 2 }}>
            <div style={rowStyle}>
              <span>Zwischensumme</span>
              <span>{data.subtotalEur} €</span>
            </div>
            <div style={rowStyle}>
              <span>MwSt.</span>
              <span>{data.vatEur} €</span>
            </div>
            <div style={{ ...rowStyle, fontWeight: 700, fontSize: '0.95rem' }}>
              <span>SUMME</span>
              <span>{data.totalEur} €</span>
            </div>
          </div>

          <Rule />

          {/* Payment */}
          <div style={{ display: 'grid', gap: 2 }}>
            <div style={rowStyle}>
              <span>Zahlung</span>
              <span>{data.paymentMethodLabel}</span>
            </div>
            {data.cashReceivedEur && (
              <div style={rowStyle}>
                <span>Bar erhalten</span>
                <span>{data.cashReceivedEur} €</span>
              </div>
            )}
            {data.changeEur && (
              <div style={rowStyle}>
                <span>Wechselgeld</span>
                <span>{data.changeEur} €</span>
              </div>
            )}
          </div>

          <Rule />

          {/* TSE block */}
          <div
            style={{
              display: 'grid',
              gap: 3,
              fontFamily: 'var(--w14-font-mono, monospace)',
              fontSize: '0.66rem',
              color: INK,
            }}
          >
            <div style={{ color: FADED, letterSpacing: '0.08em' }}>TSE-SIGNATUR</div>
            <div style={{ wordBreak: 'break-all' }}>{data.tseSignatureValue}</div>
            <div>Signatur-Zähler: {data.tseSignatureCounter}</div>
            <div>Trans-Nr.: {data.tseTransactionNumber}</div>
            <div
              aria-label="TSE QR-Code (wird gedruckt)"
              style={{
                marginTop: 6,
                alignSelf: 'center',
                width: 96,
                height: 96,
                display: 'grid',
                placeItems: 'center',
                textAlign: 'center',
                border: '1px solid #b9ad97',
                borderRadius: 4,
                color: FADED,
                fontSize: '0.6rem',
                padding: 6,
              }}
            >
              QR-Code
              <br />
              (wird gedruckt)
            </div>
          </div>

          <Rule />

          {/* Footer */}
          <div style={{ display: 'grid', gap: 3, textAlign: 'center' }}>
            {data.footerLines.map((line) => (
              <div
                key={line}
                style={{
                  fontFamily: 'var(--w14-font-mono, monospace)',
                  fontSize: '0.68rem',
                  color: FADED,
                }}
              >
                {line}
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Button variant="ghost" size="md" onClick={onClose} disabled={printing}>
            Schließen
          </Button>
          <Button variant="primary" size="md" onClick={onPrint} disabled={printing || !canPrint}>
            {printing ? 'Druckt…' : 'Drucken'}
          </Button>
        </div>
        {!canPrint && (
          <div style={{ color: 'var(--w14-parchment-1)', fontSize: '0.78rem', opacity: 0.85 }}>
            Drucker nicht konfiguriert — Vorschau ohne Druck. (Geräte einrichten)
          </div>
        )}
      </div>
    </div>
  );
}
