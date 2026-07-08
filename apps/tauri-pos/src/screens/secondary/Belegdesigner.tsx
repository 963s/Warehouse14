/**
 * Belegdesigner — the live receipt designer (Einstellungen → Beleg & Shop).
 *
 * Left:  an editor for the shop identity (name, tagline, address, USt-IdNr,
 *        phone) + a free list of footer lines (greeting, notes, symbols,
 *        opening hours, promo codes …).
 * Right: a LIVE thermal-paper preview with the engraved logo and sample
 *        products — every keystroke updates it instantly, exactly as it will
 *        print.
 *
 * Persistence (no server change — uses the existing allow-listed endpoints):
 *   • Identity  → PATCH /api/settings/shop.*   (ADMIN + step-up, auto modal)
 *   • Footer    → POST  /api/belegtext-templates (kind GENERIC_FOOTER)
 *
 * The printed sale receipt (BezahlenDialog) reads the same GENERIC_FOOTER and
 * prepends the tagline to the address block, so what you design here is what
 * the customer actually gets.
 *
 * "Testdruck" sends a clearly-marked sample to the thermal printer.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { ApiError, belegtextApi } from '@warehouse14/api-client';
import { Button, DiamondRule } from '@warehouse14/ui-kit';

import { useReceiptPrinter } from '../../hooks/useReceiptPrinter.js';
import { resolveShopInfo, shopInfoQueryKey, useShopInfo } from '../../hooks/useShopInfo.js';
import { useApiClient } from '../../lib/api-context.js';
import type { ThermalReceiptData } from '../../lib/hardware-client.js';
import { SHOP_INFO } from '../../lib/shop-info.js';
import { useToastStore } from '../../state/toast-store.js';
import { describeError } from '@warehouse14/i18n-de';

// Physical thermal-paper cream — kept as a literal (not a theme token) so the
// printed-preview stays paper-white regardless of light/dark. Aligned to the
// parchment-2 cream (#faf8f2) so it no longer drifts off the palette.
const PAPER = '#faf8f2';
const INK = '#1c1814';
const FADED = '#6b6354';

const DEFAULT_FOOTER = ['Vielen Dank für Ihren Besuch.', 'Beleg auf Wunsch elektronisch.'];

// Sample basket shown in the preview + test print.
const SAMPLE_ITEMS = [
  { q: 1, name: 'Krügerrand 1 oz', total: '2.150,00' },
  { q: 1, name: 'Antike Taschenuhr', total: '480,00' },
  { q: 1, name: 'Silbermünze 1 oz', total: '34,50' },
];
const SAMPLE_SUBTOTAL = '2.664,50';
const SAMPLE_TOTAL = '2.664,50';
const SAMPLE_CASH = '2.700,00';
const SAMPLE_CHANGE = '35,50';

interface Identity {
  name: string;
  tagline: string;
  addressLine1: string;
  addressLine2: string;
  vatId: string;
  phone: string;
}
interface FooterLine {
  id: number;
  text: string;
}

// Setting key for each identity field (matches the server allow-list).
const KEY_OF: Record<keyof Identity, string> = {
  name: 'shop.name',
  tagline: 'shop.tagline',
  addressLine1: 'shop.address_line1',
  addressLine2: 'shop.address_line2',
  vatId: 'shop.vat_id',
  phone: 'shop.phone',
};

const QUICK_CHIPS: { label: string; line: string }[] = [
  { label: '★ Dankestext', line: 'Vielen Dank für Ihren Besuch.' },
  { label: 'Öffnungszeiten', line: 'Mo bis Fr 10 bis 18 Uhr · Sa 10 bis 14 Uhr' },
  { label: 'Rückgaberecht', line: 'Umtausch innerhalb 14 Tagen mit Beleg.' },
  { label: 'Web/Social', line: 'www.warehouse14.de · @warehouse14' },
  { label: 'Aktionscode', line: 'Aktion: 5% mit Code GOLD5' },
  { label: 'Beleg-Hinweis', line: 'Beleg auf Wunsch elektronisch.' },
];

export function Belegdesigner(): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const printer = useReceiptPrinter();

  const { data: shopApi } = useShopInfo();
  const footerQ = useQuery({
    queryKey: ['belegtext', 'current', 'GENERIC_FOOTER'],
    queryFn: () => belegtextApi.current(api, { kind: 'GENERIC_FOOTER' }),
    staleTime: 30_000,
  });

  const idCounter = useRef(1);
  const [identity, setIdentity] = useState<Identity>(() => ({
    name: SHOP_INFO.name,
    tagline: SHOP_INFO.tagline,
    addressLine1: SHOP_INFO.address[0] ?? '',
    addressLine2: SHOP_INFO.address[1] ?? '',
    vatId: SHOP_INFO.vatId,
    phone: SHOP_INFO.phone ?? '',
  }));
  const [footer, setFooter] = useState<FooterLine[]>([]);
  const [baseIdentity, setBaseIdentity] = useState<Identity | null>(null);
  const [baseFooter, setBaseFooter] = useState<string>('');

  // Seed the draft once the live values resolve.
  useEffect(() => {
    if (!shopApi) return;
    const resolved = resolveShopInfo(shopApi);
    const next: Identity = {
      name: resolved.name,
      tagline: resolved.tagline,
      addressLine1: shopApi.addressLine1 || resolved.address[0] || '',
      addressLine2: shopApi.addressLine2 || resolved.address[1] || '',
      vatId: resolved.vatId,
      phone: resolved.phone ?? '',
    };
    setIdentity(next);
    setBaseIdentity(next);
  }, [shopApi]);

  useEffect(() => {
    if (footerQ.data === undefined) return;
    const body = footerQ.data.bodyText ?? '';
    const lines = body.length > 0 ? body.split('\n') : DEFAULT_FOOTER;
    setFooter(lines.map((text) => ({ id: idCounter.current++, text })));
    setBaseFooter(lines.join('\n'));
  }, [footerQ.data]);

  const footerLines = footer.map((f) => f.text).filter((t) => t.trim().length > 0);
  const dirtyIdentity =
    baseIdentity !== null &&
    (Object.keys(KEY_OF) as (keyof Identity)[]).some(
      (k) => identity[k].trim() !== baseIdentity[k].trim(),
    );
  const dirtyFooter = footer.map((f) => f.text).join('\n') !== baseFooter;
  const dirty = dirtyIdentity || dirtyFooter;

  const save = useMutation({
    mutationFn: async () => {
      // 1) identity — PATCH only changed keys (first call triggers the step-up
      //    modal; the elevated session covers the rest of the burst).
      if (baseIdentity) {
        for (const k of Object.keys(KEY_OF) as (keyof Identity)[]) {
          if (identity[k].trim() !== baseIdentity[k].trim()) {
            await api.request('PATCH', `/api/settings/${KEY_OF[k]}`, { value: identity[k].trim() });
          }
        }
      }
      // 2) footer — publish a new GENERIC_FOOTER version when changed.
      if (dirtyFooter) {
        await belegtextApi.publish(api, {
          kind: 'GENERIC_FOOTER',
          bodyText: footer.map((f) => f.text).join('\n'),
        });
      }
    },
    onSuccess: async () => {
      addToast({
        tone: 'success',
        title: 'Beleg gespeichert',
        body: 'Übernommen für neue Belege.',
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: shopInfoQueryKey }),
        qc.invalidateQueries({ queryKey: ['belegtext'] }),
      ]);
    },
    onError: (err: unknown) => {
      addToast({
        tone: 'alert',
        title: 'Speichern fehlgeschlagen',
        body: err instanceof ApiError ? describeError(err) : 'Bitte erneut versuchen.',
      });
    },
  });

  const onTestPrint = async (): Promise<void> => {
    const data = buildSampleReceipt(identity, footerLines);
    const ok = await printer.print(data);
    if (ok) addToast({ tone: 'success', title: 'Testdruck gesendet' });
  };

  const reset = (): void => {
    if (baseIdentity) setIdentity(baseIdentity);
    const lines = baseFooter.length > 0 ? baseFooter.split('\n') : DEFAULT_FOOTER;
    setFooter(lines.map((text) => ({ id: idCounter.current++, text })));
  };

  // ── footer line ops ───────────────────────────────────────────────────────
  const setLine = (id: number, text: string): void =>
    setFooter((f) => f.map((l) => (l.id === id ? { ...l, text } : l)));
  const removeLine = (id: number): void => setFooter((f) => f.filter((l) => l.id !== id));
  const addLine = (text = ''): void => setFooter((f) => [...f, { id: idCounter.current++, text }]);
  const moveLine = (id: number, dir: -1 | 1): void =>
    setFooter((f) => {
      const i = f.findIndex((l) => l.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= f.length) return f;
      const copy = [...f];
      const a = copy[i];
      const b = copy[j];
      if (!a || !b) return f;
      copy[i] = b;
      copy[j] = a;
      return copy;
    });

  return (
    <div>
      <header style={{ marginBottom: 6 }}>
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1.3rem',
          }}
        >
          Beleg gestalten
        </h2>
        <p style={{ margin: '4px 0 0', color: 'var(--w14-ink-faded)', fontSize: '0.86rem' }}>
          Geschäftsdaten und Fußzeile bearbeiten. Die Vorschau rechts druckt genau so.
        </p>
      </header>
      <DiamondRule />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(320px, 360px)',
          gap: 24,
          alignItems: 'start',
          marginTop: 12,
        }}
      >
        {/* ── Editor ───────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
          <fieldset style={fieldsetStyle}>
            <legend style={legendStyle}>Geschäftsdaten</legend>
            <Field
              label="Geschäftsname"
              value={identity.name}
              onChange={(v) => setIdentity((s) => ({ ...s, name: v }))}
            />
            <Field
              label="Slogan / Linie"
              value={identity.tagline}
              onChange={(v) => setIdentity((s) => ({ ...s, tagline: v }))}
            />
            <Field
              label="Adresse (Straße)"
              value={identity.addressLine1}
              onChange={(v) => setIdentity((s) => ({ ...s, addressLine1: v }))}
            />
            <Field
              label="Adresse (PLZ Ort)"
              value={identity.addressLine2}
              onChange={(v) => setIdentity((s) => ({ ...s, addressLine2: v }))}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field
                label="USt-IdNr."
                mono
                value={identity.vatId}
                onChange={(v) => setIdentity((s) => ({ ...s, vatId: v }))}
              />
              <Field
                label="Telefon"
                mono
                value={identity.phone}
                onChange={(v) => setIdentity((s) => ({ ...s, phone: v }))}
              />
            </div>
          </fieldset>

          <fieldset style={fieldsetStyle}>
            <legend style={legendStyle}>Fußzeile · Hinweise & Symbole</legend>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {footer.map((line, i) => (
                <div key={line.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    value={line.text}
                    onChange={(e) => setLine(line.id, e.target.value)}
                    placeholder="Freier Text, Hinweis oder Symbol…"
                    maxLength={120}
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <IconBtn
                    label="nach oben"
                    disabled={i === 0}
                    onClick={() => moveLine(line.id, -1)}
                  >
                    ↑
                  </IconBtn>
                  <IconBtn
                    label="nach unten"
                    disabled={i === footer.length - 1}
                    onClick={() => moveLine(line.id, 1)}
                  >
                    ↓
                  </IconBtn>
                  <IconBtn label="entfernen" onClick={() => removeLine(line.id)}>
                    ✕
                  </IconBtn>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => addLine()} style={addLineStyle}>
              + Zeile hinzufügen
            </button>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              {QUICK_CHIPS.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => addLine(c.line)}
                  style={chipStyle}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button
              variant="primary"
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? 'Speichert…' : 'Speichern'}
            </Button>
            <Button variant="ghost" disabled={!dirty || save.isPending} onClick={reset}>
              Verwerfen
            </Button>
            <Button variant="ghost" disabled={printer.printing} onClick={onTestPrint}>
              {printer.printing ? 'Druckt…' : 'Testdruck'}
            </Button>
            <span
              className="w14-smallcaps"
              style={{
                marginLeft: 'auto',
                fontSize: '0.74rem',
                letterSpacing: '0.06em',
                color: dirty ? 'var(--w14-gold)' : 'var(--w14-ink-faded)',
              }}
            >
              {dirty ? 'ungespeichert' : 'gespeichert'}
            </span>
          </div>
          {!printer.canPrint && (
            <p
              style={{
                margin: 0,
                fontSize: '0.76rem',
                color: 'var(--w14-ink-faded)',
                fontStyle: 'italic',
              }}
            >
              Testdruck benötigt einen eingerichteten Drucker (Einstellungen → Geräte).
            </p>
          )}
        </div>

        {/* ── Live preview ─────────────────────────────────────────────── */}
        <div style={{ position: 'sticky', top: 12 }}>
          <div
            className="w14-smallcaps"
            style={{
              fontSize: '0.72rem',
              letterSpacing: '0.1em',
              color: 'var(--w14-ink-faded)',
              marginBottom: 8,
              textAlign: 'center',
            }}
          >
            Live-Vorschau
          </div>
          <ReceiptPaper identity={identity} footerLines={footerLines} />
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Live thermal-paper preview
// ════════════════════════════════════════════════════════════════════════

const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  fontFamily: 'var(--w14-font-mono, monospace)',
  fontSize: '0.78rem',
  color: INK,
};

function PaperRule(): JSX.Element {
  return (
    <div aria-hidden style={{ borderTop: '1px dashed #b9ad97', margin: '8px 0', height: 0 }} />
  );
}

function ReceiptPaper({
  identity,
  footerLines,
}: {
  identity: Identity;
  footerLines: string[];
}): JSX.Element {
  const addr = [identity.addressLine1, identity.addressLine2].filter((l) => l.trim().length > 0);
  return (
    <div
      style={{
        width: '100%',
        maxWidth: 360,
        margin: '0 auto',
        maxHeight: '74vh',
        overflowY: 'auto',
        background: PAPER,
        color: INK,
        borderRadius: 6,
        boxShadow: 'var(--w14-shadow-modal, 0 12px 40px rgba(0,0,0,0.25))',
        padding: '22px 20px 26px',
      }}
    >
      <div style={{ display: 'grid', placeItems: 'center', gap: 5, textAlign: 'center' }}>
        <img
          src="/shop-logo.svg"
          alt={identity.name}
          style={{ width: 220, maxWidth: '100%', height: 'auto', marginBottom: 2 }}
        />
        {identity.tagline.trim() && (
          <div
            style={{
              fontFamily: 'var(--w14-font-mono, monospace)',
              fontSize: '0.7rem',
              color: FADED,
            }}
          >
            {identity.tagline}
          </div>
        )}
        <div style={{ fontFamily: 'var(--w14-font-mono, monospace)', fontSize: '0.72rem' }}>
          {addr.map((line) => (
            <div key={line}>{line}</div>
          ))}
          {identity.phone.trim() && <div>Tel.: {identity.phone}</div>}
          {identity.vatId.trim() && <div>USt-IdNr.: {identity.vatId}</div>}
        </div>
      </div>

      <PaperRule />
      <div style={{ display: 'grid', gap: 2 }}>
        <div style={rowStyle}>
          <span>Beleg-Nr.</span>
          <span>2026-0042</span>
        </div>
        <div style={rowStyle}>
          <span>Datum</span>
          <span>04.06.2026 14:21</span>
        </div>
        <div style={rowStyle}>
          <span>Kassierer</span>
          <span>Inhaber</span>
        </div>
      </div>

      <PaperRule />
      <div style={{ display: 'grid', gap: 6 }}>
        {SAMPLE_ITEMS.map((it) => (
          <div key={it.name} style={{ ...rowStyle, fontSize: '0.8rem' }}>
            <span style={{ maxWidth: 210 }}>
              {it.q} × {it.name}
            </span>
            <span>{it.total} €</span>
          </div>
        ))}
      </div>

      <PaperRule />
      <div style={{ display: 'grid', gap: 2 }}>
        <div style={rowStyle}>
          <span>Zwischensumme</span>
          <span>{SAMPLE_SUBTOTAL} €</span>
        </div>
        <div style={rowStyle}>
          <span>MwSt. (§25a)</span>
          <span>enthalten</span>
        </div>
        <div style={{ ...rowStyle, fontWeight: 700, fontSize: '0.92rem' }}>
          <span>SUMME</span>
          <span>{SAMPLE_TOTAL} €</span>
        </div>
      </div>

      <PaperRule />
      <div style={{ display: 'grid', gap: 2 }}>
        <div style={rowStyle}>
          <span>Zahlung</span>
          <span>Bar</span>
        </div>
        <div style={rowStyle}>
          <span>Bar erhalten</span>
          <span>{SAMPLE_CASH} €</span>
        </div>
        <div style={rowStyle}>
          <span>Wechselgeld</span>
          <span>{SAMPLE_CHANGE} €</span>
        </div>
      </div>

      <PaperRule />
      <div
        style={{
          display: 'grid',
          gap: 3,
          fontFamily: 'var(--w14-font-mono, monospace)',
          fontSize: '0.64rem',
          color: INK,
        }}
      >
        <div style={{ color: FADED, letterSpacing: '0.08em' }}>TSE-SIGNATUR</div>
        <div style={{ wordBreak: 'break-all' }}>BEISPIEL, wird beim echten Verkauf signiert</div>
        <div
          aria-hidden
          style={{
            marginTop: 6,
            alignSelf: 'center',
            width: 84,
            height: 84,
            display: 'grid',
            placeItems: 'center',
            textAlign: 'center',
            border: '1px solid #b9ad97',
            borderRadius: 4,
            color: FADED,
            fontSize: '0.56rem',
            padding: 6,
          }}
        >
          QR-Code
          <br />
          (wird gedruckt)
        </div>
      </div>

      {footerLines.length > 0 && <PaperRule />}
      <div style={{ display: 'grid', gap: 3, textAlign: 'center' }}>
        {footerLines.map((line, i) => (
          <div
            key={`${i}-${line}`}
            style={{
              fontFamily: 'var(--w14-font-mono, monospace)',
              fontSize: '0.66rem',
              color: FADED,
            }}
          >
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}

function buildSampleReceipt(identity: Identity, footerLines: string[]): ThermalReceiptData {
  const addr = [identity.tagline, identity.addressLine1, identity.addressLine2].filter(
    (l) => l.trim().length > 0,
  );
  return {
    shopName: identity.name,
    shopAddress: addr,
    shopVatId: identity.vatId,
    shopPhone: identity.phone.trim() ? identity.phone : null,
    receiptLocator: 'TESTDRUCK',
    printedAt: new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }),
    cashierName: 'Testdruck',
    shiftId: null,
    items: SAMPLE_ITEMS.map((it) => ({
      name: it.name,
      quantity: it.q,
      unitPriceEur: it.total,
      lineTotalEur: it.total,
      vatLabel: '',
    })),
    subtotalEur: SAMPLE_SUBTOTAL,
    vatEur: '0,00',
    totalEur: SAMPLE_TOTAL,
    paymentMethodLabel: 'Bar',
    cashReceivedEur: SAMPLE_CASH,
    changeEur: SAMPLE_CHANGE,
    // Send the SAME "no TSE" sentinel a real test-mode sale sends, so the
    // Testdruck preview renders the clean one-line "TSE-Ausfall" note (no fake
    // signature block, no meaningless QR) — i.e. exactly what a real receipt
    // looks like today. The "— TESTDRUCK —" footer marks it as a sample.
    tseSignatureValue: 'TSE Ausfall',
    tseSignatureCounter: 'TSE Ausfall',
    tseTransactionNumber: 'TSE Ausfall',
    tseQrPayload: 'TSE Ausfall',
    footerLines: [...(footerLines.length > 0 ? footerLines : DEFAULT_FOOTER), '- TESTDRUCK -'],
  };
}

// ════════════════════════════════════════════════════════════════════════
// Small inputs
// ════════════════════════════════════════════════════════════════════════

function Field({
  label,
  value,
  onChange,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
}): JSX.Element {
  return (
    <label style={{ display: 'block' }}>
      <span
        className="w14-smallcaps"
        style={{
          display: 'block',
          color: 'var(--w14-ink-aged)',
          fontSize: '0.72rem',
          letterSpacing: '0.06em',
          marginBottom: 4,
        }}
      >
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          ...inputStyle,
          fontFamily: mono ? 'var(--w14-font-mono)' : 'var(--w14-font-body)',
        }}
      />
    </label>
  );
}

function IconBtn({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 30,
        height: 30,
        flex: '0 0 auto',
        borderRadius: 6,
        border: '1px solid var(--w14-rule)',
        background: 'var(--w14-parchment-2)',
        color: disabled ? 'var(--w14-ink-faded)' : 'var(--w14-ink-aged)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        fontSize: '0.9rem',
      }}
    >
      {children}
    </button>
  );
}

const fieldsetStyle: React.CSSProperties = {
  border: '1px solid var(--w14-rule)',
  borderRadius: 'var(--w14-radius-card)',
  padding: '14px 16px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  margin: 0,
  background: 'var(--w14-parchment-1)',
};
const legendStyle: React.CSSProperties = {
  padding: '0 8px',
  fontFamily: 'var(--w14-font-display)',
  fontSize: '0.92rem',
  color: 'var(--w14-ink-aged)',
};
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--w14-rule)',
  borderRadius: 4,
  backgroundColor: 'var(--w14-parchment)',
  fontSize: '0.9rem',
  color: 'var(--w14-ink)',
  outline: 'none',
};
const addLineStyle: React.CSSProperties = {
  alignSelf: 'flex-start',
  marginTop: 4,
  padding: '6px 12px',
  borderRadius: 'var(--w14-radius-button)',
  border: '1px dashed var(--w14-rule)',
  background: 'transparent',
  color: 'var(--w14-ink-aged)',
  cursor: 'pointer',
  fontSize: '0.82rem',
};
const chipStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: 'var(--w14-radius-button)',
  border: '1px solid var(--w14-rule)',
  background: 'var(--w14-parchment-2)',
  color: 'var(--w14-ink-aged)',
  cursor: 'pointer',
  fontSize: '0.74rem',
};
