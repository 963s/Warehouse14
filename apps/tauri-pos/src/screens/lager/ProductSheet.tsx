/**
 * ProductSheet — the Unified Product Lifecycle (UX-REDESIGN §4.1).
 *
 * ONE right slide-over (P0 `Sheet`) that both CREATES and MANAGES a product —
 * replacing NeuesProduktDialog + InventoryAdjustmentDialog. The lifecycle is
 * the section order: Details → Fotos → Preis & Veröffentlichen → Etikett →
 * Handel. A pure-derived status chip rides in the header.
 *
 *   • create mode  (productId === null): the manual-stock form. POST /api/products
 *     (DRAFT) → optional publish (PUT status=AVAILABLE) gated by the locked €0
 *     guard → auto-print label → an INTENTIONAL draft round-trips to /fotos and
 *     back to THIS sheet.
 *   • manage mode  (productId set): fetch ProductDetail; collapsible sections for
 *     stock adjustment (audit-safe), publish, Web & SEO, label, photos, eBay.
 *
 * Behaviour parity is the bar — every guard from the two old dialogs is reused
 * verbatim (product-publish.ts, adjustment-notes.ts). Frontend-only; all
 * mutations go through the same endpoints + the step-up interceptor.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type CSSProperties, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  type ApiClient,
  ApiError,
  type InventoryAdjustmentReason,
  type ProductDetail,
  type TaxTreatmentCode,
  ebayApi,
  productsApi,
} from '@warehouse14/api-client';
import {
  Accordion,
  AccordionItem,
  Button,
  Checkbox,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Field,
  Input,
  Select,
  Sheet,
  Textarea,
} from '@warehouse14/ui-kit';

import {
  MIN_ADJUSTMENT_NOTE_LEN,
  adjustmentNoteShortfall,
  isAdjustmentNoteValid,
} from '../../lib/adjustment-notes.js';
import { useApiClient } from '../../lib/api-context.js';
import { isMoneyInput, normalizeDecimal } from '../../lib/decimal.js';
import { type LifecycleStage, deriveLifecycleStage } from '../../lib/product-lifecycle.js';
import { decidePublish, isPositivePrice } from '../../lib/product-publish.js';
import { TAX_TREATMENT_LABEL } from '../../lib/tax-treatment-label.js';
import { useLabelPrinter } from '../../lib/use-label-printer.js';
import { useToastStore } from '../../state/toast-store.js';

import { WebSeoPanel, productDetailQueryKey } from './WebSeoPanel.js';

export interface ProductSheetProps {
  open: boolean;
  /** null ⇒ create mode; a product id ⇒ manage mode. */
  productId: string | null;
  onClose: () => void;
}

export function ProductSheet({ open, productId, onClose }: ProductSheetProps): JSX.Element | null {
  const isCreate = productId === null;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      ariaLabel={isCreate ? 'Neues Produkt' : 'Produkt verwalten'}
      size="lg"
    >
      {isCreate ? (
        <CreateBody onClose={onClose} />
      ) : (
        <ManageBody productId={productId} onClose={onClose} />
      )}
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Lifecycle chip — pure-derived, header adornment.
// ─────────────────────────────────────────────────────────────────────────

const STAGE_TONE: Record<LifecycleStage, string> = {
  Entwurf: 'var(--w14-ink-faded)',
  Fotos: 'var(--w14-ink-aged)',
  Bepreist: 'var(--w14-gold)',
  Veröffentlicht: 'var(--w14-verdigris)',
  Reserviert: 'var(--w14-gold)',
  Verkauft: 'var(--w14-wax-red)',
};

function LifecycleChip({ stage }: { stage: LifecycleStage }): JSX.Element {
  return (
    <span
      className="w14-smallcaps"
      style={{
        padding: '4px 12px',
        borderRadius: 999,
        fontSize: '0.74rem',
        letterSpacing: '0.06em',
        color: '#fff',
        background: STAGE_TONE[stage],
        whiteSpace: 'nowrap',
      }}
    >
      {stage}
    </span>
  );
}

function SheetHeaderRow({
  title,
  subtitle,
  chip,
  onClose,
}: {
  title: string;
  subtitle?: string | undefined;
  chip?: JSX.Element | undefined;
  onClose: () => void;
}): JSX.Element {
  return (
    <DialogHeader>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 600,
            fontSize: '1.15rem',
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </span>
          {chip}
        </div>
        {subtitle && (
          <div
            className="w14-tabular"
            style={{
              fontFamily: 'var(--w14-font-mono)',
              fontSize: '0.8rem',
              color: 'var(--w14-ink-faded)',
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Schließen"
        style={{
          width: 48,
          height: 48,
          flex: '0 0 auto',
          border: 'none',
          background: 'transparent',
          color: 'var(--w14-ink-faded)',
          borderRadius: 'var(--w14-radius-button)',
          cursor: 'pointer',
          fontSize: '1.25rem',
        }}
      >
        <span aria-hidden="true">✕</span>
      </button>
    </DialogHeader>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// CREATE mode — the manual-stock form (parity with NeuesProduktDialog).
// ─────────────────────────────────────────────────────────────────────────

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

function generateSku(t: ItemType): string {
  const p = TYPE_PREFIX[t] ?? 'XX';
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${p}-${ymd}-${rnd}`;
}

interface CreatedResponse {
  id: string;
  sku: string;
  status: string;
}

function CreateBody({ onClose }: { onClose: () => void }): JSX.Element {
  const client = useApiClient() as ApiClient;
  const addToast = useToastStore((s) => s.addToast);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const printer = useLabelPrinter();

  const [name, setName] = useState('');
  const [sku, setSku] = useState(() => generateSku('gold_jewelry'));
  const [itemType, setItemType] = useState<ItemType>('gold_jewelry');
  const [condition, setCondition] = useState<Condition>('USED_GOOD');
  const [tax, setTax] = useState<TaxTreatmentCode>('MARGIN_25A');
  const [weightGrams, setWeightGrams] = useState('');
  const [acquisitionCostEur, setAcquisitionCostEur] = useState('');
  const [listPriceEur, setListPriceEur] = useState('');
  const [locUnit, setLocUnit] = useState('');
  const [locDrawer, setLocDrawer] = useState('');
  const [locPosition, setLocPosition] = useState('');
  const [publishNow, setPublishNow] = useState<boolean>(true);
  const [busy, setBusy] = useState(false);

  const valid =
    name.trim().length > 0 &&
    sku.trim().length > 0 &&
    isMoneyInput(acquisitionCostEur.trim()) &&
    isMoneyInput(listPriceEur.trim()) &&
    (weightGrams.trim().length === 0 || isMoneyInput(weightGrams.trim(), 3));

  const pricePositive = isPositivePrice(listPriceEur);
  const willPublish = publishNow && pricePositive;

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

      // Auto-print the shelf label when a printer is configured (intake tagging).
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

      // Creation always lands DRAFT; "Sofort verkaufsbereit" flips it to
      // AVAILABLE — but NEVER for a non-positive price (locked guard).
      const decision = decidePublish({ publishNow, listPriceEur });
      let outcome: 'published' | 'publish-failed' | 'no-price' | 'draft' = 'draft';
      let publishErr = '';
      if (decision.kind === 'publish') {
        try {
          await productsApi.update(client, res.id, { status: 'AVAILABLE' });
          outcome = 'published';
        } catch (e) {
          outcome = 'publish-failed';
          publishErr = e instanceof Error ? e.message : '';
        }
      } else if (decision.kind === 'draft-no-price') {
        outcome = 'no-price';
      }

      void qc.invalidateQueries({ queryKey: ['products', 'list'] });

      if (outcome === 'published') {
        addToast({
          tone: 'success',
          title: 'Produkt verkaufsbereit',
          body: `${res.sku} — sofort im Verkauf sichtbar`,
        });
      } else if (outcome === 'publish-failed') {
        addToast({
          tone: 'alert',
          title: 'Angelegt, aber NICHT verkaufsbereit',
          body: `${res.sku} ist nur ein Entwurf — in Lager veröffentlichen.${
            publishErr ? ` (${publishErr})` : ''
          }`,
        });
      } else if (outcome === 'no-price') {
        addToast({
          tone: 'alert',
          title: 'Kein Verkaufspreis — als Entwurf gespeichert',
          body: `${res.sku}: ein Verkaufspreis über 0 € ist nötig, um sofort zu verkaufen.`,
        });
      } else {
        addToast({
          tone: 'success',
          title: 'Produkt angelegt',
          body: printer.configured
            ? `${res.sku} (Entwurf) — Etikett gedruckt, jetzt Fotos`
            : `${res.sku} (Entwurf) — jetzt Fotos aufnehmen`,
        });
      }

      onClose();
      // Only an INTENTIONAL draft hands over to the photo workflow — and now it
      // round-trips back to THIS product's sheet (no dead-end).
      if (outcome === 'draft') {
        navigate(fotosHref(res.id));
      }
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
    <>
      <SheetHeaderRow
        title="Neues Produkt"
        subtitle="Manueller Lagerzugang — wird als Entwurf angelegt"
        chip={<LifecycleChip stage="Entwurf" />}
        onClose={onClose}
      />
      <DialogBody style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field label="Bezeichnung" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Goldring 585 mit Brillant"
          />
        </Field>

        <div
          style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'end' }}
        >
          <Field label="SKU / Artikelnr." required>
            <Input
              mono
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="GS-260604-A3F9"
            />
          </Field>
          <Button
            variant="ghost"
            size="md"
            type="button"
            onClick={() => setSku(generateSku(itemType))}
          >
            ⟳ Neu
          </Button>
        </div>

        <div style={TWO_COL}>
          <Field label="Gewicht (g)">
            <Input
              mono
              inputMode="decimal"
              value={weightGrams}
              onChange={(e) => setWeightGrams(e.target.value)}
              placeholder="optional"
            />
          </Field>
          <Field label="Art">
            <Select value={itemType} onChange={(e) => setItemType(e.target.value as ItemType)}>
              {ITEM_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div style={TWO_COL}>
          <Field label="Zustand">
            <Select value={condition} onChange={(e) => setCondition(e.target.value as Condition)}>
              {CONDITION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Steuerart">
            <Select value={tax} onChange={(e) => setTax(e.target.value as TaxTreatmentCode)}>
              {TAX_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {TAX_TREATMENT_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div style={TWO_COL}>
          <Field label="Einkaufswert €" required>
            <Input
              mono
              inputMode="decimal"
              value={acquisitionCostEur}
              onChange={(e) => setAcquisitionCostEur(e.target.value)}
              placeholder="0,00"
            />
          </Field>
          <Field label="Verkaufspreis €" required>
            <Input
              mono
              inputMode="decimal"
              value={listPriceEur}
              onChange={(e) => setListPriceEur(e.target.value)}
              placeholder="0,00"
            />
          </Field>
        </div>

        <div>
          <span style={MINI_LABEL}>Lagerort (optional)</span>
          <div
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 6 }}
          >
            <Input
              mono
              value={locUnit}
              onChange={(e) => setLocUnit(e.target.value)}
              placeholder="Tresor-1"
              aria-label="Lagereinheit"
            />
            <Input
              mono
              value={locDrawer}
              onChange={(e) => setLocDrawer(e.target.value)}
              placeholder="Fach-3"
              aria-label="Fach"
            />
            <Input
              mono
              value={locPosition}
              onChange={(e) => setLocPosition(e.target.value)}
              placeholder="Box-12"
              aria-label="Position"
            />
          </div>
        </div>

        <Checkbox
          checked={willPublish}
          disabled={!pricePositive}
          onChange={(e) => setPublishNow(e.target.checked)}
          label="Sofort verkaufsbereit — direkt im Verkauf sichtbar (sonst nur Entwurf)"
        />
        {!pricePositive && (
          <p
            style={{
              margin: 0,
              fontSize: '0.8rem',
              color: 'var(--w14-ink-faded)',
              fontStyle: 'italic',
            }}
          >
            Ein Verkaufspreis über 0 € ist nötig, um das Produkt sofort verkaufsbereit zu machen.
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          Abbrechen
        </Button>
        <Button variant="primary" disabled={!valid || busy} onClick={() => void submit()}>
          {busy ? 'Speichert…' : willPublish ? 'Anlegen & verkaufsbereit' : 'Als Entwurf anlegen'}
        </Button>
      </DialogFooter>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// MANAGE mode — fetch ProductDetail; collapsible lifecycle sections.
// ─────────────────────────────────────────────────────────────────────────

function ManageBody({
  productId,
  onClose,
}: { productId: string; onClose: () => void }): JSX.Element {
  const api = useApiClient();
  const detailQ = useQuery({
    queryKey: productDetailQueryKey(productId),
    queryFn: () => productsApi.get(api, productId),
    staleTime: 10_000,
  });

  const product = detailQ.data;
  const stage = product
    ? deriveLifecycleStage({ status: product.status, listPriceEur: product.listPriceEur })
    : null;

  return (
    <>
      <SheetHeaderRow
        title={product?.name ?? 'Produkt'}
        subtitle={product?.sku}
        chip={stage ? <LifecycleChip stage={stage} /> : undefined}
        onClose={onClose}
      />
      <DialogBody style={{ paddingTop: 12 }}>
        {detailQ.isLoading ? (
          <p style={{ color: 'var(--w14-ink-faded)', fontStyle: 'italic' }}>Lädt Produkt…</p>
        ) : detailQ.isError || !product ? (
          <p role="alert" style={{ color: 'var(--w14-wax-red)' }}>
            Produkt konnte nicht geladen werden.
          </p>
        ) : (
          <Accordion>
            <AccordionItem id="details" title="Details" defaultOpen>
              <DetailsSection product={product} />
            </AccordionItem>
            <AccordionItem id="fotos" title="Fotos">
              <FotosSection product={product} />
            </AccordionItem>
            <AccordionItem id="preis" title="Preis & Veröffentlichen">
              <PreisSection product={product} onDone={onClose} />
            </AccordionItem>
            <AccordionItem id="bestand" title="Bestand & Lagerort">
              <BestandSection product={product} onDone={onClose} />
            </AccordionItem>
            <AccordionItem id="webseo" title="Web & SEO">
              <WebSeoPanel productId={product.id} />
            </AccordionItem>
            <AccordionItem id="etikett" title="Etikett">
              <EtikettSection product={product} />
            </AccordionItem>
            <AccordionItem id="handel" title="Handel (eBay)">
              <HandelSection product={product} />
            </AccordionItem>
          </Accordion>
        )}
      </DialogBody>
    </>
  );
}

function DetailsSection({ product }: { product: ProductDetail }): JSX.Element {
  const rows: Array<[string, string]> = [
    ['Art', product.itemType],
    ['Zustand', product.condition],
    [
      'Steuerart',
      TAX_TREATMENT_LABEL[product.taxTreatmentCode as TaxTreatmentCode] ?? product.taxTreatmentCode,
    ],
    ['Gewicht', product.weightGrams ? `${product.weightGrams} g` : '—'],
    ['Einkaufswert', `${product.acquisitionCostEur} €`],
    ['Verkaufspreis', `${product.listPriceEur} €`],
    [
      'Lagerort',
      [product.locationStorageUnit, product.locationDrawer, product.locationPosition]
        .filter((s): s is string => !!s && s.length > 0)
        .join(' · ') || '—',
    ],
  ];
  return (
    <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', margin: 0 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt style={MINI_LABEL}>{k}</dt>
          <dd
            className="w14-tabular"
            style={{ margin: 0, fontFamily: 'var(--w14-font-mono)', fontSize: '0.9rem' }}
          >
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Round-trip href to the deep photo route that returns to THIS product sheet. */
function fotosHref(productId: string): string {
  const returnTo = `/lager?produkt=${encodeURIComponent(productId)}`;
  return `/fotos?mode=produkt&productId=${encodeURIComponent(productId)}&returnTo=${encodeURIComponent(returnTo)}`;
}

function FotosSection({ product }: { product: ProductDetail }): JSX.Element {
  const navigate = useNavigate();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--w14-ink-faded)' }}>
        Fotos werden in der Foto-Werkstatt aufgenommen und zugeschnitten — danach landen Sie wieder
        hier beim Produkt.
      </p>
      <div>
        <Button variant="primary" size="md" onClick={() => navigate(fotosHref(product.id))}>
          Fotos aufnehmen / verwalten
        </Button>
      </div>
    </div>
  );
}

function PreisSection({
  product,
  onDone,
}: {
  product: ProductDetail;
  onDone: () => void;
}): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [busy, setBusy] = useState(false);

  const canPublish = product.status === 'DRAFT' && isPositivePrice(product.listPriceEur);

  async function publish(): Promise<void> {
    if (!canPublish || busy) return;
    setBusy(true);
    try {
      await productsApi.update(api, product.id, { status: 'AVAILABLE' });
      addToast({
        tone: 'success',
        title: 'Verkaufsbereit',
        body: `${product.sku} — jetzt im Verkauf sichtbar`,
      });
      await qc.invalidateQueries({ queryKey: ['products', 'list'] });
      await qc.invalidateQueries({ queryKey: productDetailQueryKey(product.id) });
      onDone();
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : 'Verbindung gestört — bitte erneut versuchen.';
      addToast({ tone: 'alert', title: 'Nicht verkaufsbereit', body: msg });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="w14-tabular" style={{ fontFamily: 'var(--w14-font-mono)' }}>
        Verkaufspreis: {product.listPriceEur} €
      </div>
      {product.status === 'DRAFT' ? (
        canPublish ? (
          <div>
            <Button variant="primary" disabled={busy} onClick={() => void publish()}>
              {busy ? 'Wird verkaufsbereit…' : 'Verkaufsbereit machen'}
            </Button>
          </div>
        ) : (
          <p
            style={{
              margin: 0,
              fontSize: '0.84rem',
              color: 'var(--w14-ink-faded)',
              fontStyle: 'italic',
            }}
          >
            Ein Verkaufspreis über 0 € ist nötig, um den Entwurf verkaufsbereit zu machen (im Web &
            SEO oder beim Anlegen setzen).
          </p>
        )
      ) : (
        <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--w14-verdigris)' }}>
          Bereits verkaufsbereit ({product.status}). Storefront-Sichtbarkeit unter „Web & SEO".
        </p>
      )}
    </div>
  );
}

const ADJ_REASON_OPTIONS: Array<{ value: InventoryAdjustmentReason; label: string; hint: string }> =
  [
    { value: 'LOCATION_CHANGE', label: 'Lagerort ändern', hint: 'Stück wird physisch verschoben.' },
    { value: 'LOST', label: 'Als verloren markieren', hint: 'Stück fehlt im Bestand.' },
    { value: 'DAMAGED', label: 'Als beschädigt markieren', hint: 'Stück nicht verkaufsfähig.' },
    { value: 'FOUND', label: 'Wiedergefunden', hint: 'Hebt vorherigen Verlust-Vermerk auf.' },
    { value: 'OPERATOR_NOTE', label: 'Notiz hinzufügen', hint: 'Anmerkung ohne Statusänderung.' },
  ];

function BestandSection({
  product,
  onDone,
}: {
  product: ProductDetail;
  onDone: () => void;
}): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const [reason, setReason] = useState<InventoryAdjustmentReason>('LOCATION_CHANGE');
  const [notes, setNotes] = useState('');
  const [storageUnit, setStorageUnit] = useState(product.locationStorageUnit ?? '');
  const [drawer, setDrawer] = useState(product.locationDrawer ?? '');
  const [position, setPosition] = useState(product.locationPosition ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requiresLocation = reason === 'LOCATION_CHANGE';
  const locationValid =
    storageUnit.trim().length > 0 && drawer.trim().length > 0 && position.trim().length > 0;
  const notesValid = isAdjustmentNoteValid(notes);
  const notesShortfall = adjustmentNoteShortfall(notes);
  const notesTouched = notes.length > 0;
  const canSubmit = notesValid && (!requiresLocation || locationValid) && !submitting;

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const body =
        reason === 'LOCATION_CHANGE'
          ? {
              reason,
              notes: notes.trim(),
              locationStorageUnit: storageUnit.trim(),
              locationDrawer: drawer.trim(),
              locationPosition: position.trim(),
            }
          : { reason, notes: notes.trim() };
      await productsApi.adjustInventory(api, product.id, body);
      addToast({
        tone: reason === 'LOST' || reason === 'DAMAGED' ? 'alert' : 'success',
        title: 'Anpassung protokolliert',
        body: `${product.sku} — ${ADJ_REASON_OPTIONS.find((o) => o.value === reason)?.label ?? reason}`,
      });
      await qc.invalidateQueries({ queryKey: ['products', 'list'] });
      await qc.invalidateQueries({ queryKey: productDetailQueryKey(product.id) });
      onDone();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'STEP_UP_REQUIRED') setError('PIN-Bestätigung wurde abgebrochen.');
        else if (err.code === 'NOT_FOUND') {
          setError('Stück nicht mehr vorhanden — Liste wird aktualisiert.');
          void qc.invalidateQueries({ queryKey: ['products', 'list'] });
        } else setError(err.message);
      } else setError('Verbindung gestört — bitte erneut versuchen.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gap: 8 }}>
        {ADJ_REASON_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              gap: 10,
              alignItems: 'baseline',
              padding: '8px 10px',
              minHeight: 48,
              background: reason === opt.value ? 'var(--w14-parchment-3)' : 'transparent',
              border: `1px solid ${reason === opt.value ? 'var(--w14-gold)' : 'var(--w14-rule)'}`,
              borderRadius: 'var(--w14-radius-card)',
              cursor: 'pointer',
            }}
          >
            <input
              type="radio"
              name="adjustment-reason"
              value={opt.value}
              checked={reason === opt.value}
              onChange={() => setReason(opt.value)}
            />
            <div>
              <div style={{ fontWeight: 500, fontSize: '0.92rem' }}>{opt.label}</div>
              <div
                style={{ fontStyle: 'italic', fontSize: '0.78rem', color: 'var(--w14-ink-faded)' }}
              >
                {opt.hint}
              </div>
            </div>
          </label>
        ))}
      </div>

      {requiresLocation && (
        <div>
          <span style={MINI_LABEL}>Neuer Lagerort</span>
          <div
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 6 }}
          >
            <Input
              mono
              value={storageUnit}
              onChange={(e) => setStorageUnit(e.target.value)}
              placeholder="Tresor-1"
              aria-label="Standort"
            />
            <Input
              mono
              value={drawer}
              onChange={(e) => setDrawer(e.target.value)}
              placeholder="Fach-3"
              aria-label="Fach"
            />
            <Input
              mono
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              placeholder="Pos-12"
              aria-label="Position"
            />
          </div>
          {!locationValid && (
            <span style={{ fontSize: '0.78rem', color: 'var(--w14-ink-faded)' }}>
              Alle drei Felder (Standort · Fach · Position) sind erforderlich.
            </span>
          )}
        </div>
      )}

      <Field
        label={`Notiz (≥ ${MIN_ADJUSTMENT_NOTE_LEN} Zeichen)`}
        error={
          notesTouched && !notesValid
            ? `Noch ${notesShortfall} Zeichen (mind. ${MIN_ADJUSTMENT_NOTE_LEN})`
            : null
        }
        {...(notesValid ? { hint: 'Anmerkung ✓' } : {})}
      >
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          maxLength={1024}
          placeholder="Operator-Begründung für das Audit-Log."
        />
      </Field>

      {error && (
        <p role="alert" style={{ color: 'var(--w14-wax-red)', margin: 0, fontSize: '0.9rem' }}>
          {error}
        </p>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
          {submitting ? 'Protokolliert…' : 'Anpassung protokollieren'}
        </Button>
      </div>
    </div>
  );
}

function EtikettSection({ product }: { product: ProductDetail }): JSX.Element {
  const printer = useLabelPrinter();
  const loc =
    [product.locationStorageUnit, product.locationDrawer, product.locationPosition]
      .filter((s): s is string => !!s && s.length > 0)
      .join(' · ') || null;
  const printable = product.status !== 'SOLD' && !product.archivedAt;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Single, consistent label preview + control (was auto-here/manual-there). */}
      <div
        style={{
          border: '1px dashed var(--w14-rule)',
          borderRadius: 'var(--w14-radius-card)',
          padding: 12,
          fontFamily: 'var(--w14-font-mono)',
          fontSize: '0.86rem',
          display: 'grid',
          gap: 2,
        }}
      >
        <div className="w14-tabular">{product.sku}</div>
        <div style={{ fontFamily: 'var(--w14-font-display)', fontWeight: 600 }}>{product.name}</div>
        <div className="w14-tabular" style={{ color: 'var(--w14-ink-faded)' }}>
          {product.weightGrams ? `${product.weightGrams} g · ` : ''}
          {product.listPriceEur} €{loc ? ` · ${loc}` : ''}
        </div>
      </div>
      <div>
        <Button
          variant="primary"
          disabled={!printer.configured || !printable}
          onClick={() =>
            void printer.print([
              {
                sku: product.sku,
                productName: product.name,
                weightGrams: product.weightGrams,
                karat: null,
                storageLocation: loc,
              },
            ])
          }
        >
          Etikett drucken
        </Button>
        {!printer.configured && (
          <span style={{ marginLeft: 10, fontSize: '0.8rem', color: 'var(--w14-ink-faded)' }}>
            Kein Etikettendrucker konfiguriert.
          </span>
        )}
      </div>
    </div>
  );
}

function HandelSection({ product }: { product: ProductDetail }): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [busy, setBusy] = useState(false);

  async function enlist(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await ebayApi.transition(api, product.id, { toState: 'ENTWURF' });
      addToast({
        tone: 'success',
        title: 'Auf eBay angemeldet',
        body: `${product.sku} — als Entwurf in der eBay-Pipeline`,
      });
      await qc.invalidateQueries({ queryKey: productDetailQueryKey(product.id) });
      await qc.invalidateQueries({ queryKey: ['products', 'list'] });
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : 'Verbindung gestört — bitte erneut versuchen.';
      addToast({ tone: 'alert', title: 'eBay-Anmeldung fehlgeschlagen', body: msg });
    } finally {
      setBusy(false);
    }
  }

  if (product.ebayState === null) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--w14-ink-faded)' }}>
          Noch nicht bei eBay. „Anmelden" legt das Stück als Entwurf in der eBay-Pipeline an — der
          weitere Ablauf passiert in der eBay-Konsole.
        </p>
        <div>
          <Button variant="primary" disabled={busy} onClick={() => void enlist()}>
            {busy ? 'Wird angemeldet…' : 'Auf eBay anmelden'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <p style={{ margin: 0, fontSize: '0.9rem' }}>
      eBay-Status: <strong>{product.ebayState}</strong>. Weiter in der eBay-Konsole verwalten.
    </p>
  );
}

const TWO_COL: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };
const MINI_LABEL: CSSProperties = {
  display: 'block',
  fontSize: '0.72rem',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--w14-ink-faded)',
};
