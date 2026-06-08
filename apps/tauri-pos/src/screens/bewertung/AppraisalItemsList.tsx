/**
 * AppraisalItemsList — left column of the Bewertung workspace.
 *
 * Roman-numbered list of items + remove buttons + running totals.
 * Status-gated: DRAFT shows "Vollständig — Angebot machen" CTA;
 * COMPLETED shows "Kunde nimmt an" + "Ablehnen".
 */

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
  ApiError,
  type AppraisalItemView,
  type AppraisalView,
  appraisalsApi,
} from '@warehouse14/api-client';
import { Button, DiamondRule, MoneyAmount, ParchmentCard, RomanIndex } from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { isMoneyInput, normalizeDecimal } from '../../lib/decimal.js';
import { itemTypeLabel } from '../../lib/item-type-label.js';
import { useToastStore } from '../../state/toast-store.js';

export interface AppraisalItemsListProps {
  appraisal: AppraisalView;
  totalAppraisedEur: string;
  editable: boolean;
  onOpenAcceptance: () => void;
}

export function AppraisalItemsList({
  appraisal,
  totalAppraisedEur,
  editable,
  onOpenAcceptance,
}: AppraisalItemsListProps): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const [completeOpen, setCompleteOpen] = useState<boolean>(false);
  const [offerEur, setOfferEur] = useState<string>('');
  const [completing, setCompleting] = useState<boolean>(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  const removeItem = async (itemId: string): Promise<void> => {
    try {
      const next = await appraisalsApi.removeItem(api, appraisal.id, itemId);
      qc.setQueryData(['appraisals', appraisal.id], next);
    } catch (err) {
      addToast({
        tone: 'alert',
        title: 'Entfernen fehlgeschlagen',
        body: err instanceof ApiError ? err.message : 'Netzwerk prüfen.',
      });
    }
  };

  const completeAppraisal = async (): Promise<void> => {
    if (!isMoneyInput(offerEur) || Number(normalizeDecimal(offerEur)) <= 0) {
      setCompleteError('Bitte Angebotswert > 0 eingeben.');
      return;
    }
    setCompleting(true);
    setCompleteError(null);
    try {
      const next = await appraisalsApi.complete(api, appraisal.id, {
        totalOfferedEur: normalizeDecimal(offerEur),
      });
      qc.setQueryData(['appraisals', appraisal.id], next);
      setCompleteOpen(false);
      onOpenAcceptance();
    } catch (err) {
      setCompleteError(err instanceof ApiError ? err.message : 'Netzwerk prüfen.');
    } finally {
      setCompleting(false);
    }
  };

  return (
    <section
      aria-label="Konvolut"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 20,
        gap: 14,
        borderRight: '1px solid var(--w14-rule)',
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
          Konvolut
        </h2>
        <span
          className="w14-smallcaps"
          style={{ color: 'var(--w14-ink-faded)', letterSpacing: '0.08em', fontSize: '0.78rem' }}
        >
          {appraisal.items.length === 0
            ? 'leer'
            : `${appraisal.items.length} Stück${appraisal.items.length === 1 ? '' : 'e'}`}
        </span>
      </header>

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
        {appraisal.items.length === 0 ? (
          <EmptyList />
        ) : (
          appraisal.items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              editable={editable}
              onRemove={() => void removeItem(item.id)}
            />
          ))
        )}
      </div>

      <ParchmentCard padding="md" style={{ flexShrink: 0 }}>
        <DiamondRule label="Summe der Einzelschätzungen" />
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
            style={{ color: 'var(--w14-ink-aged)', letterSpacing: '0.08em', fontSize: '0.95rem' }}
          >
            Gesamt
          </span>
          <MoneyAmount valueEur={totalAppraisedEur} emphasis />
        </div>

        {appraisal.totalOfferedEur && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              padding: '4px 0',
            }}
          >
            <span
              className="w14-smallcaps"
              style={{ color: 'var(--w14-gold)', letterSpacing: '0.08em', fontSize: '0.88rem' }}
            >
              Angebotswert (verhandelt)
            </span>
            <MoneyAmount valueEur={appraisal.totalOfferedEur} emphasis />
          </div>
        )}

        <div style={{ marginTop: 14, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          {editable && (
            <Button
              variant="primary"
              size="lg"
              onClick={() => setCompleteOpen(true)}
              disabled={appraisal.items.length === 0}
            >
              Vollständig — Angebot machen
            </Button>
          )}
          {appraisal.status === 'COMPLETED' && (
            <Button variant="primary" size="lg" onClick={onOpenAcceptance}>
              Kunde nimmt an
            </Button>
          )}
        </div>
      </ParchmentCard>

      {completeOpen && (
        <CompleteDialog
          totalAppraised={totalAppraisedEur}
          offerEur={offerEur}
          setOfferEur={setOfferEur}
          completing={completing}
          error={completeError}
          onCancel={() => setCompleteOpen(false)}
          onConfirm={() => void completeAppraisal()}
        />
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Row + Empty + Complete dialog
// ────────────────────────────────────────────────────────────────────────

function ItemRow({
  item,
  editable,
  onRemove,
}: {
  item: AppraisalItemView;
  editable: boolean;
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
      <RomanIndex value={item.sequenceInLot} tone="gold" />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1rem',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.name}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginTop: 4 }}>
          <span
            className="w14-smallcaps"
            style={{ color: 'var(--w14-ink-faded)', fontSize: '0.72rem', letterSpacing: '0.08em' }}
          >
            {itemTypeLabel(item.itemType)}
          </span>
          {item.weightGrams && (
            <span
              className="w14-tabular"
              style={{
                fontFamily: 'var(--w14-font-mono)',
                fontSize: '0.78rem',
                color: 'var(--w14-ink-faded)',
              }}
            >
              {item.weightGrams} g
            </span>
          )}
          {item.finenessDecimal && (
            <span
              className="w14-tabular"
              style={{
                fontFamily: 'var(--w14-font-mono)',
                fontSize: '0.78rem',
                color: 'var(--w14-ink-faded)',
              }}
            >
              {item.finenessDecimal}
            </span>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
        <MoneyAmount valueEur={item.individualAppraisedEur} emphasis />
        {editable && (
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
        )}
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
        Beginnen Sie rechts mit dem ersten Stück.
      </p>
    </div>
  );
}

function CompleteDialog({
  totalAppraised,
  offerEur,
  setOfferEur,
  completing,
  error,
  onCancel,
  onConfirm,
}: {
  totalAppraised: string;
  offerEur: string;
  setOfferEur: (v: string) => void;
  completing: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={() => {
        if (!completing) onCancel();
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
        onClick={(ev) => ev.stopPropagation()}
        style={{ width: 'min(460px, 100%)' }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1.4rem',
            textAlign: 'center',
          }}
        >
          Angebot festlegen
        </h2>
        <p
          style={{
            margin: '6px 0 0',
            textAlign: 'center',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: '0.88rem',
          }}
        >
          Schätzung: <MoneyAmount valueEur={totalAppraised} />
        </p>
        <DiamondRule label="Angebot an den Kunden" />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span
            className="w14-smallcaps"
            style={{ color: 'var(--w14-ink-faded)', fontSize: '0.74rem', letterSpacing: '0.08em' }}
          >
            Lump-Sum-Angebot (€)
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={offerEur}
            onChange={(ev) => setOfferEur(ev.target.value.replace(',', '.'))}
            placeholder="z. B. 12500.00"
            autoFocus
            style={{
              border: 'none',
              outline: 'none',
              borderBottom: '2px solid var(--w14-rule)',
              background: 'transparent',
              padding: '8px 4px',
              fontFamily: 'var(--w14-font-mono)',
              fontSize: '1.2rem',
              color: 'var(--w14-ink)',
            }}
          />
        </label>
        {error && (
          <p
            role="alert"
            style={{
              color: 'var(--w14-wax-red)',
              margin: '14px 0 0',
              fontSize: '0.92rem',
              textAlign: 'center',
            }}
          >
            {error}
          </p>
        )}
        <div style={{ marginTop: 22, display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onCancel} disabled={completing}>
            Abbrechen
          </Button>
          <Button variant="primary" onClick={onConfirm} disabled={completing}>
            {completing ? 'Bestätigt…' : 'Angebot bestätigen'}
          </Button>
        </div>
      </ParchmentCard>
    </div>
  );
}
