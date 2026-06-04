/**
 * NeuesProduktDialog — manual "add product to inventory" (Phase 1 #2).
 *
 * The POS could only create products via the AI intake pipeline or the Ankauf
 * flow; there was no way to enter shop-original / manual stock. This dialog
 * fills that gap: a focused form → `POST /api/products` (ADMIN; the api-client
 * step-up middleware prompts for a PIN when the acquisition cost crosses the
 * threshold). Created as DRAFT — the Owner publishes to AVAILABLE from Lager.
 */

import { type CSSProperties, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { ApiClient, TaxTreatmentCode } from '@warehouse14/api-client';
import { Button, DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { isMoneyInput, normalizeDecimal } from '../../lib/decimal.js';
import { TAX_TREATMENT_LABEL } from '../../lib/tax-treatment-label.js';
import { useLabelPrinter } from '../../lib/use-label-printer.js';
import { useToastStore } from '../../state/toast-store.js';

type ItemType =
  | 'gold_jewelry'
  | 'gold_coin'
  | 'gold_bar'
  | 'silver_jewelry'
  | 'silver_coin'
  | 'silver_bar'
  | 'platinum_jewelry'
  | 'platinum_coin'
  | 'platinum_bar'
  | 'antique'
  | 'watch'
  | 'other';

type Condition =
  | 'NEW'
  | 'USED_EXCELLENT'
  | 'USED_GOOD'
  | 'USED_FAIR'
  | 'ANTIQUE_RESTORED'
  | 'ANTIQUE_AS_FOUND';

const ITEM_TYPE_OPTIONS: Array<{ value: ItemType; label: string }> = [
  { value: 'gold_jewelry', label: 'Goldschmuck' },
  { value: 'gold_coin', label: 'Goldmünze' },
  { value: 'gold_bar', label: 'Goldbarren' },
  { value: 'silver_jewelry', label: 'Silberschmuck' },
  { value: 'silver_coin', label: 'Silbermünze' },
  { value: 'silver_bar', label: 'Silberbarren' },
  { value: 'platinum_jewelry', label: 'Platinschmuck' },
  { value: 'platinum_coin', label: 'Platinmünze' },
  { value: 'platinum_bar', label: 'Platinbarren' },
  { value: 'antique', label: 'Antiquität' },
  { value: 'watch', label: 'Uhr' },
  { value: 'other', label: 'Sonstiges' },
];

const CONDITION_OPTIONS: Array<{ value: Condition; label: string }> = [
  { value: 'NEW', label: 'Neu' },
  { value: 'USED_EXCELLENT', label: 'Gebraucht — sehr gut' },
  { value: 'USED_GOOD', label: 'Gebraucht — gut' },
  { value: 'USED_FAIR', label: 'Gebraucht — mäßig' },
  { value: 'ANTIQUE_RESTORED', label: 'Antik — restauriert' },
  { value: 'ANTIQUE_AS_FOUND', label: 'Antik — Fundzustand' },
];

const TAX_OPTIONS: TaxTreatmentCode[] = [
  'MARGIN_25A',
  'INVESTMENT_GOLD_25C',
  'STANDARD_19',
  'REDUCED_7',
  'MIXED',
  'REVERSE_CHARGE_13B',
];

/** Per-type SKU prefix → a readable, sortable article number. */
const TYPE_PREFIX: Record<ItemType, string> = {
  gold_jewelry: 'GS',
  gold_coin: 'GM',
  gold_bar: 'GB',
  silver_jewelry: 'SS',
  silver_coin: 'SM',
  silver_bar: 'SB',
  platinum_jewelry: 'PS',
  platinum_coin: 'PM',
  platinum_bar: 'PB',
  antique: 'AQ',
  watch: 'UH',
  other: 'XX',
};

/** Generate a unique-by-construction article number, e.g. GS-260604-A3F9. */
function generateSku(t: ItemType): string {
  const p = TYPE_PREFIX[t] ?? 'XX';
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${p}-${ymd}-${rnd}`;
}

const fieldWrap: CSSProperties = { display: 'grid', gap: 4 };
const labelStyle: CSSProperties = {
  fontSize: '0.72rem',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--w14-ink-faded)',
};
const inputStyle: CSSProperties = {
  padding: '8px 10px',
  border: '1px solid var(--w14-rule)',
  borderRadius: 'var(--w14-radius-button)',
  background: 'var(--w14-parchment)',
  color: 'var(--w14-ink)',
  fontFamily: 'var(--w14-font-body)',
  fontSize: '0.95rem',
  width: '100%',
};

interface CreatedResponse {
  id: string;
  sku: string;
  status: string;
}

export function NeuesProduktDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}): JSX.Element | null {
  const client = useApiClient() as ApiClient;
  const addToast = useToastStore((s) => s.addToast);
  const navigate = useNavigate();
  const printer = useLabelPrinter();

  const [name, setName] = useState('');
  const [sku, setSku] = useState(() => generateSku('gold_jewelry'));
  const [itemType, setItemType] = useState<ItemType>('gold_jewelry');
  const [condition, setCondition] = useState<Condition>('USED_GOOD');
  const [tax, setTax] = useState<TaxTreatmentCode>('MARGIN_25A');
  const [weightGrams, setWeightGrams] = useState('');
  const [acquisitionCostEur, setAcquisitionCostEur] = useState('');
  const [listPriceEur, setListPriceEur] = useState('');
  // Storage location (Lagerort) — assigned at intake so every item has a place.
  const [locUnit, setLocUnit] = useState('');
  const [locDrawer, setLocDrawer] = useState('');
  const [locPosition, setLocPosition] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const reset = (): void => {
    setName('');
    setSku(generateSku('gold_jewelry'));
    setItemType('gold_jewelry');
    setCondition('USED_GOOD');
    setTax('MARGIN_25A');
    setWeightGrams('');
    setAcquisitionCostEur('');
    setListPriceEur('');
    setLocUnit('');
    setLocDrawer('');
    setLocPosition('');
  };

  const valid =
    name.trim().length > 0 &&
    sku.trim().length > 0 &&
    isMoneyInput(acquisitionCostEur.trim()) &&
    isMoneyInput(listPriceEur.trim()) &&
    (weightGrams.trim().length === 0 || isMoneyInput(weightGrams.trim(), 3));

  async function submit(): Promise<void> {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        sku: sku.trim(),
        name: name.trim(),
        itemType,
        condition,
        taxTreatmentCode: tax,
        acquisitionCostEur: normalizeDecimal(acquisitionCostEur.trim()),
        listPriceEur: normalizeDecimal(listPriceEur.trim()),
        hallmarkStamps: [],
        isCommission: false,
        listedOnStorefront: false,
        listedOnEbay: false,
      };
      if (weightGrams.trim().length > 0) body.weightGrams = normalizeDecimal(weightGrams.trim(), 3);
      if (locUnit.trim().length > 0) body.locationStorageUnit = locUnit.trim();
      if (locDrawer.trim().length > 0) body.locationDrawer = locDrawer.trim();
      if (locPosition.trim().length > 0) body.locationPosition = locPosition.trim();

      const res = await client.request<CreatedResponse>('POST', '/api/products', body);

      // Auto-print the shelf label (SKU + name + weight + location) when a
      // label printer is configured — so the item is tagged at intake.
      if (printer.configured) {
        const loc = [locUnit.trim(), locDrawer.trim(), locPosition.trim()]
          .filter((s) => s.length > 0)
          .join(' · ');
        void printer.print([
          {
            sku: res.sku,
            productName: name.trim(),
            weightGrams: weightGrams.trim().length > 0 ? weightGrams.trim() : null,
            karat: null,
            storageLocation: loc.length > 0 ? loc : null,
          },
        ]);
      }

      addToast({
        tone: 'success',
        title: 'Produkt angelegt',
        body: printer.configured
          ? `${res.sku} (Entwurf) — Etikett gedruckt, jetzt Fotos`
          : `${res.sku} (Entwurf) — jetzt Fotos aufnehmen`,
      });
      reset();
      onCreated();
      onClose();
      // Hand straight over to the photo workflow, bound to the new product
      // (mode=produkt → each capture registers against this productId).
      navigate(`/fotos?mode=produkt&productId=${encodeURIComponent(res.id)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unbekannter Fehler';
      if (/step[_-]?up/i.test(msg)) {
        addToast({
          tone: 'alert',
          title: 'PIN-Bestätigung nötig',
          body: 'Hoher Einkaufswert — bitte PIN-Freigabe wiederholen.',
        });
      } else {
        addToast({ tone: 'alert', title: 'Anlegen fehlgeschlagen', body: msg });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: backdrop-overlay modal pattern; a native <dialog> needs imperative showModal()/focus-trap wiring beyond this scope.
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Neues Produkt"
      tabIndex={-1}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--w14-overlay)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 20,
      }}
    >
      <ParchmentCard
        padding="lg"
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }}
      >
        <h2 style={{ margin: 0, fontFamily: 'var(--w14-font-display)', fontSize: '1.35rem' }}>
          Neues Produkt
        </h2>
        <p style={{ margin: '4px 0 0', color: 'var(--w14-ink-faded)', fontSize: '0.85rem' }}>
          Manueller Lagerzugang — wird als Entwurf angelegt.
        </p>

        <DiamondRule style={{ margin: '16px 0' }} />

        <div style={{ display: 'grid', gap: 14 }}>
          <label style={fieldWrap}>
            <span style={labelStyle}>Bezeichnung *</span>
            <input
              style={inputStyle}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. Goldring 585 mit Brillant"
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <label style={fieldWrap}>
              <span style={labelStyle}>SKU / Artikelnr. *</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  style={{ ...inputStyle, fontFamily: 'var(--w14-font-mono)' }}
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  placeholder="GS-260604-A3F9"
                />
                <button
                  type="button"
                  title="Neue Artikelnummer generieren"
                  onClick={() => setSku(generateSku(itemType))}
                  style={{
                    flex: '0 0 auto',
                    padding: '0 10px',
                    border: '1px solid var(--w14-rule)',
                    borderRadius: 'var(--w14-radius-button)',
                    background: 'var(--w14-parchment-3)',
                    color: 'var(--w14-ink)',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                  }}
                >
                  ⟳
                </button>
              </div>
            </label>
            <label style={fieldWrap}>
              <span style={labelStyle}>Gewicht (g)</span>
              <input
                style={{ ...inputStyle, fontFamily: 'var(--w14-font-mono)' }}
                inputMode="decimal"
                value={weightGrams}
                onChange={(e) => setWeightGrams(e.target.value)}
                placeholder="optional"
              />
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <label style={fieldWrap}>
              <span style={labelStyle}>Art</span>
              <select
                style={inputStyle}
                value={itemType}
                onChange={(e) => setItemType(e.target.value as ItemType)}
              >
                {ITEM_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={fieldWrap}>
              <span style={labelStyle}>Zustand</span>
              <select
                style={inputStyle}
                value={condition}
                onChange={(e) => setCondition(e.target.value as Condition)}
              >
                {CONDITION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label style={fieldWrap}>
            <span style={labelStyle}>Steuerart</span>
            <select
              style={inputStyle}
              value={tax}
              onChange={(e) => setTax(e.target.value as TaxTreatmentCode)}
            >
              {TAX_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {TAX_TREATMENT_LABEL[t]}
                </option>
              ))}
            </select>
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <label style={fieldWrap}>
              <span style={labelStyle}>Einkaufswert € *</span>
              <input
                style={{ ...inputStyle, fontFamily: 'var(--w14-font-mono)' }}
                inputMode="decimal"
                value={acquisitionCostEur}
                onChange={(e) => setAcquisitionCostEur(e.target.value)}
                placeholder="0.00"
              />
            </label>
            <label style={fieldWrap}>
              <span style={labelStyle}>Verkaufspreis € *</span>
              <input
                style={{ ...inputStyle, fontFamily: 'var(--w14-font-mono)' }}
                inputMode="decimal"
                value={listPriceEur}
                onChange={(e) => setListPriceEur(e.target.value)}
                placeholder="0.00"
              />
            </label>
          </div>

          {/* Storage location (Lagerort) — every item gets a designated place. */}
          <div>
            <span style={{ ...labelStyle, display: 'block', marginBottom: 6 }}>
              Lagerort (optional)
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <input
                style={{ ...inputStyle, fontFamily: 'var(--w14-font-mono)' }}
                value={locUnit}
                onChange={(e) => setLocUnit(e.target.value)}
                placeholder="Tresor-1"
                aria-label="Lagereinheit"
              />
              <input
                style={{ ...inputStyle, fontFamily: 'var(--w14-font-mono)' }}
                value={locDrawer}
                onChange={(e) => setLocDrawer(e.target.value)}
                placeholder="Fach-3"
                aria-label="Fach / Schublade"
              />
              <input
                style={{ ...inputStyle, fontFamily: 'var(--w14-font-mono)' }}
                value={locPosition}
                onChange={(e) => setLocPosition(e.target.value)}
                placeholder="Box-12"
                aria-label="Position / Box"
              />
            </div>
          </div>
        </div>

        <DiamondRule style={{ margin: '18px 0' }} />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Button variant="ghost" size="md" disabled={busy} onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={!valid || busy}
            onClick={() => {
              void submit();
            }}
          >
            {busy ? 'Speichert…' : 'Anlegen'}
          </Button>
        </div>
      </ParchmentCard>
    </div>
  );
}
