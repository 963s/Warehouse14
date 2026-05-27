/**
 * InventoryAdjustmentDialog — Day 9 mutation modal, Day-14 split into tabs.
 *
 *   ┌───────────────────────────────────┐
 *   │  Lager-Anpassung                  │
 *   │  «Product name» · SKU             │
 *   │ ┌──────────┬──────────────────┐   │
 *   │ │ Bestand  │ Web & SEO        │   │  ← Day-14 tabs
 *   │ └──────────┴──────────────────┘   │
 *   │  ...active tab body...            │
 *   └───────────────────────────────────┘
 *
 * Tab "Bestand" — the original Day-9 mutation surface:
 *   • LOCATION_CHANGE — physical relocation (Tresor → Vitrine)
 *   • LOST / DAMAGED — flag for the audit trail
 *   • FOUND — reverse a prior LOST flag
 *   • OPERATOR_NOTE — narrative observation
 *   Calls `productsApi.adjustInventory`; mandatory ≥ 8-char notes for the
 *   audit log. Step-up handled transparently by the ApiClient interceptor.
 *
 * Tab "Web & SEO" — Day-14 commerce surface (see WebSeoPanel.tsx):
 *   • is_published_to_web toggle
 *   • primary category picker
 *   • slug / SEO title / SEO description editor
 *   • AI button (MCP generate_seo_description)
 *   Each control owns its own TanStack mutation; no shared submit button.
 *
 * The footer Cancel/Submit pair is rendered ONLY on the Bestand tab —
 * the Web & SEO tab persists per-control inline.
 */

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import {
  ApiError,
  productsApi,
  type InventoryAdjustmentReason,
  type ProductListRow,
} from '@warehouse14/api-client';
import {
  Button,
  DiamondRule,
  ParchmentCard,
} from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { useToastStore } from '../../state/toast-store.js';

import { WebSeoPanel } from './WebSeoPanel.js';

type DialogTab = 'bestand' | 'webseo';

const REASON_OPTIONS: Array<{ value: InventoryAdjustmentReason; label: string; hint: string }> = [
  { value: 'LOCATION_CHANGE', label: 'Lagerort ändern', hint: 'Stück wird physisch verschoben.' },
  { value: 'LOST',            label: 'Als verloren markieren', hint: 'Stück fehlt im Bestand.' },
  { value: 'DAMAGED',         label: 'Als beschädigt markieren', hint: 'Stück nicht verkaufsfähig.' },
  { value: 'FOUND',           label: 'Wiedergefunden',           hint: 'Hebt vorherigen Verlust-Vermerk auf.' },
  { value: 'OPERATOR_NOTE',   label: 'Notiz hinzufügen',         hint: 'Anmerkung ohne Statusänderung.' },
];

export interface InventoryAdjustmentDialogProps {
  open: boolean;
  product: ProductListRow | null;
  onClose: () => void;
}

export function InventoryAdjustmentDialog({
  open,
  product,
  onClose,
}: InventoryAdjustmentDialogProps): JSX.Element | null {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const [reason, setReason] = useState<InventoryAdjustmentReason>('LOCATION_CHANGE');
  const [notes, setNotes] = useState<string>('');
  const [storageUnit, setStorageUnit] = useState<string>('');
  const [drawer, setDrawer] = useState<string>('');
  const [position, setPosition] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  // Day-14 tab switcher. Default to Bestand so the existing keyboard flow
  // (open → fill → submit) is unchanged for operators who never touch SEO.
  const [activeTab, setActiveTab] = useState<DialogTab>('bestand');

  // Reset + seed location from product when dialog opens.
  useEffect(() => {
    if (!open || !product) return;
    setReason('LOCATION_CHANGE');
    setNotes('');
    setStorageUnit(product.locationStorageUnit ?? '');
    setDrawer(product.locationDrawer ?? '');
    setPosition(product.locationPosition ?? '');
    setSubmitting(false);
    setError(null);
    setActiveTab('bestand');
  }, [open, product]);

  // Esc closes (unless mid-submit).
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape' && !submitting) {
        ev.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, submitting]);

  const requiresLocation = reason === 'LOCATION_CHANGE';
  const locationValid =
    storageUnit.trim().length > 0 && drawer.trim().length > 0 && position.trim().length > 0;
  const notesValid = notes.trim().length >= 8;
  const canSubmit = notesValid && (!requiresLocation || locationValid) && !submitting && product !== null;

  const submit = useCallback(async (): Promise<void> => {
    if (!canSubmit || !product) return;
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
        body: `${product.sku} — ${REASON_OPTIONS.find((o) => o.value === reason)?.label ?? reason}`,
      });

      // Invalidate the catalog so the row re-fetches with new location.
      await qc.invalidateQueries({ queryKey: ['products', 'list'] });

      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'STEP_UP_REQUIRED') {
          setError('PIN-Bestätigung wurde abgebrochen.');
        } else if (err.code === 'NOT_FOUND') {
          setError('Stück nicht mehr vorhanden — Liste wird aktualisiert.');
          void qc.invalidateQueries({ queryKey: ['products', 'list'] });
        } else {
          setError(err.message);
        }
      } else {
        setError('Verbindung gestört — bitte erneut versuchen.');
      }
    } finally {
      setSubmitting(false);
    }
  }, [addToast, api, canSubmit, drawer, notes, onClose, position, product, qc, reason, storageUnit]);

  if (!open || !product) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Lager-Anpassung"
      onClick={() => { if (!submitting) onClose(); }}
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
        // Day-14: widen when on the SEO tab — the textarea + flat-tree
        // category select need horizontal room. Keep the original
        // 520px on Bestand so the existing keyboard layout doesn't shift.
        style={{
          width: activeTab === 'webseo' ? 'min(640px, 100%)' : 'min(520px, 100%)',
          boxShadow: 'var(--w14-shadow-modal)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <h2 style={{ margin: 0, fontFamily: 'var(--w14-font-display)', fontWeight: 500, fontSize: '1.5rem', textAlign: 'center' }}>
          {activeTab === 'webseo' ? 'Web & SEO' : 'Lager-Anpassung'}
        </h2>
        <p style={{ margin: '4px 0 0', textAlign: 'center', color: 'var(--w14-ink-faded)', fontFamily: 'var(--w14-font-display)', fontStyle: 'italic', fontSize: '0.92rem' }}>
          {product.name}
          {' · '}
          <span className="w14-tabular" style={{ fontFamily: 'var(--w14-font-mono)' }}>{product.sku}</span>
        </p>

        {/* Day-14 tabs */}
        <div
          role="tablist"
          aria-label="Detail-Bereiche"
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 4,
            marginTop: 14,
            padding: 4,
            background: 'var(--w14-parchment-2)',
            border: '1px solid var(--w14-rule)',
            borderRadius: 999,
            width: 'fit-content',
            margin: '14px auto 0',
          }}
        >
          <TabChip active={activeTab === 'bestand'} label="Bestand" onClick={() => setActiveTab('bestand')} />
          <TabChip active={activeTab === 'webseo'} label="Web & SEO" onClick={() => setActiveTab('webseo')} />
        </div>

        {activeTab === 'webseo' ? (
          <div style={{ marginTop: 16 }}>
            <WebSeoPanel productId={product.id} />
          </div>
        ) : (
          <>
        <DiamondRule label="Grund" />
        <div style={{ display: 'grid', gap: 8 }}>
          {REASON_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                gap: 10,
                alignItems: 'baseline',
                padding: '6px 10px',
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
                <div style={{ fontFamily: 'var(--w14-font-display)', fontWeight: 500, fontSize: '0.92rem' }}>
                  {opt.label}
                </div>
                <div style={{ fontFamily: 'var(--w14-font-display)', fontStyle: 'italic', fontSize: '0.78rem', color: 'var(--w14-ink-faded)' }}>
                  {opt.hint}
                </div>
              </div>
            </label>
          ))}
        </div>

        {requiresLocation && (
          <>
            <DiamondRule label="Neuer Lagerort" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <Field label="Standort" placeholder="Tresor-1" value={storageUnit} onChange={setStorageUnit} />
              <Field label="Fach" placeholder="Fach-3" value={drawer} onChange={setDrawer} />
              <Field label="Position" placeholder="Pos-12" value={position} onChange={setPosition} />
            </div>
          </>
        )}

        <DiamondRule label="Notiz (≥ 8 Zeichen)" />
        <textarea
          value={notes}
          onChange={(ev) => setNotes(ev.target.value)}
          rows={3}
          placeholder="Operator-Begründung für das Audit-Log."
          maxLength={1024}
          style={{
            width: '100%',
            border: 'none',
            outline: 'none',
            borderBottom: '2px solid var(--w14-rule)',
            background: 'transparent',
            padding: '8px 4px',
            fontFamily: 'var(--w14-font-body)',
            fontSize: '0.95rem',
            resize: 'vertical',
            color: 'var(--w14-ink)',
          }}
        />

        {error && (
          <p role="alert" style={{ color: 'var(--w14-wax-red)', margin: '14px 0 0', fontSize: '0.92rem', textAlign: 'center' }}>
            {error}
          </p>
        )}

        <div style={{ marginTop: 22, display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Abbrechen
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!canSubmit}>
            {submitting ? 'Protokolliert…' : 'Anpassung protokollieren'}
          </Button>
        </div>
          </>
        )}

        {activeTab === 'webseo' && (
          <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={onClose}>
              Schließen
            </Button>
          </div>
        )}
      </ParchmentCard>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// TabChip — pill-style selector for the dialog header. Same visual
// vocabulary as the surface chips on the AppShellHeader so the
// operator's mental model carries.
// ────────────────────────────────────────────────────────────────────────

function TabChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className="w14-smallcaps"
      style={{
        padding: '5px 16px',
        fontFamily: 'var(--w14-font-display)',
        letterSpacing: '0.08em',
        fontSize: '0.78rem',
        backgroundColor: active ? 'var(--w14-gold)' : 'transparent',
        color: active ? 'var(--w14-ink-aged)' : 'var(--w14-ink-faded)',
        border: 'none',
        borderRadius: 999,
        cursor: 'pointer',
        fontWeight: active ? 600 : 400,
        transition: 'background 0.15s ease, color 0.15s ease',
      }}
    >
      {label}
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}): JSX.Element {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span
        className="w14-smallcaps"
        style={{ color: 'var(--w14-ink-faded)', fontSize: '0.72rem', letterSpacing: '0.08em' }}
      >
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(ev) => onChange(ev.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        style={{
          border: 'none',
          outline: 'none',
          borderBottom: '2px solid var(--w14-rule)',
          background: 'transparent',
          padding: '6px 4px',
          fontFamily: 'var(--w14-font-mono)',
          fontSize: '0.92rem',
          color: 'var(--w14-ink)',
        }}
      />
    </label>
  );
}
