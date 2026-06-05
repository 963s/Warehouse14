/**
 * IntakeList — right column of Ankauf (Day 8).
 *
 * Contains:
 *   • The add-item inline form (collapsed by default; expands to show all
 *     fields when operator clicks "+ Stück hinzufügen").
 *   • The Roman-numbered list of already-added items.
 *   • The header total + Bezahlen CTA.
 *
 * Locked when no customer is selected — the customer-required CHECK
 * enforces this server-side; the UI lock prevents wasted data entry.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import {
  type AnkaufCondition,
  type AnkaufItemType,
  type AnkaufMetal,
  type MetalRatesResponse,
  type TaxTreatmentCode,
  customersApi,
  metalPricesApi,
} from '@warehouse14/api-client';
import { Button, DiamondRule, MoneyAmount, ParchmentCard, RomanIndex } from '@warehouse14/ui-kit';

import { evaluateKycGate } from '../../lib/ankauf-kyc-gate.js';
import { useApiClient } from '../../lib/api-context.js';
import { computeSchmelzwertEur, fromCents, sumNegotiatedCents } from '../../lib/intake-math.js';
import { TAX_TREATMENT_LABEL } from '../../lib/tax-treatment-label.js';
import {
  type IntakeItem,
  selectAnkaufCustomerId,
  selectAnkaufItems,
  useAnkaufCartStore,
} from '../../state/ankauf-cart-store.js';
import { useToastStore } from '../../state/toast-store.js';

import { EuroInput } from '../kasse/EuroInput.js';

const ITEM_TYPE_OPTIONS: Array<{ value: AnkaufItemType; label: string }> = [
  { value: 'gold_coin', label: 'Goldmünze' },
  { value: 'gold_bar', label: 'Goldbarren' },
  { value: 'gold_jewelry', label: 'Goldschmuck' },
  { value: 'silver_coin', label: 'Silbermünze' },
  { value: 'silver_bar', label: 'Silberbarren' },
  { value: 'silver_jewelry', label: 'Silberschmuck' },
  { value: 'platinum_coin', label: 'Platinmünze' },
  { value: 'platinum_bar', label: 'Platinbarren' },
  { value: 'platinum_jewelry', label: 'Platinschmuck' },
  { value: 'watch', label: 'Uhr' },
  { value: 'antique', label: 'Antiquität' },
  { value: 'other', label: 'Sonstiges' },
];

const CONDITION_OPTIONS: Array<{ value: AnkaufCondition; label: string }> = [
  { value: 'USED_GOOD', label: 'Gebraucht — gut' },
  { value: 'USED_EXCELLENT', label: 'Gebraucht — exzellent' },
  { value: 'USED_FAIR', label: 'Gebraucht — befriedigend' },
  { value: 'NEW', label: 'Neu' },
  { value: 'ANTIQUE_RESTORED', label: 'Antik — restauriert' },
  { value: 'ANTIQUE_AS_FOUND', label: 'Antik — wie gefunden' },
];

const TAX_TREATMENT_OPTIONS: TaxTreatmentCode[] = [
  'MARGIN_25A',
  'INVESTMENT_GOLD_25C',
  'STANDARD_19',
  'REDUCED_7',
];

export interface IntakeListProps {
  customerSelected: boolean;
  onOpenBezahlen: () => void;
}

export function IntakeList({ customerSelected, onOpenBezahlen }: IntakeListProps): JSX.Element {
  const items = useAnkaufCartStore(selectAnkaufItems);
  const customerId = useAnkaufCartStore(selectAnkaufCustomerId);
  const removeItem = useAnkaufCartStore((s) => s.removeItem);
  const clearItems = useAnkaufCartStore((s) => s.clearItems);

  const totalCents = useMemo(() => sumNegotiatedCents(items), [items]);
  const totalEur = fromCents(totalCents);
  const canPay = customerSelected && items.length > 0 && totalCents > 0n;

  return (
    <section
      aria-label="Ankaufstücke"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 16,
        gap: 14,
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1.4rem',
          }}
        >
          Ankaufstücke
        </h2>
        <span
          className="w14-smallcaps"
          style={{ color: 'var(--w14-ink-faded)', fontSize: '0.78rem', letterSpacing: '0.08em' }}
        >
          {items.length === 0 ? 'leer' : `${items.length} Stück${items.length === 1 ? '' : 'e'}`}
        </span>
      </header>

      {!customerSelected ? (
        <CustomerRequiredLock />
      ) : (
        <>
          {/* P1: surface the GwG §10 KYC requirement EARLY — as soon as the
              running total crosses €2.000 — so the operator can stamp the
              Ausweis up front instead of backtracking at Bezahlen. */}
          {customerId !== null && (
            <KycEarlyBanner customerId={customerId} totalCents={totalCents} />
          )}
          <AddItemForm existingTreatment={items[0]?.taxTreatmentCode ?? null} />

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
            {items.length === 0 ? (
              <EmptyList />
            ) : (
              items.map((item, idx) => (
                <ItemRow
                  key={item.tempId}
                  index={idx + 1}
                  item={item}
                  onRemove={() => removeItem(item.tempId)}
                />
              ))
            )}
          </div>

          <ParchmentCard padding="md" style={{ flexShrink: 0 }}>
            <DiamondRule label="Auszahlung" />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                padding: '8px 0',
              }}
            >
              <span
                className="w14-smallcaps"
                style={{
                  color: 'var(--w14-ink-aged)',
                  letterSpacing: '0.08em',
                  fontSize: '0.95rem',
                }}
              >
                Gesamt
              </span>
              <MoneyAmount valueEur={totalEur} emphasis />
            </div>
            <div
              style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 10, marginTop: 10 }}
            >
              <Button variant="ghost" size="md" onClick={clearItems} disabled={items.length === 0}>
                Liste leeren
              </Button>
              <Button variant="primary" size="lg" onClick={onOpenBezahlen} disabled={!canPay}>
                Bezahlen — Bar auszahlen
              </Button>
            </div>
          </ParchmentCard>
        </>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Early KYC banner (P1) — surfaces the GwG §10 requirement the moment the
// running total crosses the threshold, with an up-front "KYC bestätigen".
// UI-surfacing only; the server re-enforces KYC on finalize.
// ────────────────────────────────────────────────────────────────────────

function KycEarlyBanner({
  customerId,
  totalCents,
}: {
  customerId: string;
  totalCents: bigint;
}): JSX.Element | null {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [stamping, setStamping] = useState<boolean>(false);

  const customerQ = useQuery({
    queryKey: ['customers', customerId],
    queryFn: () => customersApi.get(api, customerId),
    staleTime: 5_000,
  });
  const customer = customerQ.data;
  const gate = evaluateKycGate(totalCents, customer ?? null);

  // Below the GwG threshold there is nothing to surface.
  if (!gate.thresholdReached) return null;

  const stamp = async (): Promise<void> => {
    if (!customer || stamping) return;
    setStamping(true);
    try {
      // PATCH requires step-up — the api-client interceptor opens the PIN modal.
      await customersApi.stampKyc(
        api,
        customer.id,
        customer.trustLevel === 'NEW' ? { promoteTrustLevelTo: 'VERIFIED' } : {},
      );
      addToast({ tone: 'success', title: 'KYC bestätigt', body: customer.fullName });
      await qc.invalidateQueries({ queryKey: ['customers', customer.id] });
    } catch {
      addToast({
        tone: 'alert',
        title: 'KYC nicht bestätigt',
        body: 'Bitte erneut versuchen.',
      });
    } finally {
      setStamping(false);
    }
  };

  if (gate.kycVerified) {
    return (
      <output
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderRadius: 'var(--w14-radius-button)',
          border: '1px solid var(--w14-rule)',
          background: 'var(--w14-parchment-2)',
          color: 'var(--w14-ink-aged)',
          fontSize: '0.85rem',
          flexShrink: 0,
        }}
      >
        <span aria-hidden style={{ color: 'var(--w14-gold)' }}>
          ✓
        </span>
        <span>KYC bestätigt — Ausweis geprüft. Auszahlung über 2.000&nbsp;€ zulässig.</span>
      </output>
    );
  }

  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '12px 14px',
        borderRadius: 'var(--w14-radius-button)',
        border: '2px solid var(--w14-gold)',
        background: 'var(--w14-parchment-2)',
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <strong style={{ fontFamily: 'var(--w14-font-display)', fontSize: '0.95rem' }}>
          Ausweisprüfung erforderlich
        </strong>
        <span style={{ color: 'var(--w14-ink-aged)', fontSize: '0.82rem' }}>
          Ankauf über 2.000&nbsp;€ — § 10 GwG verlangt eine persönliche Ausweisprüfung des
          Verkäufers. Jetzt erledigen, nicht erst beim Bezahlen.
        </span>
      </div>
      <Button
        variant="primary"
        size="md"
        onClick={stamp}
        disabled={stamping || customer === undefined}
      >
        {stamping ? 'Wird bestätigt…' : 'KYC bestätigen'}
      </Button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Add-item form (inline)
// ────────────────────────────────────────────────────────────────────────

function AddItemForm({
  existingTreatment,
}: {
  existingTreatment: TaxTreatmentCode | null;
}): JSX.Element {
  const addItem = useAnkaufCartStore((s) => s.addItem);
  const addToast = useToastStore((s) => s.addToast);

  // P2: expanded by default so the operator can type the first item immediately
  // (no extra click). The metal + Steuerklasse selections are intentionally NOT
  // cleared by reset() below, so they stick (pre-filled) for the next item.
  const [expanded, setExpanded] = useState<boolean>(true);
  const [sku, setSku] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [descriptionDe, setDescriptionDe] = useState<string>('');
  const [itemType, setItemType] = useState<AnkaufItemType>('gold_coin');
  const [metal, setMetal] = useState<AnkaufMetal | ''>('');
  const [karatCode, setKaratCode] = useState<string>('');
  const [finenessDecimal, setFinenessDecimal] = useState<string>('');
  const [weightGrams, setWeightGrams] = useState<string>('');
  const [condition, setCondition] = useState<AnkaufCondition>('USED_GOOD');
  const [taxTreatmentCode, setTaxTreatmentCode] = useState<TaxTreatmentCode>(
    existingTreatment ?? 'MARGIN_25A',
  );
  const [negotiatedPriceEur, setNegotiatedPriceEur] = useState<string>('');
  const [listPriceEur, setListPriceEur] = useState<string>('');
  const [publishImmediately, setPublishImmediately] = useState<boolean>(true);

  // Live Ankauf rate (Decision #69): the buy-side Schmelzwert hint uses the safe
  // 10-day time-weighted buy rate, NOT current spot. Degrades gracefully.
  const api = useApiClient();
  const ratesQ = useQuery<MetalRatesResponse>({
    queryKey: ['metal-prices', 'rates'],
    queryFn: () => metalPricesApi.rates(api),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const ankaufRateForSelectedMetal = useMemo<string | null>(() => {
    if (metal === '') return null;
    const found = ratesQ.data?.rates.find((r) => r.metal === metal);
    return found?.ankaufRatePerGramEur ?? null;
  }, [metal, ratesQ.data]);
  const schmelzwertEur = useMemo(
    () =>
      computeSchmelzwertEur({
        metal: metal === '' ? null : metal,
        weightGrams,
        finenessDecimal,
        pricePerGramEur: ankaufRateForSelectedMetal,
      }),
    [metal, weightGrams, finenessDecimal, ankaufRateForSelectedMetal],
  );

  const reset = (): void => {
    setSku('');
    setName('');
    setDescriptionDe('');
    setKaratCode('');
    setFinenessDecimal('');
    setWeightGrams('');
    setNegotiatedPriceEur('');
    setListPriceEur('');
    setPublishImmediately(true);
  };

  const canSubmit =
    sku.trim().length > 0 &&
    name.trim().length > 0 &&
    /^\d+(\.\d{1,2})?$/.test(negotiatedPriceEur) &&
    Number(negotiatedPriceEur) > 0 &&
    /^\d+(\.\d{1,2})?$/.test(listPriceEur) &&
    Number(listPriceEur) >= 0;

  const submit = (): void => {
    if (!canSubmit) return;
    const result = addItem({
      sku: sku.trim(),
      barcode: '',
      itemType,
      metal: metal === '' ? null : metal,
      karatCode: karatCode.trim(),
      finenessDecimal: finenessDecimal.trim(),
      weightGrams: weightGrams.trim(),
      hallmarkStamps: [],
      condition,
      taxTreatmentCode,
      name: name.trim(),
      descriptionDe: descriptionDe.trim(),
      listPriceEur: listPriceEur.trim(),
      negotiatedPriceEur: negotiatedPriceEur.trim(),
      publishImmediately,
    });
    if (result === null) {
      addToast({ tone: 'success', title: 'Stück hinzugefügt', body: sku.trim() });
      // P2: keep the form open + the metal/Steuerklasse sticky for the next item.
      reset();
      return;
    }
    if (result.kind === 'MIXED_TAX_TREATMENT') {
      addToast({
        tone: 'alert',
        title: 'Steuerklassen passen nicht zusammen',
        body: `Liste enthält ${TAX_TREATMENT_LABEL[result.existing]}; ${sku.trim()} wäre ${TAX_TREATMENT_LABEL[result.incoming]}.`,
      });
    } else {
      addToast({
        tone: 'alert',
        title: 'Ankaufpreis ungültig',
        body: 'Bitte einen positiven Betrag eingeben.',
      });
    }
  };

  if (!expanded) {
    return (
      <Button variant="primary" size="md" onClick={() => setExpanded(true)}>
        + Stück hinzufügen
      </Button>
    );
  }

  return (
    <ParchmentCard padding="md">
      <DiamondRule label="Neues Stück" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <FormField label="SKU" value={sku} onChange={setSku} required mono />
        <SelectField<AnkaufItemType>
          label="Typ"
          value={itemType}
          onChange={setItemType}
          options={ITEM_TYPE_OPTIONS}
        />
        <FormField label="Bezeichnung" value={name} onChange={setName} required colSpan={2} />
        <SelectField<AnkaufCondition>
          label="Zustand"
          value={condition}
          onChange={setCondition}
          options={CONDITION_OPTIONS}
        />
        <SelectField<TaxTreatmentCode>
          label="Steuerklasse"
          value={taxTreatmentCode}
          onChange={setTaxTreatmentCode}
          disabled={existingTreatment !== null}
          options={TAX_TREATMENT_OPTIONS.map((t) => ({ value: t, label: TAX_TREATMENT_LABEL[t] }))}
        />
        <SelectField<AnkaufMetal | ''>
          label="Metall"
          value={metal}
          onChange={setMetal}
          options={[
            { value: '', label: '—' },
            { value: 'gold', label: 'Gold' },
            { value: 'silver', label: 'Silber' },
            { value: 'platinum', label: 'Platin' },
            { value: 'palladium', label: 'Palladium' },
          ]}
        />
        <FormField label="Karat (z. B. K585)" value={karatCode} onChange={setKaratCode} mono />
        <FormField
          label="Feingehalt (0…1)"
          value={finenessDecimal}
          onChange={setFinenessDecimal}
          mono
        />
        <FormField label="Gewicht (g)" value={weightGrams} onChange={setWeightGrams} mono />
        <FormField
          label="Beschreibung"
          value={descriptionDe}
          onChange={setDescriptionDe}
          multiline
          colSpan={2}
        />
      </div>

      {/* Live Schmelzwert (Ankauf) hint — under weight/fineness, before prices. */}
      <SchmelzwertHint
        eur={schmelzwertEur}
        priceEur={ankaufRateForSelectedMetal}
        metal={metal === '' ? null : metal}
        loading={ratesQ.isLoading}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
        <EuroInput
          label="Ankaufspreis (an Verkäufer zahlen)"
          valueEur={negotiatedPriceEur}
          onValueChange={setNegotiatedPriceEur}
        />
        <EuroInput
          label="Verkaufspreis (bei Veröffentlichung)"
          valueEur={listPriceEur}
          onValueChange={setListPriceEur}
        />
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
        <input
          type="checkbox"
          checked={publishImmediately}
          onChange={(ev) => setPublishImmediately(ev.target.checked)}
        />
        <span style={{ fontFamily: 'var(--w14-font-display)', fontSize: '0.9rem' }}>
          Sofort verkaufsbereit (AVAILABLE — sonst DRAFT bis Foto)
        </span>
      </label>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
        <Button
          variant="ghost"
          size="md"
          onClick={() => {
            reset();
            setExpanded(false);
          }}
        >
          Abbrechen
        </Button>
        <Button variant="primary" size="md" onClick={submit} disabled={!canSubmit}>
          + Stück hinzufügen
        </Button>
      </div>
    </ParchmentCard>
  );
}

function SchmelzwertHint({
  eur,
  priceEur,
  metal,
  loading,
}: {
  eur: string | null;
  priceEur: string | null;
  metal: AnkaufMetal | null;
  loading: boolean;
}): JSX.Element | null {
  if (loading) return null;
  if (eur === null) return null;
  return (
    <div
      style={{
        marginTop: 14,
        padding: '10px 14px',
        background: 'var(--w14-parchment-2)',
        border: '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-card)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
      }}
    >
      <span
        className="w14-smallcaps"
        style={{ color: 'var(--w14-ink-faded)', fontSize: '0.78rem', letterSpacing: '0.08em' }}
      >
        Schmelzwert (Ankauf)
        {metal && priceEur && (
          <span style={{ marginLeft: 8, fontFamily: 'var(--w14-font-mono)', fontSize: '0.72rem' }}>
            {metal} @ {priceEur} €/g
          </span>
        )}
      </span>
      <MoneyAmount valueEur={eur} emphasis />
    </div>
  );
}

function FormField({
  label,
  value,
  onChange,
  required = false,
  mono = false,
  multiline = false,
  colSpan,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  mono?: boolean;
  multiline?: boolean;
  colSpan?: number;
}): JSX.Element {
  const style = colSpan ? { gridColumn: `span ${colSpan}` } : {};
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, ...style }}>
      <span
        className="w14-smallcaps"
        style={{ color: 'var(--w14-ink-faded)', fontSize: '0.72rem', letterSpacing: '0.08em' }}
      >
        {label}
        {required && <span style={{ color: 'var(--w14-wax-red)' }}> *</span>}
      </span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(ev) => onChange(ev.target.value)}
          rows={2}
          style={{
            border: 'none',
            outline: 'none',
            borderBottom: '1px solid var(--w14-rule)',
            background: 'transparent',
            padding: '4px',
            resize: 'vertical',
            fontFamily: 'var(--w14-font-body)',
            fontSize: '0.9rem',
            color: 'var(--w14-ink)',
          }}
        />
      ) : (
        <input
          type="text"
          value={value}
          spellCheck={false}
          onChange={(ev) => onChange(ev.target.value)}
          style={{
            border: 'none',
            outline: 'none',
            borderBottom: '1px solid var(--w14-rule)',
            background: 'transparent',
            padding: '4px',
            fontFamily: mono ? 'var(--w14-font-mono)' : 'var(--w14-font-body)',
            fontSize: '0.9rem',
            color: 'var(--w14-ink)',
          }}
        />
      )}
    </label>
  );
}

function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  disabled?: boolean;
}): JSX.Element {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span
        className="w14-smallcaps"
        style={{ color: 'var(--w14-ink-faded)', fontSize: '0.72rem', letterSpacing: '0.08em' }}
      >
        {label}
      </span>
      <select
        value={value}
        disabled={disabled}
        onChange={(ev) => onChange(ev.target.value as T)}
        style={{
          border: 'none',
          outline: 'none',
          borderBottom: '1px solid var(--w14-rule)',
          background: 'transparent',
          padding: '4px',
          fontFamily: 'var(--w14-font-body)',
          fontSize: '0.9rem',
          color: 'var(--w14-ink)',
          opacity: disabled ? 0.55 : 1,
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Existing item row
// ────────────────────────────────────────────────────────────────────────

function ItemRow({
  index,
  item,
  onRemove,
}: {
  index: number;
  item: IntakeItem;
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
      }}
    >
      <RomanIndex value={index} tone="gold" />
      <div style={{ minWidth: 0 }}>
        <span
          className="w14-tabular"
          style={{
            fontFamily: 'var(--w14-font-mono)',
            fontSize: '0.78rem',
            color: 'var(--w14-ink-faded)',
          }}
        >
          {item.sku}
        </span>
        <div
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1rem',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {item.name}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginTop: 4 }}>
          <span
            className="w14-smallcaps"
            style={{ color: 'var(--w14-ink-faded)', fontSize: '0.72rem', letterSpacing: '0.08em' }}
          >
            {TAX_TREATMENT_LABEL[item.taxTreatmentCode]}
          </span>
          {item.weightGrams && (
            <span
              className="w14-tabular"
              style={{
                fontFamily: 'var(--w14-font-mono)',
                fontSize: '0.72rem',
                color: 'var(--w14-ink-faded)',
              }}
            >
              {item.weightGrams} g
            </span>
          )}
          <span
            className="w14-smallcaps"
            style={{
              color: item.publishImmediately ? 'var(--w14-gold)' : 'var(--w14-ink-faded)',
              fontSize: '0.72rem',
              letterSpacing: '0.08em',
            }}
          >
            {item.publishImmediately ? 'sofort' : 'Entwurf'}
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
        <MoneyAmount valueEur={item.negotiatedPriceEur} emphasis />
        <button
          type="button"
          onClick={onRemove}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: '0.78rem',
            cursor: 'pointer',
            padding: 0,
            textDecoration: 'underline',
            textUnderlineOffset: 2,
          }}
        >
          entfernen
        </button>
      </div>
    </ParchmentCard>
  );
}

function CustomerRequiredLock(): JSX.Element {
  return (
    <ParchmentCard
      padding="lg"
      style={{ textAlign: 'center', flex: 1, display: 'grid', placeItems: 'center' }}
    >
      <div>
        <DiamondRule />
        <p
          style={{
            margin: '8px 0 0',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: '0.95rem',
          }}
        >
          Bitte zuerst den Verkäufer auswählen.
          <br />
          Ein Ankauf ohne identifizierte Person ist nach § 10 GwG nicht zulässig.
        </p>
      </div>
    </ParchmentCard>
  );
}

function EmptyList(): JSX.Element {
  return (
    <div
      style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}
    >
      <p
        style={{
          margin: 0,
          color: 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontStyle: 'italic',
          fontSize: '0.92rem',
        }}
      >
        Noch keine Stücke erfasst.
        <br />
        Fügen Sie eines mit dem Knopf oben hinzu.
      </p>
    </div>
  );
}
