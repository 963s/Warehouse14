/**
 * IntakeDraftsTray — Control Desktop card tray for AI Intake drafts (ADR-0015 §7
 * + Decision #48 omnichannel publishing).
 *
 * The ADMIN reviews the deterministic tax classification, fills the mandatory
 * verification note + product fields, then MANUALLY toggles each publish target
 * (Web Storefront, eBay, Social Flyer, Counter Sticker Printer) before pressing
 * EXECUTE. Nothing is auto-selected or auto-published. When the sticker target
 * is on, the POS prints the label locally on a successful publish response.
 */

import { useState } from 'react';

import type { IntakeDraftSummary, PublishTargets } from '@warehouse14/api-client';

import { useIntakeDrafts, usePublishIntakeDraft } from '../../hooks/useIntakeDrafts.js';
import { useLabelPrinter } from '../../lib/use-label-printer.js';

interface PublishFormState {
  name: string;
  sku: string;
  itemType: string;
  taxTreatmentCode: string;
  acquisitionCostEur: string;
  listPriceEur: string;
  weightGrams: string;
  karat: string;
  storageLocation: string;
  adminVerificationNote: string;
}

function emptyForm(draft: IntakeDraftSummary): PublishFormState {
  return {
    name: '',
    sku: '',
    itemType: 'gold_jewelry',
    taxTreatmentCode: draft.tax_treatment_code ?? 'STANDARD_19',
    acquisitionCostEur: '',
    listPriceEur: '',
    weightGrams: '',
    karat: '',
    storageLocation: '',
    adminVerificationNote: '',
  };
}

const DEFAULT_TARGETS: PublishTargets = {
  storefront: true,
  ebay: false,
  socialFlyer: false,
  printSticker: false,
};

function DraftCard({ draft }: { draft: IntakeDraftSummary }): JSX.Element {
  const [form, setForm] = useState<PublishFormState>(() => emptyForm(draft));
  const [targets, setTargets] = useState<PublishTargets>(DEFAULT_TARGETS);
  const publish = usePublishIntakeDraft();
  const printer = useLabelPrinter();

  const canPublish =
    draft.status === 'READY_FOR_REVIEW' &&
    form.name.trim().length > 0 &&
    form.sku.trim().length > 0 &&
    /^[0-9]+(\.[0-9]{1,2})?$/.test(form.acquisitionCostEur) &&
    /^[0-9]+(\.[0-9]{1,2})?$/.test(form.listPriceEur) &&
    form.adminVerificationNote.trim().length > 0;

  const set =
    (key: keyof PublishFormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const toggle = (key: keyof PublishTargets) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setTargets((t) => ({ ...t, [key]: e.target.checked }));

  return (
    <article className="intake-draft-card">
      <header>
        <strong>{draft.tax_treatment_code ?? 'UNCLASSIFIED'}</strong>
        <span> · {draft.status}</span>
      </header>
      {draft.classifier_explanation ? <p>{draft.classifier_explanation}</p> : null}
      {draft.german_description ? <p>{draft.german_description}</p> : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!canPublish) return;
          publish.mutate(
            {
              sessionId: draft.session_id,
              body: {
                name: form.name,
                sku: form.sku,
                itemType: form.itemType,
                taxTreatmentCode: form.taxTreatmentCode,
                acquisitionCostEur: form.acquisitionCostEur,
                listPriceEur: form.listPriceEur,
                adminVerificationNote: form.adminVerificationNote,
                targets,
                ...(form.weightGrams ? { weightGrams: form.weightGrams } : {}),
                ...(form.karat ? { karat: form.karat } : {}),
                ...(form.storageLocation ? { storageLocation: form.storageLocation } : {}),
              },
            },
            {
              onSuccess: (res) => {
                // Counter sticker printing happens locally on the POS once the
                // server confirms the publish and echoes the label payload.
                if (targets.printSticker && res.labelData) {
                  void printer.print([res.labelData]);
                }
              },
            },
          );
        }}
      >
        <label>
          Name
          <input value={form.name} onChange={set('name')} />
        </label>
        <label>
          SKU
          <input value={form.sku} onChange={set('sku')} />
        </label>
        <label>
          Artikeltyp
          <input value={form.itemType} onChange={set('itemType')} />
        </label>
        <label>
          Steuercode
          <input value={form.taxTreatmentCode} onChange={set('taxTreatmentCode')} />
        </label>
        <label>
          Einkaufspreis (EUR)
          <input
            value={form.acquisitionCostEur}
            onChange={set('acquisitionCostEur')}
            inputMode="decimal"
          />
        </label>
        <label>
          Verkaufspreis (EUR)
          <input value={form.listPriceEur} onChange={set('listPriceEur')} inputMode="decimal" />
        </label>
        <label>
          Gewicht (g)
          <input value={form.weightGrams} onChange={set('weightGrams')} inputMode="decimal" />
        </label>
        <label>
          Karat
          <input value={form.karat} onChange={set('karat')} />
        </label>
        <label>
          Lagerplatz
          <input value={form.storageLocation} onChange={set('storageLocation')} />
        </label>
        <label>
          Steuer-Prüfvermerk (Pflicht)
          <textarea value={form.adminVerificationNote} onChange={set('adminVerificationNote')} />
        </label>

        <fieldset className="intake-publish-targets">
          <legend>Veröffentlichungskanäle</legend>
          <label>
            <input type="checkbox" checked={targets.storefront} onChange={toggle('storefront')} />
            Web-Shop (warehouse14.de)
          </label>
          <label>
            <input type="checkbox" checked={targets.ebay} onChange={toggle('ebay')} />
            eBay-Angebot
          </label>
          <label>
            <input type="checkbox" checked={targets.socialFlyer} onChange={toggle('socialFlyer')} />
            Social-Media-Flyer (Instagram/Facebook)
          </label>
          <label>
            <input
              type="checkbox"
              checked={targets.printSticker}
              onChange={toggle('printSticker')}
            />
            Barcode-Etikett am Theken-Drucker
          </label>
        </fieldset>

        <button type="submit" disabled={!canPublish || publish.isPending}>
          {publish.isPending ? 'Wird ausgeführt…' : 'Veröffentlichen & ausführen'}
        </button>
        {publish.isError ? <span role="alert">Veröffentlichung fehlgeschlagen.</span> : null}
      </form>
    </article>
  );
}

export function IntakeDraftsTray(): JSX.Element {
  const { data, isLoading, isError } = useIntakeDrafts();

  if (isLoading) return <p>Lade Intake-Entwürfe…</p>;
  if (isError) return <p role="alert">Intake-Entwürfe konnten nicht geladen werden.</p>;
  if (data.length === 0) return <p>Keine Entwürfe zur Prüfung.</p>;

  return (
    <section className="intake-drafts-tray" aria-label="Intake-Entwürfe">
      {data.map((draft) => (
        <DraftCard key={draft.session_id} draft={draft} />
      ))}
    </section>
  );
}
