/**
 * EbayPanel — the eBay channel pipeline (Track B4). A management view over the
 * 9-stage eBay listing state machine: a live pipeline overview with per-stage
 * counts + filter, a transition table that only offers the moves the backend
 * trigger allows, a marketplace publish push, and per-row state history.
 *
 * Reads `productsApi.list({ enrolledOnEbay: true })` — one request paints the
 * whole board (list rows carry `ebayState`, audit H-H). Transitions +
 * publish are ADMIN server-side; the step-up modal opens + replays transparently.
 * Mirrors the DokumentePanel / TeamPanel chrome.
 */

import { type CSSProperties, useMemo, useState } from 'react';

import { useQuery } from '@tanstack/react-query';

import {
  ALLOWED_EBAY_TRANSITIONS,
  ApiError,
  EBAY_STATE_LABELS,
  EBAY_STATE_ORDER,
  type EbayState,
  type EbayTransitionResponse,
  ebayApi,
  type ProductListRow,
  productsApi,
} from '@warehouse14/api-client';
import {
  Button,
  DiamondRule,
  ParchmentCard,
  ToastContainer,
  type ToastShape,
} from '@warehouse14/ui-kit';
import { describeError } from '@warehouse14/i18n-de';

import { useApiClient } from '../api-context.js';
import { StatusDot, type StatusTone } from '../components/StatusDot.js';
import { isStepUpCancelled } from '../state/step-up-store.js';

/** Each eBay stage → a StatusDot tone that reads the health of the row at a glance. */
const STATE_TONE: Readonly<Record<EbayState, StatusTone>> = {
  ENTWURF: 'info',
  GEPRUEFT: 'watch',
  ONLINE: 'ok',
  VERKAUFT: 'watch',
  BEZAHLT: 'watch',
  VERPACKT: 'watch',
  VERSENDET: 'ok',
  REKLAMIERT: 'alert',
  RETOURNIERT: 'info',
};

/** The stages from which a marketplace listing-push makes sense. */
const PUBLISHABLE: ReadonlySet<EbayState> = new Set<EbayState>(['GEPRUEFT', 'ONLINE']);

const captionStyle: CSSProperties = {
  margin: 0,
  color: 'var(--w14-ink-faded)',
  fontSize: '0.9rem',
  lineHeight: 1.5,
};
const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  fontSize: '0.72rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--w14-ink-faded)',
  borderBottom: '1px solid var(--w14-ink-faded)',
  whiteSpace: 'nowrap',
};
const tdStyle: CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid var(--w14-parchment-3)',
  verticalAlign: 'middle',
};
const selectStyle: CSSProperties = {
  padding: '6px 8px',
  border: '1px solid var(--w14-ink-faded)',
  borderRadius: 'var(--w14-radius-button)',
  background: 'var(--w14-parchment)',
  color: 'var(--w14-ink)',
  fontFamily: 'var(--w14-font-display)',
  fontSize: '0.85rem',
};

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
function formatEur(decimal: string): string {
  const n = Number.parseFloat(decimal);
  return Number.isFinite(n) ? eur.format(n) : '—';
}
function formatDay(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso));
}

/** German gloss for the inventory side-effect a transition may trigger. */
function sideEffectNote(effect: EbayTransitionResponse['inventorySideEffect']): string | null {
  switch (effect) {
    case 'AUTO_RESERVED':
      return 'Artikel wurde automatisch reserviert.';
    case 'CONFLICT_LOCAL_RESERVATION':
      return 'Achtung: lokal bereits anderweitig reserviert.';
    case 'CONFLICT_LOCAL_SOLD':
      return 'Achtung: lokal bereits verkauft.';
    default:
      return null;
  }
}

export function EbayPanel(): JSX.Element {
  const { baseUrl, client } = useApiClient();
  const [toasts, setToasts] = useState<ToastShape[]>([]);
  const [filter, setFilter] = useState<EbayState | 'ALLE'>('ALLE');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const pushToast = (tone: ToastShape['tone'], title: string, body?: string): void =>
    setToasts((p) => [
      ...p,
      { id: crypto.randomUUID(), tone, title, autoDismissMs: 5000, ...(body ? { body } : {}) },
    ]);
  const dismissToast = (id: string): void => setToasts((p) => p.filter((x) => x.id !== id));

  const query = useQuery({
    queryKey: ['ebay-pipeline', baseUrl],
    queryFn: () => productsApi.list(client, { enrolledOnEbay: true, limit: 200 }),
    staleTime: 20_000,
  });

  const items = useMemo(() => query.data?.items ?? [], [query.data]);

  const counts = useMemo(() => {
    const c = new Map<EbayState, number>();
    for (const row of items) {
      if (row.ebayState) c.set(row.ebayState, (c.get(row.ebayState) ?? 0) + 1);
    }
    return c;
  }, [items]);

  const visible = useMemo(
    () => (filter === 'ALLE' ? items : items.filter((r) => r.ebayState === filter)),
    [items, filter],
  );

  function handleActionError(err: unknown, failTitle: string): void {
    if (isStepUpCancelled(err) || (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED')) {
      pushToast('alert', 'Abgebrochen', 'Die PIN-Bestätigung wurde abgebrochen.');
    } else {
      pushToast('alert', failTitle, describeError(err));
    }
  }

  async function transition(row: ProductListRow, toState: EbayState): Promise<void> {
    setBusyId(row.id);
    try {
      const res = await ebayApi.transition(client, row.id, { toState });
      const note = sideEffectNote(res.inventorySideEffect);
      const conflict = res.inventorySideEffect.startsWith('CONFLICT');
      pushToast(
        conflict ? 'alert' : 'success',
        `${row.name} → ${EBAY_STATE_LABELS[toState]}`,
        note ?? undefined,
      );
      await query.refetch();
    } catch (err) {
      handleActionError(err, 'Statuswechsel fehlgeschlagen');
    } finally {
      setBusyId(null);
    }
  }

  async function publish(row: ProductListRow): Promise<void> {
    setBusyId(row.id);
    try {
      const res = await ebayApi.publish(client, row.id);
      pushToast(res.published ? 'success' : 'info', row.name, res.detail);
    } catch (err) {
      handleActionError(err, 'Veröffentlichung fehlgeschlagen');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <DiamondRule tone="gold" label="eBay-Kanal" />
      <p style={{ ...captionStyle, marginTop: 8, marginBottom: 18, maxWidth: 640 }}>
        Die eBay-Pipeline vom Entwurf bis zur Zustellung. Jeder Schritt bietet nur die Wechsel an,
        die der Ablauf erlaubt. Veröffentlichen schiebt den Artikel in den Marktplatz.
      </p>

      {/* Pipeline overview — clickable stage chips with live counts. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
        <StageChip
          label="Alle"
          count={items.length}
          active={filter === 'ALLE'}
          onClick={() => setFilter('ALLE')}
        />
        {EBAY_STATE_ORDER.map((state) => (
          <StageChip
            key={state}
            label={EBAY_STATE_LABELS[state]}
            count={counts.get(state) ?? 0}
            tone={STATE_TONE[state]}
            active={filter === state}
            onClick={() => setFilter(state)}
          />
        ))}
      </div>

      {query.isLoading ? (
        <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 960 }}>
          <p style={captionStyle}>Lädt eBay-Pipeline …</p>
        </ParchmentCard>
      ) : visible.length === 0 ? (
        <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 960 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <StatusDot tone="info" size={11} />
            <p style={captionStyle}>
              {filter === 'ALLE'
                ? 'Noch keine Artikel in der eBay-Pipeline.'
                : `Keine Artikel im Status „${EBAY_STATE_LABELS[filter]}".`}
            </p>
          </div>
        </ParchmentCard>
      ) : (
        <ParchmentCard tone="parchment" padding="md" style={{ maxWidth: 960, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead>
              <tr>
                <th style={thStyle}>Artikel</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Preis</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Geändert</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Aktion</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const state = row.ebayState;
                const allowed = state ? (ALLOWED_EBAY_TRANSITIONS[state] ?? []) : [];
                const busy = busyId === row.id;
                const open = expandedId === row.id;
                return (
                  <FragmentRow
                    key={row.id}
                    row={row}
                    busy={busy}
                    open={open}
                    allowed={allowed}
                    canPublish={state !== null && PUBLISHABLE.has(state)}
                    onTransition={(to) => void transition(row, to)}
                    onPublish={() => void publish(row)}
                    onToggleHistory={() => setExpandedId(open ? null : row.id)}
                  />
                );
              })}
            </tbody>
          </table>
        </ParchmentCard>
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}

/** One product row plus its optional expanded history sub-row. */
function FragmentRow({
  row,
  busy,
  open,
  allowed,
  canPublish,
  onTransition,
  onPublish,
  onToggleHistory,
}: {
  row: ProductListRow;
  busy: boolean;
  open: boolean;
  allowed: readonly EbayState[];
  canPublish: boolean;
  onTransition: (to: EbayState) => void;
  onPublish: () => void;
  onToggleHistory: () => void;
}): JSX.Element {
  const state = row.ebayState;
  return (
    <>
      <tr>
        <td style={{ ...tdStyle, fontFamily: 'var(--w14-font-display)' }}>
          <div>{row.name}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--w14-ink-faded)' }}>{row.sku}</div>
        </td>
        <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
          {formatEur(row.listPriceEur)}
        </td>
        <td style={tdStyle}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <StatusDot tone={state ? STATE_TONE[state] : 'info'} size={9} />
            <span style={{ fontSize: '0.88rem' }}>{state ? EBAY_STATE_LABELS[state] : '—'}</span>
          </span>
        </td>
        <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: 'var(--w14-ink-faded)' }}>
          {formatDay(row.ebayStateChangedAt)}
        </td>
        <td style={{ ...tdStyle, textAlign: 'right' }}>
          <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {allowed.length > 0 && (
              <select
                value=""
                disabled={busy}
                onChange={(e) => {
                  const to = e.target.value as EbayState;
                  if (to) onTransition(to);
                  e.currentTarget.selectedIndex = 0;
                }}
                style={selectStyle}
                aria-label={`Status von ${row.name} wechseln`}
              >
                <option value="">Weiter zu …</option>
                {allowed.map((to) => (
                  <option key={to} value={to}>
                    {EBAY_STATE_LABELS[to]}
                  </option>
                ))}
              </select>
            )}
            {canPublish && (
              <Button variant="ghost" size="sm" disabled={busy} onClick={onPublish}>
                {busy ? '…' : 'Veröffentlichen'}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onToggleHistory}>
              {open ? 'Verlauf ▲' : 'Verlauf ▼'}
            </Button>
          </div>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} style={{ ...tdStyle, background: 'var(--w14-parchment-2)' }}>
            <EbayHistory productId={row.id} />
          </td>
        </tr>
      )}
    </>
  );
}

/** Lazily-loaded state history for one product (opened on demand). */
function EbayHistory({ productId }: { productId: string }): JSX.Element {
  const { baseUrl, client } = useApiClient();
  const query = useQuery({
    queryKey: ['ebay-history', baseUrl, productId],
    queryFn: () => ebayApi.history(client, productId, { limit: 20 }),
    staleTime: 15_000,
  });

  if (query.isLoading) return <p style={captionStyle}>Lädt Verlauf …</p>;
  const rows = query.data?.items ?? [];
  if (rows.length === 0) return <p style={captionStyle}>Kein Verlauf hinterlegt.</p>;

  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
      {rows.map((h) => (
        <li
          key={h.id}
          style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: '0.85rem' }}
        >
          <span style={{ color: 'var(--w14-ink-faded)', whiteSpace: 'nowrap', minWidth: 88 }}>
            {formatDay(h.createdAt)}
          </span>
          <span style={{ fontFamily: 'var(--w14-font-display)' }}>
            {h.fromState ? EBAY_STATE_LABELS[h.fromState] : 'Neu'} → {EBAY_STATE_LABELS[h.toState]}
          </span>
          {h.notes && <span style={{ color: 'var(--w14-ink-faded)' }}>· {h.notes}</span>}
        </li>
      ))}
    </ol>
  );
}

/** A clickable pipeline-stage chip with a live count. */
function StageChip({
  label,
  count,
  tone,
  active,
  onClick,
}: {
  label: string;
  count: number;
  tone?: StatusTone;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '7px 12px',
        borderRadius: 'var(--w14-radius-button)',
        border: active ? '1px solid var(--w14-gold)' : '1px solid var(--w14-parchment-3)',
        background: active ? 'var(--w14-parchment-2)' : 'transparent',
        color: 'var(--w14-ink)',
        fontFamily: 'var(--w14-font-display)',
        fontSize: '0.85rem',
        cursor: 'pointer',
      }}
    >
      {tone && <StatusDot tone={tone} size={8} />}
      <span>{label}</span>
      <span
        style={{
          fontVariantNumeric: 'tabular-nums',
          color: active ? 'var(--w14-ink)' : 'var(--w14-ink-faded)',
          fontWeight: 600,
        }}
      >
        {count}
      </span>
    </button>
  );
}
