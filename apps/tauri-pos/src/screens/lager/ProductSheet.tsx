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
  EBAY_STATE_LABELS,
  type InventoryAdjustmentReason,
  type ProductDetail,
  type ProductUpdateBody,
  type TaxTreatmentCode,
  categoriesApi,
  ebayApi,
  photosApi,
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
  Icon,
  Input,
  Select,
  Sheet,
  Textarea,
  X,
} from '@warehouse14/ui-kit';

import {
  MIN_ADJUSTMENT_NOTE_LEN,
  adjustmentNoteShortfall,
  isAdjustmentNoteValid,
} from '../../lib/adjustment-notes.js';
import { useApiClient } from '../../lib/api-context.js';
import { formatEur, formatGrams, isMoneyInput, normalizeDecimal } from '../../lib/decimal.js';
import {
  CONDITION_OPTIONS,
  type Condition,
  ITEM_TYPE_OPTIONS,
  type ItemType,
  conditionLabel,
  itemTypeLabel,
} from '../../lib/item-type-label.js';
import { type LifecycleStage, deriveLifecycleStage } from '../../lib/product-lifecycle.js';
import { decidePublish, isPositivePrice } from '../../lib/product-publish.js';
import { PRODUCT_STATUS_LABEL } from '../../lib/product-status-label.js';
import { TAX_TREATMENT_LABEL } from '../../lib/tax-treatment-label.js';
import { type StampErhaltung, formatStampDisplay, sortierTipp } from '../../lib/taxonomy-hints.js';
import { useLabelPrinter } from '../../lib/use-label-printer.js';
import { useToastStore } from '../../state/toast-store.js';
import { describeError } from '@warehouse14/i18n-de';

import {
  BeschreibungDetailsFields,
  CategoryPickerField,
  type CategorySelection,
  type CollectorDetailsDraft,
  EMPTY_COLLECTOR_DETAILS,
  StampAttributeFields,
  buildDetailsUpdate,
  hasCollectorDetails,
  isOriginCountryValid,
  resolveCategorySelection,
  useCategoryTree,
} from './CategoryPicker.js';
import { WebSeoPanel, productDetailQueryKey } from './WebSeoPanel.js';

/**
 * Stamp attribute columns (stamp_erhaltung / stamp_minr) ship with the
 * Briefmarken taxonomy wave — typed locally until the api-client domain
 * declares them. The PUT for these two fields runs SEPARATELY so a server
 * that does not accept them yet never poisons the rest of a save.
 */
type ProductDetailExt = ProductDetail & {
  stampErhaltung?: StampErhaltung | null;
  stampMinr?: number | null;
};

export interface ProductSheetProps {
  open: boolean;
  /** null ⇒ create mode; a product id ⇒ manage mode. */
  productId: string | null;
  onClose: () => void;
}

export function ProductSheet({ open, productId, onClose }: ProductSheetProps): JSX.Element | null {
  // After a successful create the sheet stays open and transitions IN-PLACE to
  // manage mode for the new product — no close + re-click. `createdId` holds
  // that just-created id; it resets on close so the next "+ Neues Produkt"
  // opens a fresh create form.
  const [createdId, setCreatedId] = useState<string | null>(null);

  const handleClose = (): void => {
    setCreatedId(null);
    onClose();
  };

  // productId (Lager row-click / ?produkt= deep-open) wins; otherwise a just-
  // created id transitions us into manage mode.
  const manageId = productId ?? createdId;
  const justCreated = productId === null && createdId !== null;

  return (
    <Sheet
      open={open}
      onClose={handleClose}
      ariaLabel={manageId ? 'Produkt verwalten' : 'Neues Produkt'}
      size="lg"
    >
      {manageId ? (
        <ManageBody productId={manageId} onClose={handleClose} justCreated={justCreated} />
      ) : (
        <CreateBody onCreated={setCreatedId} onClose={handleClose} />
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
        <Icon icon={X} size={18} />
      </button>
    </DialogHeader>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// CREATE mode — the manual-stock form (parity with NeuesProduktDialog).
// ─────────────────────────────────────────────────────────────────────────

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

function CreateBody({
  onCreated,
  onClose,
}: {
  /** Called with the new product id on a successful POST — the sheet then
   *  transitions IN-PLACE to manage mode (no close + re-click). */
  onCreated: (productId: string) => void;
  /** Cancel / header-X — closes the sheet without creating. */
  onClose: () => void;
}): JSX.Element {
  const client = useApiClient() as ApiClient;
  const addToast = useToastStore((s) => s.addToast);
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

  // Kategorie (primaryCategoryId) + Online-Shop-Beschreibung + Details +
  // Briefmarken-Merkmale — progressive disclosure, hot path stays calm.
  const [category, setCategory] = useState<CategorySelection | null>(null);
  const [description, setDescription] = useState('');
  const [details, setDetails] = useState<CollectorDetailsDraft>(EMPTY_COLLECTOR_DETAILS);
  const [showBeschreibung, setShowBeschreibung] = useState(false);
  const [stampErhaltung, setStampErhaltung] = useState<StampErhaltung | null>(null);
  const [stampMinr, setStampMinr] = useState('');

  // Progressive disclosure for the cooler fields — the hot path (Bezeichnung,
  // Preis, Kategorie, Foto) stays first and uncluttered; Merkmale (Art/Zustand/
  // Gewicht/Steuerart) and Lagerort open on demand.
  const [showMerkmale, setShowMerkmale] = useState(false);
  const [showLagerort, setShowLagerort] = useState(false);

  const valid =
    name.trim().length > 0 &&
    sku.trim().length > 0 &&
    isMoneyInput(acquisitionCostEur.trim()) &&
    isMoneyInput(listPriceEur.trim()) &&
    (weightGrams.trim().length === 0 || isMoneyInput(weightGrams.trim(), 3)) &&
    isOriginCountryValid(details);

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
      if (description.trim().length > 0) body.descriptionDe = description.trim();

      const res = await client.request<CreatedResponse>('POST', '/api/products', body);

      // ── Non-fatal follow-ups: Kategorie, Details, Briefmarken-Merkmale ──
      // Each runs separately so one missing server feature never undoes the
      // created product; failures surface as honest toasts.
      if (category) {
        try {
          await categoriesApi.setForProduct(client, res.id, {
            categoryIds: [category.id],
            primaryCategoryId: category.id,
          });
        } catch {
          addToast({
            tone: 'alert',
            title: 'Kategorie nicht gespeichert',
            body: `${res.sku}: Kategorie später im Produkt unter „Details" setzen.`,
          });
        }
      }
      if (hasCollectorDetails(details)) {
        const full = buildDetailsUpdate('', details);
        const patch: ProductUpdateBody = {};
        if (full.period) patch.period = full.period;
        if (typeof full.yearMintedFrom === 'number') patch.yearMintedFrom = full.yearMintedFrom;
        if (typeof full.yearMintedTo === 'number') patch.yearMintedTo = full.yearMintedTo;
        if (full.originCountry) patch.originCountry = full.originCountry;
        if (full.catalogReference) patch.catalogReference = full.catalogReference;
        if (Object.keys(patch).length > 0) {
          try {
            await productsApi.update(client, res.id, patch);
          } catch {
            addToast({
              tone: 'alert',
              title: 'Details nicht gespeichert',
              body: `${res.sku}: Epoche/Prägejahr/Herkunft später unter „Details" nachtragen.`,
            });
          }
        }
      }
      if (stampErhaltung !== null || stampMinr.trim().length > 0) {
        const stampPatch: Record<string, unknown> = {};
        if (stampErhaltung !== null) stampPatch.stampErhaltung = stampErhaltung;
        if (stampMinr.trim().length > 0) stampPatch.stampMinr = Number.parseInt(stampMinr, 10);
        try {
          await client.request('PUT', `/api/products/${encodeURIComponent(res.id)}`, stampPatch);
        } catch {
          addToast({
            tone: 'alert',
            title: 'Briefmarken-Merkmale nicht gespeichert',
            body: `${res.sku}: Erhaltung/MiNr. später unter „Details" nachtragen.`,
          });
        }
      }

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

      // Stay open and transition IN-PLACE to manage mode for the just-created
      // product — the operator continues with Fotos / Preis / Etikett in this
      // same sheet (no close + re-click, no auto-navigate to /fotos). Finishing
      // is now explicit via the header close X.
      onCreated(res.id);
    } catch (err) {
      const msg = describeError(err);
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
      <DialogBody style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {/* ── Hot path — the 4 things every product needs, first & uncluttered:
            Bezeichnung · Verkaufspreis (+ Einkaufswert) · Kategorie · (Foto folgt). ── */}
        <Field label="Bezeichnung" required>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Goldring 585 mit Brillant"
          />
        </Field>

        <div style={TWO_COL}>
          <Field label="Verkaufspreis €" required>
            <Input
              mono
              inputMode="decimal"
              value={listPriceEur}
              onChange={(e) => setListPriceEur(e.target.value)}
              placeholder="0,00"
            />
          </Field>
          <Field label="Einkaufswert €" required>
            <Input
              mono
              inputMode="decimal"
              value={acquisitionCostEur}
              onChange={(e) => setAcquisitionCostEur(e.target.value)}
              placeholder="0,00"
            />
          </Field>
        </div>

        <CategoryPickerField value={category?.id ?? null} onChange={setCategory} disabled={busy} />
        <StampAttributeFields
          pathSlugs={category?.pathSlugs ?? []}
          erhaltung={stampErhaltung}
          minr={stampMinr}
          onErhaltungChange={setStampErhaltung}
          onMinrChange={setStampMinr}
          disabled={busy}
        />

        {/* SKU is auto-assigned — shown plainly, regenerate on demand. The
            operator rarely edits it, so it sits just below the hot path. */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: 'var(--space-2)',
            alignItems: 'end',
          }}
        >
          <Field label="SKU / Artikelnr. (automatisch)" required>
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

        {/* ── Merkmale — Art · Zustand · Gewicht · Steuerart (progressive). ── */}
        <button
          type="button"
          aria-expanded={showMerkmale}
          onClick={() => setShowMerkmale((o) => !o)}
          style={DISCLOSE_ROW}
        >
          <span style={{ color: 'var(--w14-ink-aged)' }}>
            Merkmale — Art · Zustand · Gewicht · Steuerart
          </span>
          <span aria-hidden style={{ color: 'var(--w14-ink-faded)', flexShrink: 0 }}>
            {showMerkmale ? '▾' : '▸'}
          </span>
        </button>
        {showMerkmale && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div style={TWO_COL}>
              <Field label="Art">
                <Select value={itemType} onChange={(e) => setItemType(e.target.value as ItemType)}>
                  {ITEM_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Zustand">
                <Select
                  value={condition}
                  onChange={(e) => setCondition(e.target.value as Condition)}
                >
                  {CONDITION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
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
          </div>
        )}

        {/* ── Lagerort (optional, progressive). ── */}
        <button
          type="button"
          aria-expanded={showLagerort}
          onClick={() => setShowLagerort((o) => !o)}
          style={DISCLOSE_ROW}
        >
          <span style={{ color: 'var(--w14-ink-aged)' }}>
            Lagerort (optional)
            {locUnit.trim() || locDrawer.trim() || locPosition.trim() ? ' · gesetzt' : ''}
          </span>
          <span aria-hidden style={{ color: 'var(--w14-ink-faded)', flexShrink: 0 }}>
            {showLagerort ? '▾' : '▸'}
          </span>
        </button>
        {showLagerort && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 'var(--space-3)',
            }}
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
        )}

        {/* Beschreibung & Details — collapsed by default (hot path stays calm). */}
        <button
          type="button"
          aria-expanded={showBeschreibung}
          onClick={() => setShowBeschreibung((o) => !o)}
          style={DISCLOSE_ROW}
        >
          <span style={{ color: 'var(--w14-ink-aged)' }}>
            Beschreibung & Details (Online-Shop)
            {description.trim().length > 0 || hasCollectorDetails(details) ? ' · ausgefüllt' : ''}
          </span>
          <span aria-hidden style={{ color: 'var(--w14-ink-faded)', flexShrink: 0 }}>
            {showBeschreibung ? '▾' : '▸'}
          </span>
        </button>
        {showBeschreibung && (
          <BeschreibungDetailsFields
            description={description}
            onDescriptionChange={setDescription}
            details={details}
            onDetailsChange={setDetails}
            defaultDetailsOpen={hasCollectorDetails(details)}
            disabled={busy}
          />
        )}

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
  justCreated = false,
}: { productId: string; onClose: () => void; justCreated?: boolean }): JSX.Element {
  const api = useApiClient();
  const detailQ = useQuery({
    queryKey: productDetailQueryKey(productId),
    queryFn: () => productsApi.get(api, productId),
    staleTime: 10_000,
  });

  const product = detailQ.data;
  // Share the EXACT photos query key FotosSection uses (TanStack dedupes on the
  // key) so the lifecycle chip can reflect real photo presence — a DRAFT with
  // photos but no price is "Fotos", not "Entwurf" — with no second network read.
  const photosQ = useQuery({
    queryKey: ['products', productId, 'photos'],
    queryFn: () => photosApi.listForProduct(api, productId),
    staleTime: 10_000,
  });
  const stage = product
    ? deriveLifecycleStage({
        status: product.status,
        listPriceEur: product.listPriceEur,
        photoCount: photosQ.data?.items.length ?? 0,
      })
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
            {justCreated && (
              <div aria-live="polite" style={{ display: 'grid', gap: 8, margin: '0 0 4px' }}>
                <p
                  style={{
                    margin: 0,
                    padding: '10px 14px',
                    borderRadius: 'var(--w14-radius-card)',
                    background: 'var(--w14-parchment-3)',
                    border: '1px solid var(--w14-gold)',
                    color: 'var(--w14-ink-aged)',
                    fontSize: '0.88rem',
                    lineHeight: 1.4,
                  }}
                >
                  <strong style={{ color: 'var(--w14-ink)' }}>Produkt angelegt.</strong> Es geht
                  hier im selben Fenster weiter: <strong>Fotos</strong>, <strong>Preis</strong>,{' '}
                  <strong>Etikett</strong>. Schließen Sie mit dem ✕ oben, wenn Sie fertig sind.
                </p>
                <EinsortierenHinweis product={product} />
              </div>
            )}
            <AccordionItem id="details" title="Details" defaultOpen={!justCreated}>
              <div style={{ display: 'grid', gap: 18 }}>
                <DetailsSection product={product} />
                <DetailsEditor key={product.updatedAt} product={product} />
              </div>
            </AccordionItem>
            <AccordionItem id="fotos" title="Fotos" defaultOpen={justCreated}>
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
            {product.status === 'DRAFT' && !product.archivedAt && (
              <AccordionItem id="loeschen" title="Artikel löschen">
                <LoeschenSection product={product} onDeleted={onClose} />
              </AccordionItem>
            )}
          </Accordion>
        )}
      </DialogBody>
    </>
  );
}

function DetailsSection({ product }: { product: ProductDetail }): JSX.Element {
  const ext = product as ProductDetailExt;
  const primary = product.categories.find((c) => c.isPrimary) ?? null;
  const stampLine = formatStampDisplay(ext.stampMinr ?? null, ext.stampErhaltung ?? null);
  const rows: Array<[string, string]> = [
    ['Art', itemTypeLabel(product.itemType)],
    ['Kategorie', primary ? primary.nameDe : '—'],
    ['Zustand', conditionLabel(product.condition)],
    [
      'Steuerart',
      TAX_TREATMENT_LABEL[product.taxTreatmentCode as TaxTreatmentCode] ?? product.taxTreatmentCode,
    ],
    ['Gewicht', product.weightGrams ? `${formatGrams(product.weightGrams)} g` : '—'],
    ['Einkaufswert', `${formatEur(product.acquisitionCostEur)} €`],
    ['Verkaufspreis', `${formatEur(product.listPriceEur)} €`],
    [
      'Lagerort',
      [product.locationStorageUnit, product.locationDrawer, product.locationPosition]
        .filter((s): s is string => !!s && s.length > 0)
        .join(' · ') || '—',
    ],
    ...(stampLine ? ([['Briefmarke', stampLine]] as Array<[string, string]>) : []),
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

/**
 * EinsortierenHinweis — the "where does it go" answer, shown plainly in the
 * just-created success path: SKU + assigned Lagerort + a one-line Sortier-Tipp
 * derived from the chosen root category. Reads the EXISTING location triplet —
 * no new bin system.
 */
function EinsortierenHinweis({ product }: { product: ProductDetail }): JSX.Element {
  const { roots } = useCategoryTree();
  const primaryId = product.categories.find((c) => c.isPrimary)?.id ?? null;
  const selection = resolveCategorySelection(roots, primaryId);
  const loc = [product.locationStorageUnit, product.locationDrawer, product.locationPosition]
    .filter((s): s is string => !!s && s.length > 0)
    .join(' · ');
  const tip = sortierTipp(selection?.rootSlug);

  return (
    <div
      style={{
        padding: '10px 14px',
        border: '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-card)',
        background: 'var(--w14-parchment-2)',
        display: 'grid',
        gap: 4,
        fontSize: '0.86rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span
          className="w14-tabular"
          style={{ fontFamily: 'var(--w14-font-mono)', fontWeight: 600 }}
        >
          {product.sku}
        </span>
        <span>
          <span style={{ color: 'var(--w14-ink-faded)' }}>Lagerort: </span>
          <strong>{loc || 'noch nicht zugewiesen'}</strong>
        </span>
      </div>
      {tip && (
        <span style={{ color: 'var(--w14-ink-faded)', fontStyle: 'italic' }}>
          Sortier-Tipp: {tip}
        </span>
      )}
    </div>
  );
}

/**
 * DetailsEditor — capture EVERYTHING the shop page shows, post-create:
 * Kategorie (primaryCategoryId), Online-Shop-Beschreibung, the Details group
 * (Epoche · Prägejahr von/bis · Herkunftsland · Katalog-Referenz) and — for
 * Briefmarken — Erhaltung + MiNr. Keyed by `product.updatedAt` upstream so a
 * fresh detail re-hydrates the drafts.
 */
function DetailsEditor({ product }: { product: ProductDetail }): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const { roots } = useCategoryTree();
  const ext = product as ProductDetailExt;

  const initialPrimaryId = product.categories.find((c) => c.isPrimary)?.id ?? null;
  const [categoryId, setCategoryId] = useState<string | null>(initialPrimaryId);
  const [description, setDescription] = useState(product.descriptionDe ?? '');
  const [details, setDetails] = useState<CollectorDetailsDraft>({
    period: product.period ?? '',
    yearFrom: product.yearMintedFrom != null ? String(product.yearMintedFrom) : '',
    yearTo: product.yearMintedTo != null ? String(product.yearMintedTo) : '',
    originCountry: product.originCountry ?? '',
    catalogReference: product.catalogReference ?? '',
  });
  const [erhaltung, setErhaltung] = useState<StampErhaltung | null>(ext.stampErhaltung ?? null);
  const [minr, setMinr] = useState(ext.stampMinr != null ? String(ext.stampMinr) : '');
  const [busy, setBusy] = useState(false);

  const selection = resolveCategorySelection(roots, categoryId);
  const stampDirty =
    (ext.stampErhaltung ?? null) !== erhaltung ||
    (ext.stampMinr != null ? String(ext.stampMinr) : '') !== minr.trim();
  const canSave = isOriginCountryValid(details) && !busy;

  async function save(): Promise<void> {
    if (!canSave) return;
    setBusy(true);
    try {
      // 1) Beschreibung + Details — the typed PUT (explicit null clears).
      await productsApi.update(api, product.id, buildDetailsUpdate(description, details));

      // 2) Kategorie → primaryCategoryId (only when actually changed).
      if (categoryId !== initialPrimaryId) {
        await categoriesApi.setForProduct(api, product.id, {
          categoryIds: categoryId ? [categoryId] : [],
          primaryCategoryId: categoryId,
        });
      }

      // 3) Briefmarken-Merkmale — SEPARATE PUT with its own catch, so an api
      //    that does not yet accept stampErhaltung/stampMinr never undoes 1+2.
      if (stampDirty) {
        try {
          await api.request('PUT', `/api/products/${encodeURIComponent(product.id)}`, {
            stampErhaltung: erhaltung,
            stampMinr: minr.trim().length > 0 ? Number.parseInt(minr, 10) : null,
          });
        } catch {
          addToast({
            tone: 'alert',
            title: 'Briefmarken-Merkmale nicht gespeichert',
            body: 'Erhaltung/MiNr. konnte der Server noch nicht annehmen — Rest ist gespeichert.',
          });
        }
      }

      addToast({ tone: 'success', title: 'Details gespeichert', body: product.sku });
      await qc.invalidateQueries({ queryKey: productDetailQueryKey(product.id) });
      await qc.invalidateQueries({ queryKey: ['products', 'list'] });
    } catch (err) {
      const msg =
        err instanceof ApiError ? describeError(err) : 'Verbindung gestört — bitte erneut versuchen.';
      addToast({ tone: 'alert', title: 'Speichern fehlgeschlagen', body: msg });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <CategoryPickerField
        value={categoryId}
        onChange={(sel) => setCategoryId(sel?.id ?? null)}
        disabled={busy}
      />
      <StampAttributeFields
        pathSlugs={selection?.pathSlugs ?? []}
        erhaltung={erhaltung}
        minr={minr}
        onErhaltungChange={setErhaltung}
        onMinrChange={setMinr}
        disabled={busy}
      />
      <BeschreibungDetailsFields
        description={description}
        onDescriptionChange={setDescription}
        details={details}
        onDetailsChange={setDetails}
        defaultDetailsOpen={hasCollectorDetails(details)}
        disabled={busy}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="primary" disabled={!canSave} onClick={() => void save()}>
          {busy ? 'Speichert…' : 'Beschreibung & Kategorie speichern'}
        </Button>
      </div>
    </div>
  );
}

/** Round-trip href to the deep photo route that returns to THIS product sheet. */
function fotosHref(productId: string): string {
  const returnTo = `/lager?produkt=${encodeURIComponent(productId)}`;
  return `/fotos?mode=produkt&productId=${encodeURIComponent(productId)}&returnTo=${encodeURIComponent(returnTo)}`;
}

function FotosSection({ product }: { product: ProductDetail }): JSX.Element {
  const navigate = useNavigate();
  const api = useApiClient();

  const photosQuery = useQuery({
    queryKey: ['products', product.id, 'photos'],
    queryFn: () => photosApi.listForProduct(api, product.id),
    staleTime: 10_000,
  });
  const photos = photosQuery.data?.items ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--w14-ink-faded)' }}>
        Fotos werden in der Foto-Werkstatt aufgenommen und zugeschnitten — danach landen Sie wieder
        hier beim Produkt.
      </p>

      {photos.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
            gap: 8,
          }}
        >
          {photos.map((p) => (
            <div
              key={p.id}
              style={{
                position: 'relative',
                aspectRatio: '1 / 1',
                borderRadius: 'var(--w14-radius-card)',
                overflow: 'hidden',
                border: '1px solid var(--w14-rule)',
                background: 'var(--w14-parchment-3)',
              }}
            >
              {p.publicUrl ? (
                <img
                  src={p.publicUrl}
                  alt={p.altTextDe ?? product.sku}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : null}
              {p.isPrimary && (
                <span
                  className="w14-smallcaps"
                  style={{
                    position: 'absolute',
                    top: 4,
                    left: 4,
                    background: 'rgba(20,14,10,0.82)',
                    color: 'var(--w14-gold)',
                    fontSize: '0.6rem',
                    letterSpacing: '0.06em',
                    padding: '2px 5px',
                    borderRadius: 'var(--w14-radius-button)',
                  }}
                >
                  Titelbild
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {photosQuery.isSuccess && photos.length === 0 && (
        <p
          style={{
            margin: 0,
            fontSize: '0.82rem',
            color: 'var(--w14-ink-faded)',
            fontStyle: 'italic',
          }}
        >
          Noch keine Fotos für dieses Produkt.
        </p>
      )}

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
        err instanceof ApiError ? describeError(err) : 'Verbindung gestört — bitte erneut versuchen.';
      addToast({ tone: 'alert', title: 'Nicht verkaufsbereit', body: msg });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
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
          Bereits verkaufsbereit ({PRODUCT_STATUS_LABEL[product.status]}). Web-Shop-Sichtbarkeit
          unter „Web & SEO".
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
        } else setError(describeError(err));
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
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 'var(--space-3)',
              marginTop: 'var(--space-2)',
            }}
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
          {product.weightGrams ? `${formatGrams(product.weightGrams)} g · ` : ''}
          {formatEur(product.listPriceEur)} €{loc ? ` · ${loc}` : ''}
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
  const [pushBusy, setPushBusy] = useState(false);

  // The product is enrolled in the eBay pipeline once it carries a state.
  const enrolled = product.ebayState !== null;
  const live = product.ebayState === 'ONLINE';

  async function enlist(): Promise<void> {
    if (busy || enrolled) return;
    setBusy(true);
    try {
      await ebayApi.transition(api, product.id, { toState: 'ENTWURF' });
      addToast({
        tone: 'success',
        title: 'In eBay-Pipeline aufgenommen',
        body: `${product.sku} — als Entwurf vorgemerkt (noch nicht live bei eBay).`,
      });
      await qc.invalidateQueries({ queryKey: productDetailQueryKey(product.id) });
      await qc.invalidateQueries({ queryKey: ['products', 'list'] });
    } catch (err) {
      const msg =
        err instanceof ApiError ? describeError(err) : 'Verbindung gestört — bitte erneut versuchen.';
      addToast({ tone: 'alert', title: 'eBay-Aufnahme fehlgeschlagen', body: msg });
    } finally {
      setBusy(false);
    }
  }

  // Real marketplace push (Sell Inventory API). When the eBay OAuth token is
  // not yet configured the server returns `configured=false` — we then show an
  // honest "token pending" toast instead of claiming a live listing.
  async function publish(): Promise<void> {
    if (pushBusy) return;
    setPushBusy(true);
    try {
      const res = await ebayApi.publish(api, product.id);
      if (!res.configured) {
        addToast({
          tone: 'alert',
          title: 'eBay-Zugang noch nicht eingerichtet',
          body: 'Der eBay-OAuth-Token steht noch aus. Sobald er hinterlegt ist, wird der Artikel direkt veröffentlicht.',
        });
      } else if (res.published) {
        const ref = res.listingId ?? res.offerId;
        addToast({
          tone: 'success',
          title: 'Bei eBay veröffentlicht',
          body: `${product.sku} ist jetzt live${ref ? ` (Angebot ${ref})` : ''}.`,
        });
        await qc.invalidateQueries({ queryKey: productDetailQueryKey(product.id) });
        await qc.invalidateQueries({ queryKey: ['products', 'list'] });
      } else {
        addToast({ tone: 'alert', title: 'eBay-Veröffentlichung unvollständig', body: res.detail });
      }
    } catch (err) {
      const msg =
        err instanceof ApiError ? describeError(err) : 'Verbindung gestört — bitte erneut versuchen.';
      addToast({ tone: 'alert', title: 'eBay-Veröffentlichung fehlgeschlagen', body: msg });
    } finally {
      setPushBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Status row — single, honest line about where the listing stands. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          padding: '10px 14px',
          background: 'var(--w14-parchment-2)',
          border: '1px solid var(--w14-rule)',
          borderRadius: 'var(--w14-radius-card)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              width: 12,
              height: 12,
              borderRadius: 999,
              background: live
                ? 'var(--w14-verdigris)'
                : enrolled
                  ? 'var(--w14-gold)'
                  : 'var(--w14-rule)',
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span
              className="w14-smallcaps"
              style={{
                letterSpacing: '0.08em',
                fontSize: '0.78rem',
                fontWeight: 600,
                color: live
                  ? 'var(--w14-verdigris)'
                  : enrolled
                    ? 'var(--w14-gold)'
                    : 'var(--w14-ink-faded)',
              }}
            >
              {enrolled
                ? `eBay: ${product.ebayState ? EBAY_STATE_LABELS[product.ebayState] : ''}`
                : 'Noch nicht bei eBay'}
            </span>
            <span
              style={{ fontSize: '0.76rem', color: 'var(--w14-ink-faded)', fontStyle: 'italic' }}
            >
              {live
                ? 'Live im eBay-Marktplatz.'
                : enrolled
                  ? 'In der eBay-Pipeline vorgemerkt — jetzt veröffentlichen.'
                  : 'Mit einem Klick in die eBay-Pipeline aufnehmen.'}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flex: '0 0 auto' }}>
          {!enrolled && (
            <Button variant="ghost" size="md" disabled={busy} onClick={() => void enlist()}>
              {busy ? 'Wird vorgemerkt…' : 'Vormerken'}
            </Button>
          )}
          {!live && (
            <Button variant="primary" size="md" disabled={pushBusy} onClick={() => void publish()}>
              {pushBusy ? 'Wird veröffentlicht…' : 'Bei eBay listen'}
            </Button>
          )}
        </div>
      </div>

      {/* Honest note — the marketplace push runs as soon as the OAuth token is set. */}
      <p
        style={{
          margin: 0,
          padding: '8px 12px',
          fontSize: '0.78rem',
          color: 'var(--w14-ink-aged)',
          background: 'var(--w14-parchment-3)',
          border: '1px dashed var(--w14-rule)',
          borderRadius: 'var(--w14-radius-card)',
          lineHeight: 1.4,
        }}
      >
        „Bei eBay listen" überträgt den Artikel (Titel, Beschreibung, Preis, Fotos) direkt an den
        eBay-Marktplatz. Solange der eBay-Zugang (OAuth-Token) noch aussteht, wird der Artikel nur
        vorgemerkt und beim ersten verfügbaren Zugang veröffentlicht.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// LÖSCHEN — destructive, DRAFT-only, type-to-confirm.
//
// The server refuses anything that is not an unsold DRAFT, but the UI is the
// first guard: only rendered for DRAFT + non-archived rows, and the operator
// must type the SKU before the button arms. On success the sheet closes and
// the catalog list refreshes.
// ─────────────────────────────────────────────────────────────────────────

function LoeschenSection({
  product,
  onDeleted,
}: {
  product: ProductDetail;
  onDeleted: () => void;
}): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);

  const armed = confirmText.trim().toUpperCase() === product.sku.toUpperCase();

  async function remove(): Promise<void> {
    if (!armed || busy) return;
    setBusy(true);
    try {
      await productsApi.remove(api, product.id);
      addToast({
        tone: 'success',
        title: 'Artikel gelöscht',
        body: `${product.sku} wurde dauerhaft entfernt.`,
      });
      await qc.invalidateQueries({ queryKey: ['products', 'list'] });
      onDeleted();
    } catch (err) {
      const msg =
        err instanceof ApiError ? describeError(err) : 'Verbindung gestört — bitte erneut versuchen.';
      addToast({ tone: 'alert', title: 'Löschen nicht möglich', body: msg });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 14,
        border: '1px solid var(--w14-wax-red)',
        borderRadius: 'var(--w14-radius-card)',
        background: 'var(--w14-parchment-2)',
      }}
    >
      <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--w14-ink-aged)', lineHeight: 1.45 }}>
        <strong style={{ color: 'var(--w14-wax-red)' }}>Achtung:</strong> Dieser Entwurf wird{' '}
        <strong>endgültig gelöscht</strong> — Fotos, eBay-Verlauf und Kategorie-Zuordnung
        inbegriffen. Dies ist nur für noch nicht verkaufte Entwürfe möglich und kann nicht
        rückgängig gemacht werden.
      </p>
      <Field label={`Zur Bestätigung die SKU eingeben: ${product.sku}`}>
        <Input
          mono
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={product.sku}
          aria-label="SKU zur Bestätigung"
        />
      </Field>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="destructive" disabled={!armed || busy} onClick={() => void remove()}>
          {busy ? 'Wird gelöscht…' : 'Artikel endgültig löschen'}
        </Button>
      </div>
    </div>
  );
}

const TWO_COL: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 'var(--space-3)',
};
const DISCLOSE_ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  width: '100%',
  minHeight: 48,
  padding: '0 12px',
  border: '1px solid var(--w14-rule)',
  borderRadius: 'var(--w14-radius-button)',
  background: 'transparent',
  fontFamily: 'var(--w14-font-body)',
  fontSize: '0.9rem',
  cursor: 'pointer',
  textAlign: 'left',
};
const MINI_LABEL: CSSProperties = {
  display: 'block',
  fontSize: '0.72rem',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--w14-ink-faded)',
};
