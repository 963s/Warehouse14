/**
 * NeuesProduktDialog — manual "Produkt anlegen" (Lager-Direkterfassung).
 *
 * The POS could only create products via the AI intake pipeline or the Ankauf
 * flow; this dialog gives the operator a focused way to enter shop-original /
 * manual stock: a STAGED form → `POST /api/products` (the api-client step-up
 * middleware prompts for a PIN when the acquisition cost crosses the
 * threshold). Creation always lands as DRAFT — the operator then opts into
 * "Im Online-Shop veröffentlichen" here, gated by the locked €0 price guard
 * (`product-publish.ts`), or finishes the lifecycle (Foto → Etikett) from Lager.
 *
 * UX (design-ux-brief §1 progressive disclosure, §3 EAS repeat-entry, §5 sizing
 * + calm copy):
 *   • progressive disclosure — three stages (Eckdaten → Preis & Steuer →
 *     Foto · Etikett · Veröffentlichen), never one giant form;
 *   • shared ui-kit primitives → modern-clean neutral surface, focus trap,
 *     ESC/backdrop close, ≥48px targets; a ≥56px primary CTA;
 *   • German-comma money fields (lib/decimal) that echo a live `1.234,56 €`
 *     as the operator types — money stays a string end-to-end, never a float;
 *   • "Speichern & weiteres anlegen" carries forward the sticky context
 *     (Art / Zustand / Steuerart / Lagerort / Online-Shop) and clears only the
 *     item-unique fields → item N+1 is a 3-field form for fast bulk entry;
 *   • an OBVIOUS "Im Online-Shop veröffentlichen" affordance, price-gated;
 *   • a clear next-steps path: anlegen → Foto → Etikett/Barcode → veröffentlichen.
 *
 * Frontend-only: every create/publish guard is reused verbatim from the shared
 * libs (decimal.ts, product-publish.ts). The €0 publish guard is NOT weakened.
 */

import { type CSSProperties, useMemo, useState } from 'react';

import {
  type ApiClient,
  type ProductUpdateBody,
  type TaxTreatmentCode,
  categoriesApi,
  productsApi,
} from '@warehouse14/api-client';
import {
  Button,
  Check,
  Checkbox,
  Dialog,
  DialogBody,
  DialogFooter,
  Field,
  Icon,
  Input,
  Select,
  Tag,
  X,
} from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { isMoneyInput, normalizeDecimal } from '../../lib/decimal.js';
import {
  CONDITION_OPTIONS,
  type Condition,
  ITEM_TYPE_OPTIONS,
  type ItemType,
} from '../../lib/item-type-label.js';
import { decidePublish, isPositivePrice } from '../../lib/product-publish.js';
import { TAX_TREATMENT_LABEL } from '../../lib/tax-treatment-label.js';
import { type StampErhaltung, formatStampDisplay, sortierTipp } from '../../lib/taxonomy-hints.js';
import { useToastStore } from '../../state/toast-store.js';

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
} from './CategoryPicker.js';

const TAX_OPTIONS: TaxTreatmentCode[] = [
  'MARGIN_25A',
  'INVESTMENT_GOLD_25C',
  'STANDARD_19',
  'REDUCED_7',
  'MIXED',
  'REVERSE_CHARGE_13B',
];

/** Live German money echo (1.234,56 €) of what the operator just typed.
 *  Display-only — the value sent to the API is the canonical dot-decimal
 *  STRING (`normalizeDecimal`), never this float. */
const EUR_FMT = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
function formatEuroEcho(raw: string, maxFrac = 2): string | null {
  if (!isMoneyInput(raw, maxFrac)) return null;
  const n = Number(normalizeDecimal(raw, maxFrac));
  return Number.isFinite(n) ? EUR_FMT.format(n) : null;
}

/* ── Stage model (progressive disclosure — brief §1/§3) ─────────────────── */
type Stage = 0 | 1 | 2;
const STAGES: ReadonlyArray<{ key: Stage; label: string }> = [
  { key: 0, label: 'Eckdaten' },
  { key: 1, label: 'Preis & Steuer' },
  { key: 2, label: 'Foto · Etikett · Online' },
];

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
  /** Called after every successful POST so the Lager list refetches — fires
   *  for each item in a "Speichern & weiteres" bulk session, too. */
  onCreated: () => void;
}): JSX.Element | null {
  const client = useApiClient() as ApiClient;
  const addToast = useToastStore((s) => s.addToast);

  const [stage, setStage] = useState<Stage>(0);

  // Item-unique fields — cleared between bulk entries.
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [weightGrams, setWeightGrams] = useState('');
  const [acquisitionCostEur, setAcquisitionCostEur] = useState('');
  const [listPriceEur, setListPriceEur] = useState('');

  // Sticky context — carried forward across "Speichern & weiteres".
  const [itemType, setItemType] = useState<ItemType>('gold_jewelry');
  const [condition, setCondition] = useState<Condition>('USED_GOOD');
  const [tax, setTax] = useState<TaxTreatmentCode>('MARGIN_25A');
  const [locUnit, setLocUnit] = useState('');
  const [locDrawer, setLocDrawer] = useState('');
  const [locPosition, setLocPosition] = useState('');
  const [publishNow, setPublishNow] = useState(false);

  // Kategorie + Beschreibung + Details + Briefmarken-Merkmale.
  // Sticky for bulk entry: Kategorie, Erhaltung, Details (a tray of same-era
  // pieces shares them); item-unique: Beschreibung + MiNr.
  const [category, setCategory] = useState<CategorySelection | null>(null);
  const [description, setDescription] = useState('');
  const [details, setDetails] = useState<CollectorDetailsDraft>(EMPTY_COLLECTOR_DETAILS);
  const [showBeschreibung, setShowBeschreibung] = useState(false);
  const [showMerkmale, setShowMerkmale] = useState(false);
  const [stampErhaltung, setStampErhaltung] = useState<StampErhaltung | null>(null);
  const [stampMinr, setStampMinr] = useState('');

  const [busy, setBusy] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);

  // The list price drives BOTH the online-shop publish gate and the margin
  // readout. A price ≤ €0,00 may never be published — the locked €0 guard lives
  // in product-publish.ts (`isPositivePrice` / `decidePublish`), reused as-is.
  const canPublish = isPositivePrice(listPriceEur);
  // Keep the toggle honest even if the price is later cleared/zeroed.
  const effectivePublish = publishNow && canPublish;

  // Calm, string-based margin readout (no float money math sent anywhere).
  const marginEcho = useMemo(() => {
    if (!isMoneyInput(acquisitionCostEur) || !isMoneyInput(listPriceEur)) return null;
    const acq = Number(normalizeDecimal(acquisitionCostEur));
    const list = Number(normalizeDecimal(listPriceEur));
    if (!Number.isFinite(acq) || !Number.isFinite(list)) return null;
    const cents = Math.round(list * 100) - Math.round(acq * 100);
    return { positive: cents >= 0, text: EUR_FMT.format(cents / 100) };
  }, [acquisitionCostEur, listPriceEur]);

  if (!open) return null;

  /** Full reset — clears everything including the carry-forward context. */
  const resetAll = (): void => {
    setName('');
    setSku('');
    setWeightGrams('');
    setAcquisitionCostEur('');
    setListPriceEur('');
    setItemType('gold_jewelry');
    setCondition('USED_GOOD');
    setTax('MARGIN_25A');
    setLocUnit('');
    setLocDrawer('');
    setLocPosition('');
    setPublishNow(false);
    setCategory(null);
    setDescription('');
    setDetails(EMPTY_COLLECTOR_DETAILS);
    setShowBeschreibung(false);
    setStampErhaltung(null);
    setStampMinr('');
    setStage(0);
  };

  /** Fast repeat-entry: keep the sticky context (Art / Zustand / Steuerart /
   *  Lagerort / Online-Shop / Kategorie / Erhaltung / Details), clear only
   *  item-unique fields → item N+1 is a 3-field form. */
  const resetForNext = (): void => {
    setName('');
    setSku('');
    setWeightGrams('');
    setAcquisitionCostEur('');
    setListPriceEur('');
    setDescription('');
    setStampMinr('');
    setStage(0);
  };

  const handleClose = (): void => {
    resetAll();
    setSessionCount(0);
    onClose();
  };

  const stage0Valid =
    name.trim().length > 0 && sku.trim().length > 0 && isOriginCountryValid(details);
  const stage1Valid =
    isMoneyInput(acquisitionCostEur) &&
    isMoneyInput(listPriceEur) &&
    (weightGrams.trim().length === 0 || isMoneyInput(weightGrams, 3));
  const valid = stage0Valid && stage1Valid;

  const reachable = (key: Stage): boolean =>
    key === 0 || (key === 1 && stage0Valid) || (key === 2 && valid);

  async function submit(keepOpen: boolean): Promise<void> {
    if (!valid || busy) return;
    setBusy(true);
    try {
      // The locked €0 guard: only flag for the storefront with a real price > 0.
      const decision = decidePublish({ publishNow, listPriceEur });
      const willPublish = decision.kind === 'publish';

      const body: Record<string, unknown> = {
        sku: sku.trim(),
        name: name.trim(),
        itemType,
        condition,
        taxTreatmentCode: tax,
        acquisitionCostEur: normalizeDecimal(acquisitionCostEur),
        listPriceEur: normalizeDecimal(listPriceEur),
        hallmarkStamps: [],
        isCommission: false,
        listedOnStorefront: willPublish,
        listedOnEbay: false,
      };
      if (weightGrams.trim().length > 0) body.weightGrams = normalizeDecimal(weightGrams, 3);
      if (locUnit.trim().length > 0) body.locationStorageUnit = locUnit.trim();
      if (locDrawer.trim().length > 0) body.locationDrawer = locDrawer.trim();
      if (locPosition.trim().length > 0) body.locationPosition = locPosition.trim();
      if (description.trim().length > 0) body.descriptionDe = description.trim();

      const res = await client.request<CreatedResponse>('POST', '/api/products', body);

      // ── Non-fatal follow-ups (Kategorie / Details / Briefmarke) — each in
      // its own try so one missing server feature never undoes the create. ──
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
            body: `${res.sku}: Kategorie später in Lager nachtragen.`,
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
              body: `${res.sku}: Epoche/Prägejahr/Herkunft später in Lager nachtragen.`,
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
            body: `${res.sku}: Erhaltung/MiNr. später in Lager nachtragen.`,
          });
        }
      }

      // Where does it go — SKU + Lagerort + Sortier-Tipp, plainly in the
      // success path (reuses the EXISTING location triplet, no new bins).
      const locLine = [locUnit.trim(), locDrawer.trim(), locPosition.trim()]
        .filter((s) => s.length > 0)
        .join(' · ');
      const tip = sortierTipp(category?.rootSlug);
      const woHin = `Lagerort: ${locLine || 'noch nicht zugewiesen'}.${tip ? ` Sortier-Tipp: ${tip}` : ''}`;

      if (willPublish) {
        addToast({
          tone: 'success',
          title: 'Produkt angelegt & im Online-Shop',
          body: `${res.sku} — jetzt online sichtbar. ${woHin}`,
        });
      } else if (decision.kind === 'draft-no-price') {
        addToast({
          tone: 'alert',
          title: 'Als Entwurf gespeichert',
          body: `${res.sku}: ein Verkaufspreis über 0,00 € ist nötig, um online zu veröffentlichen. ${woHin}`,
        });
      } else {
        addToast({
          tone: 'success',
          title: 'Produkt angelegt',
          body: `${res.sku} (Entwurf) — jetzt Foto & Etikett in Lager. ${woHin}`,
        });
      }

      onCreated();
      if (keepOpen) {
        setSessionCount((c) => c + 1);
        resetForNext();
      } else {
        handleClose();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unbekannter Fehler';
      if (/step[_-]?up/i.test(msg)) {
        addToast({
          tone: 'alert',
          title: 'PIN-Bestätigung nötig',
          body: 'Hoher Einkaufswert — bitte die PIN-Freigabe wiederholen.',
        });
      } else {
        addToast({ tone: 'alert', title: 'Anlegen fehlgeschlagen', body: msg });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      ariaLabel="Neues Produkt anlegen"
      size="md"
      closeOnBackdrop={!busy}
      closeOnEsc={!busy}
    >
      {/* ── Heading + bulk-session counter + close ─────────────────────── */}
      <div style={HEAD_ROW}>
        <div style={{ minWidth: 0 }}>
          <h2 style={HEAD_TITLE}>Neues Produkt</h2>
          <p style={HEAD_SUB}>
            Manueller Lagerzugang — Schritt für Schritt. Wird als Entwurf angelegt.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {sessionCount > 0 && (
            <span aria-live="polite" style={SESSION_BADGE}>
              <Icon icon={Check} size={14} aria-hidden /> {sessionCount} angelegt
            </span>
          )}
          <button type="button" onClick={handleClose} aria-label="Schließen" style={CLOSE_BTN}>
            <Icon icon={X} size={18} aria-hidden />
          </button>
        </div>
      </div>

      {/* ── Stage rail (progressive disclosure) ────────────────────────── */}
      <nav aria-label="Fortschritt" style={STAGE_RAIL}>
        {STAGES.map((s, i) => {
          const isReachable = reachable(s.key);
          const isActive = s.key === stage;
          return (
            <button
              key={s.key}
              type="button"
              disabled={!isReachable || busy}
              aria-current={isActive ? 'step' : undefined}
              onClick={() => isReachable && setStage(s.key)}
              style={{
                ...STAGE_TAB,
                background: isActive ? 'var(--w14-parchment-3)' : 'transparent',
                borderColor: isActive ? 'var(--w14-accent)' : 'var(--w14-rule)',
                color: isReachable ? 'var(--w14-ink)' : 'var(--w14-ink-faded)',
                opacity: isReachable ? 1 : 0.55,
                fontWeight: isActive ? 600 : 500,
                cursor: isReachable && !busy ? 'pointer' : 'not-allowed',
              }}
            >
              <span aria-hidden style={STAGE_NUM}>
                {i + 1}
              </span>
              {s.label}
            </button>
          );
        })}
      </nav>

      <DialogBody style={{ display: 'grid', gap: 'var(--space-4)' }}>
        {/* ── Stage 0 — Eckdaten ───────────────────────────────────────── */}
        {stage === 0 && (
          <>
            {/* Hot path first: Bezeichnung → Kategorie. The cooler fields move
                into a 'Merkmale' disclosure so Stage 0 opens uncluttered. */}
            <Field label="Bezeichnung" required>
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z. B. Goldring 585 mit Brillant"
              />
            </Field>

            <CategoryPickerField
              value={category?.id ?? null}
              onChange={setCategory}
              disabled={busy}
            />
            <StampAttributeFields
              pathSlugs={category?.pathSlugs ?? []}
              erhaltung={stampErhaltung}
              minr={stampMinr}
              onErhaltungChange={setStampErhaltung}
              onMinrChange={setStampMinr}
              disabled={busy}
            />

            <Field label="SKU / Artikelnr." required>
              <Input
                mono
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="RING-585-001"
              />
            </Field>

            {/* Merkmale — Art · Zustand · Gewicht (progressive disclosure). */}
            <button
              type="button"
              aria-expanded={showMerkmale}
              onClick={() => setShowMerkmale((o) => !o)}
              style={DISCLOSE_ROW}
            >
              <span style={{ color: 'var(--w14-ink-aged)' }}>
                Merkmale — Art · Zustand · Gewicht
              </span>
              <span aria-hidden style={{ color: 'var(--w14-ink-faded)', flexShrink: 0 }}>
                {showMerkmale ? '▾' : '▸'}
              </span>
            </button>
            {showMerkmale && (
              <>
                <div style={TWO_COL}>
                  <Field label="Art">
                    <Select
                      value={itemType}
                      onChange={(e) => setItemType(e.target.value as ItemType)}
                    >
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
                <Field label="Gewicht (g)">
                  <Input
                    mono
                    inputMode="decimal"
                    value={weightGrams}
                    onChange={(e) => setWeightGrams(e.target.value)}
                    placeholder="optional"
                  />
                </Field>
              </>
            )}

            {/* Beschreibung & Details — collapsed: the hot path stays calm. */}
            <button
              type="button"
              aria-expanded={showBeschreibung}
              onClick={() => setShowBeschreibung((o) => !o)}
              style={DISCLOSE_ROW}
            >
              <span style={{ color: 'var(--w14-ink-aged)' }}>
                Beschreibung & Details (Online-Shop)
                {description.trim().length > 0 || hasCollectorDetails(details)
                  ? ' · ausgefüllt'
                  : ''}
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
          </>
        )}

        {/* ── Stage 1 — Preis & Steuer ─────────────────────────────────── */}
        {stage === 1 && (
          <>
            <div style={TWO_COL}>
              <Field
                label="Einkaufswert €"
                required
                {...(formatEuroEcho(acquisitionCostEur)
                  ? { hint: formatEuroEcho(acquisitionCostEur) as string }
                  : {})}
              >
                <Input
                  mono
                  inputMode="decimal"
                  value={acquisitionCostEur}
                  onChange={(e) => setAcquisitionCostEur(e.target.value)}
                  placeholder="0,00"
                />
              </Field>
              <Field
                label="Verkaufspreis €"
                required
                {...(formatEuroEcho(listPriceEur)
                  ? { hint: formatEuroEcho(listPriceEur) as string }
                  : {})}
              >
                <Input
                  mono
                  inputMode="decimal"
                  value={listPriceEur}
                  onChange={(e) => setListPriceEur(e.target.value)}
                  placeholder="0,00"
                />
              </Field>
            </div>

            {/* Calm margin readout — its own quiet zone, no box-in-box. */}
            {marginEcho && (
              <div style={MARGIN_ROW}>
                <span style={MINI_LABEL}>Marge (kalkulatorisch)</span>
                <span
                  className="w14-tabular"
                  style={{
                    fontFamily: 'var(--w14-font-mono)',
                    fontSize: '1.05rem',
                    fontWeight: 600,
                    color: marginEcho.positive ? 'var(--w14-verdigris)' : 'var(--w14-wax-red)',
                  }}
                >
                  {marginEcho.text}
                </span>
              </div>
            )}

            <Field label="Steuerart">
              <Select value={tax} onChange={(e) => setTax(e.target.value as TaxTreatmentCode)}>
                {TAX_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {TAX_TREATMENT_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>

            <div>
              <span style={MINI_LABEL}>Lagerort (optional)</span>
              <div style={THREE_COL}>
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
          </>
        )}

        {/* ── Stage 2 — Foto · Etikett · Online ────────────────────────── */}
        {stage === 2 && (
          <>
            {/* Recognition-over-recall summary before the commit — incl. the
                "where does it go" facts: Kategorie + Lagerort + Briefmarke. */}
            <div style={{ display: 'grid', gap: 8 }}>
              <SummaryRow label="Bezeichnung" value={name.trim() || '—'} />
              <SummaryRow label="SKU" value={sku.trim() || '—'} mono />
              <SummaryRow label="Verkaufspreis" value={formatEuroEcho(listPriceEur) ?? '—'} mono />
              <SummaryRow
                label="Kategorie"
                value={category ? category.pathNames.join(' › ') : '—'}
              />
              <SummaryRow
                label="Lagerort"
                value={
                  [locUnit.trim(), locDrawer.trim(), locPosition.trim()]
                    .filter((s) => s.length > 0)
                    .join(' · ') || 'noch nicht zugewiesen'
                }
                mono
              />
              {formatStampDisplay(
                stampMinr.trim().length > 0 ? Number.parseInt(stampMinr, 10) : null,
                stampErhaltung,
              ) && (
                <SummaryRow
                  label="Briefmarke"
                  value={
                    formatStampDisplay(
                      stampMinr.trim().length > 0 ? Number.parseInt(stampMinr, 10) : null,
                      stampErhaltung,
                    ) as string
                  }
                />
              )}
            </div>

            {/* The clear add → Foto → Etikett/Barcode → veröffentlichen path. */}
            <ol style={NEXT_STEPS}>
              <li style={NEXT_STEP_LI}>
                <Icon icon={Check} size={15} aria-hidden /> Produkt anlegen (Entwurf)
              </li>
              <li style={NEXT_STEP_LI}>
                <Icon icon={Tag} size={15} aria-hidden /> In Lager: Foto aufnehmen, dann Etikett /
                Barcode drucken
              </li>
              <li style={NEXT_STEP_LI}>
                <Icon icon={Tag} size={15} aria-hidden /> Veröffentlichen — hier sofort online oder
                später aus Lager
              </li>
            </ol>

            {/* OBVIOUS online-shop affordance — price-gated (the €0 guard).
                The Checkbox owns the <label> + input; this box is just the
                gold-bordered, state-reactive container around it. */}
            <div
              style={{
                ...PUBLISH_BOX,
                borderColor: effectivePublish ? 'var(--w14-verdigris)' : 'var(--w14-rule)',
                background: effectivePublish ? 'var(--w14-parchment-3)' : 'transparent',
                opacity: canPublish ? 1 : 0.65,
              }}
            >
              <Checkbox
                checked={effectivePublish}
                disabled={!canPublish || busy}
                onChange={(e) => setPublishNow(e.target.checked)}
                label={
                  <span style={{ display: 'grid', gap: 2 }}>
                    <span style={{ fontWeight: 600, color: 'var(--w14-ink)' }}>
                      Im Online-Shop veröffentlichen
                    </span>
                    <span style={{ fontSize: '0.82rem', color: 'var(--w14-ink-faded)' }}>
                      {canPublish
                        ? 'Sofort im Online-Shop sichtbar — statt nur als Entwurf.'
                        : 'Erst möglich, wenn ein Verkaufspreis über 0,00 € hinterlegt ist.'}
                    </span>
                  </span>
                }
              />
            </div>
          </>
        )}
      </DialogBody>

      {/* ── Footer: quiet ghost left, big CTAs right (reverse-Fitts) ────── */}
      <DialogFooter style={{ justifyContent: 'space-between' }}>
        <Button variant="ghost" disabled={busy} onClick={handleClose}>
          Abbrechen
        </Button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          {stage > 0 && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setStage((s) => (s - 1) as Stage)}
            >
              Zurück
            </Button>
          )}

          {stage < 2 ? (
            <Button
              variant="primary"
              size="lg"
              disabled={busy || (stage === 0 ? !stage0Valid : !stage1Valid)}
              style={{ minHeight: 56, minWidth: 140 }}
              onClick={() => setStage((s) => (s + 1) as Stage)}
            >
              Weiter
            </Button>
          ) : (
            <>
              {/* Fast repeat-entry: save and immediately start the next item. */}
              <Button variant="ghost" disabled={!valid || busy} onClick={() => void submit(true)}>
                {busy ? 'Speichert…' : 'Speichern & weiteres'}
              </Button>
              <Button
                variant="primary"
                size="lg"
                disabled={!valid || busy}
                style={{ minHeight: 56, minWidth: 150 }}
                onClick={() => void submit(false)}
              >
                {busy ? 'Speichert…' : effectivePublish ? 'Anlegen & online' : 'Anlegen'}
              </Button>
            </>
          )}
        </div>
      </DialogFooter>
    </Dialog>
  );
}

function SummaryRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <div style={SUMMARY_ROW}>
      <span style={MINI_LABEL}>{label}</span>
      <span
        className={mono ? 'w14-tabular' : undefined}
        style={{
          fontFamily: mono ? 'var(--w14-font-mono)' : 'var(--w14-font-body)',
          fontSize: '0.95rem',
          color: 'var(--w14-ink)',
          textAlign: 'right',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: '60%',
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ── styles ────────────────────────────────────────────────────────────────
const HEAD_ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
  padding: '18px 20px 0',
};
const HEAD_TITLE: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--w14-font-display)',
  fontWeight: 600,
  fontSize: '1.3rem',
};
const HEAD_SUB: CSSProperties = {
  margin: '4px 0 0',
  color: 'var(--w14-ink-faded)',
  fontSize: '0.85rem',
};
const SESSION_BADGE: CSSProperties = {
  flexShrink: 0,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  fontSize: '0.78rem',
  fontFamily: 'var(--w14-font-mono)',
  color: 'var(--w14-verdigris)',
  border: '1px solid var(--w14-verdigris)',
  borderRadius: 'var(--w14-radius-button)',
  padding: '4px 8px',
  whiteSpace: 'nowrap',
};
const CLOSE_BTN: CSSProperties = {
  width: 48,
  height: 48,
  flex: '0 0 auto',
  border: 'none',
  background: 'transparent',
  color: 'var(--w14-ink-faded)',
  borderRadius: 'var(--w14-radius-button)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};
const STAGE_RAIL: CSSProperties = {
  display: 'flex',
  gap: 6,
  padding: '14px 20px 0',
};
const STAGE_TAB: CSSProperties = {
  flex: 1,
  minHeight: 48,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: '0 8px',
  border: '1px solid',
  borderRadius: 'var(--w14-radius-button)',
  fontFamily: 'var(--w14-font-body)',
  fontSize: '0.82rem',
  transition:
    'background-color var(--w14-dur-short) var(--w14-ease-curator),' +
    ' border-color var(--w14-dur-short) var(--w14-ease-curator)',
};
const STAGE_NUM: CSSProperties = {
  fontFamily: 'var(--w14-font-mono)',
  fontSize: '0.75rem',
  color: 'var(--w14-ink-faded)',
};
const TWO_COL: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 'var(--space-3)',
};
const THREE_COL: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr',
  gap: 'var(--space-3)',
  marginTop: 'var(--space-2)',
};
const MINI_LABEL: CSSProperties = {
  display: 'block',
  fontSize: '0.72rem',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--w14-ink-faded)',
};
const MARGIN_ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 12,
  padding: '10px 0',
  borderTop: '1px solid var(--w14-rule)',
  borderBottom: '1px solid var(--w14-rule)',
};
const SUMMARY_ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 12,
};
const NEXT_STEPS: CSSProperties = {
  display: 'grid',
  gap: 8,
  margin: 0,
  padding: 0,
  listStyle: 'none',
  fontSize: '0.86rem',
  color: 'var(--w14-ink-aged)',
};
const NEXT_STEP_LI: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};
const PUBLISH_BOX: CSSProperties = {
  display: 'block',
  padding: '12px 14px',
  border: '1px solid',
  borderRadius: 'var(--w14-radius-card)',
  transition: 'border-color var(--w14-dur-short) var(--w14-ease-curator)',
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
