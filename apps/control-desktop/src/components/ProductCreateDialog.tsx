/**
 * ProductCreateDialog — Owner Desktop "Neuer Artikel (Entwurf)" (Track B5 depth).
 *
 * The keyboard equivalent of the Jarvis `create_product` voice tool: it creates
 * a DRAFT product via POST /api/products (productsApi.create, which always makes
 * a DRAFT). A draft is NOT sellable and touches no fiscal state until the owner
 * reviews it and publishes it (DRAFT → AVAILABLE from the Lager row).
 *
 * Only name, type and price are required. The SKU is generated locally, and the
 * intake-locked fields (Einkaufspreis, Steuersatz) default to provisional values
 * the owner verifies before publishing — precise buy-ins belong in the Ankauf
 * flow. Shares the create-dialog overlay chrome.
 */

import { type CSSProperties, useEffect, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import {
  ApiError,
  type Metal,
  type ProductConditionCode,
  type ProductItemType,
  productsApi,
} from '@warehouse14/api-client';
import { Button, DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';
import { describeError } from '@warehouse14/i18n-de';

import { useApiClient } from '../api-context.js';
import { isStepUpCancelled } from '../state/step-up-store.js';

const ITEM_TYPES: ReadonlyArray<[ProductItemType, string]> = [
  ['gold_coin', 'Goldmünze'],
  ['gold_bar', 'Goldbarren'],
  ['gold_jewelry', 'Goldschmuck'],
  ['silver_coin', 'Silbermünze'],
  ['silver_bar', 'Silberbarren'],
  ['silver_jewelry', 'Silberschmuck'],
  ['platinum_coin', 'Platinmünze'],
  ['platinum_bar', 'Platinbarren'],
  ['platinum_jewelry', 'Platinschmuck'],
  ['antique', 'Antiquität'],
  ['watch', 'Uhr'],
  ['other', 'Sonstiges'],
];
const CONDITIONS: ReadonlyArray<[ProductConditionCode, string]> = [
  ['NEW', 'Neu'],
  ['USED_EXCELLENT', 'Gebraucht, sehr gut'],
  ['USED_GOOD', 'Gebraucht, gut'],
  ['USED_FAIR', 'Gebraucht, mäßig'],
  ['ANTIQUE_RESTORED', 'Antik, restauriert'],
  ['ANTIQUE_AS_FOUND', 'Antik, im Fundzustand'],
];
const METALS: ReadonlyArray<['' | Metal, string]> = [
  ['', 'Kein Metall'],
  ['gold', 'Gold'],
  ['silver', 'Silber'],
  ['platinum', 'Platin'],
  ['palladium', 'Palladium'],
];

const PRICE_RE = /^[0-9]+(\.[0-9]{1,2})?$/;

const label: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: '0.78rem',
  color: 'var(--w14-ink-faded)',
};
const control: CSSProperties = {
  padding: '8px 10px',
  border: '1px solid var(--w14-ink-faded)',
  borderRadius: 'var(--w14-radius-button)',
  background: 'var(--w14-parchment)',
  color: 'var(--w14-ink)',
  fontFamily: 'var(--w14-font-body)',
  fontSize: '0.95rem',
};

/** A short, unique, human-readable SKU for a manually-created draft. */
function generateDraftSku(): string {
  return `M-${crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
}

export function ProductCreateDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { client } = useApiClient();
  const qc = useQueryClient();

  const [name, setName] = useState('');
  const [itemType, setItemType] = useState<ProductItemType>('gold_coin');
  const [listPriceEur, setListPriceEur] = useState('');
  const [metal, setMetal] = useState<'' | Metal>('gold');
  const [weightGrams, setWeightGrams] = useState('');
  const [condition, setCondition] = useState<ProductConditionCode>('USED_GOOD');
  const [acquisitionCostEur, setAcquisitionCostEur] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const priceValid = PRICE_RE.test(listPriceEur.trim());
  const weightValid = weightGrams.trim() === '' || PRICE_RE.test(weightGrams.trim());
  const costValid = acquisitionCostEur.trim() === '' || PRICE_RE.test(acquisitionCostEur.trim());
  const canSave = name.trim().length >= 2 && priceValid && weightValid && costValid && !busy;

  async function save(): Promise<void> {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await productsApi.create(client, {
        sku: generateDraftSku(),
        itemType,
        name: name.trim(),
        listPriceEur: listPriceEur.trim(),
        // Provisional + intake-locked; the owner verifies before publishing.
        acquisitionCostEur: acquisitionCostEur.trim() || '0.00',
        taxTreatmentCode: 'MARGIN_25A',
        condition,
        ...(metal ? { metal } : {}),
        ...(weightGrams.trim() ? { weightGrams: weightGrams.trim() } : {}),
      });
      await qc.invalidateQueries({ queryKey: ['products'] });
      onClose();
    } catch (err) {
      if (isStepUpCancelled(err) || (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED')) {
        setError('Die PIN-Bestätigung wurde abgebrochen.');
      } else {
        setError(describeError(err));
      }
      setBusy(false);
    }
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: backdrop-overlay modal; a native <dialog> needs imperative showModal()/focus-trap wiring beyond this scope.
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click dismisses; Esc is handled by a window keydown listener.
    <div
      role="dialog"
      aria-modal="true"
      onClick={() => {
        if (!busy) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--w14-overlay)',
        zIndex: 1050,
        display: 'grid',
        placeItems: 'center',
        padding: 24,
      }}
    >
      <ParchmentCard
        padding="lg"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(560px, 100%)', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1.3rem',
          }}
        >
          Neuer Artikel
        </h2>
        <p style={{ margin: '4px 0 0', color: 'var(--w14-ink-faded)', fontSize: '0.88rem' }}>
          Legt einen Entwurf an. Der Artikel ist noch nicht verkäuflich; Einkaufspreis und Steuersatz
          sind vorläufig und werden vor der Veröffentlichung geprüft.
        </p>
        <DiamondRule />

        <div style={{ display: 'grid', gap: 12 }}>
          <label style={label}>
            Bezeichnung
            <input
              className="w14cd-focusable"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              placeholder="z. B. Goldmünze 20 Mark 1913"
              style={control}
              // biome-ignore lint/a11y/noAutofocus: first field of a deliberately-opened create dialog.
              autoFocus
            />
          </label>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ ...label, flex: '1 1 200px' }}>
              Art
              <select
                className="w14cd-focusable"
                value={itemType}
                onChange={(e) => setItemType(e.target.value as ProductItemType)}
                style={control}
              >
                {ITEM_TYPES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ ...label, flex: '1 1 140px' }}>
              Metall
              <select
                className="w14cd-focusable"
                value={metal}
                onChange={(e) => setMetal(e.target.value as '' | Metal)}
                style={control}
              >
                {METALS.map(([v, l]) => (
                  <option key={v || 'none'} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ ...label, flex: '1 1 150px' }}>
              Verkaufspreis (€)
              <input
                className="w14cd-focusable"
                value={listPriceEur}
                onChange={(e) => setListPriceEur(e.target.value)}
                inputMode="decimal"
                placeholder="1234.56"
                style={{
                  ...control,
                  borderColor:
                    listPriceEur && !priceValid ? 'var(--w14-wax-red)' : 'var(--w14-ink-faded)',
                }}
              />
            </label>
            <label style={{ ...label, flex: '1 1 150px' }}>
              Einkaufspreis (€)
              <input
                className="w14cd-focusable"
                value={acquisitionCostEur}
                onChange={(e) => setAcquisitionCostEur(e.target.value)}
                inputMode="decimal"
                placeholder="optional"
                style={{
                  ...control,
                  borderColor:
                    acquisitionCostEur && !costValid
                      ? 'var(--w14-wax-red)'
                      : 'var(--w14-ink-faded)',
                }}
              />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ ...label, flex: '1 1 140px' }}>
              Gewicht (g)
              <input
                className="w14cd-focusable"
                value={weightGrams}
                onChange={(e) => setWeightGrams(e.target.value)}
                inputMode="decimal"
                placeholder="optional"
                style={{
                  ...control,
                  borderColor:
                    weightGrams && !weightValid ? 'var(--w14-wax-red)' : 'var(--w14-ink-faded)',
                }}
              />
            </label>
            <label style={{ ...label, flex: '1 1 200px' }}>
              Zustand
              <select
                className="w14cd-focusable"
                value={condition}
                onChange={(e) => setCondition(e.target.value as ProductConditionCode)}
                style={control}
              >
                {CONDITIONS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {error && (
          <p role="alert" style={{ color: 'var(--w14-wax-red)', margin: '14px 0 0', fontSize: '0.9rem' }}>
            {error}
          </p>
        )}

        <DiamondRule />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <Button variant="ghost" size="md" disabled={busy} onClick={onClose}>
            Abbrechen
          </Button>
          <Button variant="primary" size="md" disabled={!canSave} onClick={() => void save()}>
            {busy ? 'Wird angelegt …' : 'Entwurf anlegen'}
          </Button>
        </div>
      </ParchmentCard>
    </div>
  );
}
