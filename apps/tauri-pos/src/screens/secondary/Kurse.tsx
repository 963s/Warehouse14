/**
 * Kurse — Tier-2 Edelmetallkursraum (Phase 2 Day 8).
 *
 * Four large tiles (Gold / Silber / Platin / Palladium) showing current
 * €/g, delta from the immediately-prior price, last-fetched timestamp,
 * and source badge. Below each tile a 30-day sparkline.
 *
 * ADMIN-only "Manueller Override" button opens a modal with metal/price/
 * reason fields and POSTs to `/api/metal-prices`. Mutation invalidates
 * both the `current` and the `history` queries.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  ApiError,
  METAL_KIND_ORDER,
  metalPricesApi,
  type CurrentMetalPrice,
  type ManualOverrideBody,
  type MetalKind,
  type MetalPriceHistoryRow,
} from '@warehouse14/api-client';
import { Button, DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { useSessionStore } from '../../state/session-store.js';
import { useToastStore } from '../../state/toast-store.js';

const METAL_LABEL: Record<MetalKind, string> = {
  gold: 'Gold',
  silver: 'Silber',
  platinum: 'Platin',
  palladium: 'Palladium',
};

const METAL_ACCENT: Record<MetalKind, string> = {
  gold: 'var(--w14-gold)',
  silver: '#9aa0a6',
  platinum: '#c6c8cb',
  palladium: '#8b8fa3',
};

export function Kurse(): JSX.Element {
  const api = useApiClient();
  const actor = useSessionStore((s) => s.actor);
  const isAdmin = actor?.role === 'ADMIN';

  const currentQ = useQuery({
    queryKey: ['metal-prices', 'current'],
    queryFn: () => metalPricesApi.current(api),
    staleTime: 60_000,
  });

  // Four parallel history queries, one per metal — 30 days of context for sparklines.
  const historyQs = useQueries({
    queries: METAL_KIND_ORDER.map((metal) => ({
      queryKey: ['metal-prices', 'history', metal] as const,
      queryFn: () => metalPricesApi.history(api, { metal, limit: 30 }),
      staleTime: 5 * 60_000,
    })),
  });

  const [overrideOpen, setOverrideOpen] = useState<MetalKind | null>(null);

  return (
    <section
      aria-label="Edelmetallkurse"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 24,
        gap: 18,
        overflowY: 'auto',
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1.6rem',
          }}
        >
          Edelmetallkursraum
        </h1>
        <span
          className="w14-smallcaps"
          style={{ color: 'var(--w14-ink-faded)', fontSize: '0.78rem', letterSpacing: '0.1em' }}
        >
          {currentQ.isFetching ? 'aktualisiert…' : 'live'}
        </span>
      </header>

      <DiamondRule />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16,
        }}
      >
        {METAL_KIND_ORDER.map((metal, i) => {
          const current = currentQ.data?.prices.find((p) => p.metal === metal);
          const history = historyQs[i]?.data?.items ?? [];
          return (
            <PriceTile
              key={metal}
              metal={metal}
              current={current}
              history={history}
              loading={currentQ.isLoading || historyQs[i]?.isLoading === true}
              isAdmin={isAdmin}
              onOverride={() => setOverrideOpen(metal)}
            />
          );
        })}
      </div>

      {overrideOpen && (
        <ManualOverrideModal
          metal={overrideOpen}
          currentPrice={
            currentQ.data?.prices.find((p) => p.metal === overrideOpen)?.pricePerGramEur ?? null
          }
          onClose={() => setOverrideOpen(null)}
        />
      )}
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Tile
// ════════════════════════════════════════════════════════════════════════

function PriceTile({
  metal,
  current,
  history,
  loading,
  isAdmin,
  onOverride,
}: {
  metal: MetalKind;
  current: CurrentMetalPrice | undefined;
  history: MetalPriceHistoryRow[];
  loading: boolean;
  isAdmin: boolean;
  onOverride: () => void;
}): JSX.Element {
  const accent = METAL_ACCENT[metal];

  // The first (most recent) row in the history is the CURRENT one; the next
  // is "yesterday" for delta purposes. The history is ordered DESC.
  const delta = useMemo(() => {
    if (history.length < 2 || !current?.pricePerGramEur) return null;
    const prev = parseFloat(history[1]!.pricePerGramEur);
    const now = parseFloat(current.pricePerGramEur);
    if (!Number.isFinite(prev) || !Number.isFinite(now) || prev === 0) return null;
    return { abs: now - prev, pct: ((now - prev) / prev) * 100 };
  }, [history, current]);

  if (loading) {
    return (
      <ParchmentCard padding="lg">
        <div
          aria-hidden
          style={{
            height: 140,
            borderRadius: 4,
            background:
              'linear-gradient(90deg, var(--w14-parchment-2), var(--w14-parchment-3), var(--w14-parchment-2))',
            backgroundSize: '200% 100%',
            animation: 'w14-skel 1.6s ease-in-out infinite',
          }}
        />
      </ParchmentCard>
    );
  }

  const noData = !current || current.pricePerGramEur === null;

  return (
    <ParchmentCard padding="lg" style={{ borderTop: `3px solid ${accent}` }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2
          className="w14-smallcaps"
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            color: accent,
            letterSpacing: '0.1em',
            fontSize: '0.92rem',
          }}
        >
          {METAL_LABEL[metal]}
        </h2>
        {current?.source && <SourceBadge source={current.source} />}
      </header>

      {noData ? (
        <p
          style={{
            margin: '14px 0',
            fontStyle: 'italic',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
          }}
        >
          Noch kein Kurs erfasst.
        </p>
      ) : (
        <>
          <div
            className="w14-tabular"
            style={{
              fontFamily: 'var(--w14-font-mono)',
              fontWeight: 600,
              fontSize: '2.1rem',
              margin: '12px 0 4px',
              color: 'var(--w14-ink)',
            }}
          >
            {formatPrice(current.pricePerGramEur!)} <span style={{ fontSize: '0.92rem', color: 'var(--w14-ink-faded)' }}>€/g</span>
          </div>

          {delta && <DeltaRow delta={delta} />}

          <p
            className="w14-tabular"
            style={{
              margin: '8px 0 0',
              fontFamily: 'var(--w14-font-mono)',
              fontSize: '0.74rem',
              color: 'var(--w14-ink-faded)',
            }}
          >
            zuletzt {current.fetchedAt ? new Date(current.fetchedAt).toLocaleString('de-DE') : '—'}
          </p>

          <Sparkline history={history} accent={accent} />
        </>
      )}

      {isAdmin && (
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="ghost" size="md" onClick={onOverride}>
            Manueller Override
          </Button>
        </div>
      )}
    </ParchmentCard>
  );
}

function DeltaRow({ delta }: { delta: { abs: number; pct: number } }): JSX.Element {
  const up = delta.abs >= 0;
  const color = up ? 'var(--w14-gold)' : 'var(--w14-wax-red)';
  const sign = up ? '+' : '−';
  return (
    <div
      className="w14-tabular"
      style={{
        fontFamily: 'var(--w14-font-mono)',
        fontSize: '0.82rem',
        color,
      }}
    >
      {sign}
      {Math.abs(delta.abs).toFixed(4)} €  ·  {sign}
      {Math.abs(delta.pct).toFixed(2)} %
    </div>
  );
}

function SourceBadge({ source }: { source: string }): JSX.Element {
  return (
    <span
      className="w14-smallcaps"
      style={{
        fontSize: '0.68rem',
        letterSpacing: '0.08em',
        padding: '2px 8px',
        border: '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-button)',
        color: 'var(--w14-ink-faded)',
      }}
    >
      {source}
    </span>
  );
}

function Sparkline({
  history,
  accent,
}: {
  history: MetalPriceHistoryRow[];
  accent: string;
}): JSX.Element | null {
  if (history.length < 2) return null;

  // History is DESC; we want ASC for x-axis time-order.
  const ordered = [...history].reverse();
  const values = ordered.map((r) => parseFloat(r.pricePerGramEur)).filter(Number.isFinite);
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const W = 260;
  const H = 56;
  const step = values.length > 1 ? W / (values.length - 1) : W;

  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(H - ((v - min) / range) * (H - 4) - 2).toFixed(1)}`)
    .join(' ');

  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      style={{ marginTop: 12, display: 'block' }}
    >
      <polyline
        fill="none"
        stroke={accent}
        strokeWidth={1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
    </svg>
  );
}

function formatPrice(s: string): string {
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

// ════════════════════════════════════════════════════════════════════════
// Manual Override Modal (Owner / step-up)
// ════════════════════════════════════════════════════════════════════════

function ManualOverrideModal({
  metal,
  currentPrice,
  onClose,
}: {
  metal: MetalKind;
  currentPrice: string | null;
  onClose: () => void;
}): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const [price, setPrice] = useState<string>(currentPrice ?? '');
  const [reason, setReason] = useState<string>('');

  const override = useMutation({
    mutationFn: (body: ManualOverrideBody) => metalPricesApi.override(api, body),
    onSuccess: async () => {
      addToast({ tone: 'success', title: 'Override gespeichert', body: `${METAL_LABEL[metal]} aktualisiert` });
      await qc.invalidateQueries({ queryKey: ['metal-prices'] });
      onClose();
    },
    onError: (err: unknown) => {
      addToast({
        tone: 'alert',
        title: 'Override fehlgeschlagen',
        body: err instanceof ApiError ? err.message : 'Bitte erneut versuchen.',
      });
    },
  });

  const priceValid = /^\d{1,11}(\.\d{1,4})?$/.test(price.trim());
  const reasonValid = reason.trim().length >= 8;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Manueller Override"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20, 16, 10, 0.55)',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <ParchmentCard
        padding="lg"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(480px, 100%)' }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1.3rem',
          }}
        >
          Manueller Override · {METAL_LABEL[metal]}
        </h2>
        <DiamondRule />

        <label
          className="w14-smallcaps"
          style={{
            display: 'block',
            color: 'var(--w14-ink-aged)',
            fontSize: '0.78rem',
            letterSpacing: '0.08em',
            marginTop: 8,
          }}
        >
          Preis · €/g (NUMERIC 15,4)
        </label>
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="62.5000"
          inputMode="decimal"
          style={{ ...inputStyle, fontFamily: 'var(--w14-font-mono)' }}
        />

        <label
          className="w14-smallcaps"
          style={{
            display: 'block',
            color: 'var(--w14-ink-aged)',
            fontSize: '0.78rem',
            letterSpacing: '0.08em',
            marginTop: 12,
          }}
        >
          Begründung (≥ 8 Zeichen)
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="Warum weicht der Kurs vom LBMA-Wert ab?"
          style={{ ...inputStyle, resize: 'vertical' }}
        />

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <Button variant="ghost" onClick={onClose} disabled={override.isPending}>
            Abbrechen
          </Button>
          <Button
            variant="primary"
            disabled={!priceValid || !reasonValid || override.isPending}
            onClick={() =>
              override.mutate({ metal, pricePerGramEur: price.trim(), reason: reason.trim() })
            }
          >
            {override.isPending ? 'Speichert…' : 'Übernehmen'}
          </Button>
        </div>
      </ParchmentCard>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--w14-rule)',
  borderRadius: 4,
  backgroundColor: 'var(--w14-parchment-1, var(--w14-parchment))',
  fontFamily: 'var(--w14-font-body)',
  fontSize: '0.92rem',
  color: 'var(--w14-ink)',
  outline: 'none',
};
