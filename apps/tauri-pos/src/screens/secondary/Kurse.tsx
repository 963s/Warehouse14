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

import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  ApiError,
  type CurrentMetalPrice,
  METAL_KIND_ORDER,
  type ManualOverrideBody,
  type MetalKind,
  type MetalPriceHistoryRow,
  type MetalRate,
  metalPricesApi,
} from '@warehouse14/api-client';
import { Button, DiamondRule, ParchmentCard } from '@warehouse14/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { isMoneyInput, normalizeDecimal } from '../../lib/decimal.js';
import { deriveAnkaufPerGram, formatPerGram } from '../../lib/metal-margin.js';
import { useSessionStore } from '../../state/session-store.js';
import { useToastStore } from '../../state/toast-store.js';
import { TradingTerminal } from './TradingTerminal.js';
import { describeError } from '@warehouse14/i18n-de';

const METAL_LABEL: Record<MetalKind, string> = {
  gold: 'Gold',
  silver: 'Silber',
  platinum: 'Platin',
  palladium: 'Palladium',
};

// Metal identity accents — warm, token-only (no cool greys). Each metal reads
// as a distinct antique tone the way gold reads via --w14-gold: silver = warm
// umber, platinum = the pale warm-gold hairline (its bright sheen), palladium =
// faded warm grey. Consistent with gold's decorative-var treatment.
const METAL_ACCENT: Record<MetalKind, string> = {
  gold: 'var(--w14-gold)',
  silver: 'var(--w14-ink-aged)',
  platinum: 'var(--w14-rule)',
  palladium: 'var(--w14-ink-faded)',
};

export function Kurse(): JSX.Element {
  const api = useApiClient();
  const actor = useSessionStore((s) => s.actor);
  const isAdmin = actor?.role === 'ADMIN';

  // Live: poll the market price every 20 s so the room reflects the market.
  const currentQ = useQuery({
    queryKey: ['metal-prices', 'current'],
    queryFn: () => metalPricesApi.current(api),
    staleTime: 20_000,
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
  });

  // Rates: current + time-weighted 10-day average + Ankauf buy rate per metal.
  const ratesQ = useQuery({
    queryKey: ['metal-prices', 'rates'],
    queryFn: () => metalPricesApi.rates(api),
    staleTime: 20_000,
    refetchInterval: 20_000,
  });

  // Which metal the big trading terminal is showing.
  const [selectedMetal, setSelectedMetal] = useState<MetalKind>('gold');

  // Four parallel history queries, one per metal — context for the terminal.
  // We pull the full window (server cap 200) and let the terminal bucket it
  // into the selected range (1T/1W/1M/6M/1J) client-side.
  const historyQs = useQueries({
    queries: METAL_KIND_ORDER.map((metal) => ({
      queryKey: ['metal-prices', 'history', metal] as const,
      queryFn: () => metalPricesApi.history(api, { metal, limit: 200 }),
      staleTime: 60_000,
      refetchInterval: 60_000,
    })),
  });

  const [overrideOpen, setOverrideOpen] = useState<MetalKind | null>(null);
  const [marginOpen, setMarginOpen] = useState(false);

  // Deep-open from the ticker popover's "Ankaufmarge bearbeiten →" link
  // (/kurse?marge=1). ADMIN only; consume the param so a refresh doesn't reopen.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (isAdmin && searchParams.get('marge') === '1') {
      setMarginOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete('marge');
      setSearchParams(next, { replace: true });
    }
  }, [isAdmin, searchParams, setSearchParams]);

  const safetyMarginPct = ratesQ.data?.safetyMarginPct ?? null;

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {isAdmin && (
            <Button
              variant="ghost"
              size="md"
              onClick={() => setMarginOpen(true)}
              title="Ankaufmarge je Metall → Ankaufpreis überall (Ticker, Ankauf, Kursraum)"
            >
              Ankaufmarge je Metall
            </Button>
          )}
          <span
            className="w14-smallcaps"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: 'var(--w14-ink-faded)',
              fontSize: '0.78rem',
              letterSpacing: '0.1em',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background:
                  currentQ.isFetching || ratesQ.isFetching
                    ? 'var(--w14-gold)'
                    : 'var(--w14-verdigris)',
                boxShadow: '0 0 0 3px color-mix(in srgb, var(--w14-verdigris) 25%, transparent)',
              }}
            />
            {currentQ.isFetching || ratesQ.isFetching ? 'aktualisiert…' : 'live'}
          </span>
        </div>
      </header>

      <DiamondRule />

      {/* ── Big interactive trading chart for the selected metal ───────── */}
      <ParchmentCard padding="lg">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: 12,
            marginBottom: 12,
          }}
        >
          {/* Metal tabs */}
          <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
            {METAL_KIND_ORDER.map((m) => {
              const active = m === selectedMetal;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setSelectedMetal(m)}
                  className="w14-smallcaps"
                  style={{
                    padding: '6px 14px',
                    fontSize: '0.8rem',
                    letterSpacing: '0.06em',
                    cursor: 'pointer',
                    borderRadius: 'var(--w14-radius-button)',
                    border: `1px solid ${active ? METAL_ACCENT[m] : 'var(--w14-rule)'}`,
                    background: active ? METAL_ACCENT[m] : 'transparent',
                    color: active ? '#fff' : 'var(--w14-ink-faded)',
                    transition: 'all 160ms ease',
                  }}
                >
                  {METAL_LABEL[m]}
                </button>
              );
            })}
          </div>
          {/* Current price headline for the selected metal */}
          {(() => {
            const cur = currentQ.data?.prices.find((p) => p.metal === selectedMetal);
            return (
              <div style={{ textAlign: 'right' }}>
                <div
                  className="w14-tabular"
                  style={{
                    fontFamily: 'var(--w14-font-mono)',
                    fontWeight: 600,
                    fontSize: '1.9rem',
                    color: 'var(--w14-ink)',
                    lineHeight: 1.1,
                  }}
                >
                  {cur?.pricePerGramEur ? formatPrice(cur.pricePerGramEur) : '-'}{' '}
                  <span style={{ fontSize: '0.8rem', color: 'var(--w14-ink-faded)' }}>€/g</span>
                </div>
                <div
                  className="w14-smallcaps"
                  style={{
                    fontSize: '0.72rem',
                    letterSpacing: '0.06em',
                    color: 'var(--w14-ink-faded)',
                    marginTop: 2,
                  }}
                >
                  <span style={{ color: METAL_ACCENT[selectedMetal] }}>● Verkauf</span>
                  {'   '}
                  <span>┄ Ankauf</span>
                </div>
              </div>
            );
          })()}
        </div>
        <TradingTerminal
          metalLabel={METAL_LABEL[selectedMetal]}
          accent={METAL_ACCENT[selectedMetal]}
          history={historyQs[METAL_KIND_ORDER.indexOf(selectedMetal)]?.data?.items ?? []}
          currentPrice={
            currentQ.data?.prices.find((p) => p.metal === selectedMetal)?.pricePerGramEur ?? null
          }
          safetyMarginPct={
            ratesQ.data?.rates.find((r) => r.metal === selectedMetal)?.safetyMarginPct ??
            safetyMarginPct
          }
          fetching={currentQ.isFetching}
        />
      </ParchmentCard>

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
          const rate = ratesQ.data?.rates.find((r) => r.metal === metal);
          return (
            <PriceTile
              key={metal}
              metal={metal}
              current={current}
              rate={rate}
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

      {marginOpen && (
        <MarginModal rates={ratesQ.data?.rates ?? []} onClose={() => setMarginOpen(false)} />
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
  rate,
  history,
  loading,
  isAdmin,
  onOverride,
}: {
  metal: MetalKind;
  current: CurrentMetalPrice | undefined;
  rate: MetalRate | undefined;
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
    const prev = Number.parseFloat(history[1]!.pricePerGramEur);
    const now = Number.parseFloat(current.pricePerGramEur);
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
            {formatPrice(current.pricePerGramEur!)}{' '}
            <span style={{ fontSize: '0.92rem', color: 'var(--w14-ink-faded)' }}>€/g</span>
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
            zuletzt {current.fetchedAt ? new Date(current.fetchedAt).toLocaleString('de-DE') : '-'}
          </p>

          <RatesBlock rate={rate} />

          <PriceChart history={history} accent={accent} avg={rate?.avg10dPricePerGramEur ?? null} />
        </>
      )}

      {isAdmin && (
        <div
          style={{
            marginTop: 12,
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span style={{ fontSize: '0.74rem', color: 'var(--w14-ink-faded)' }}>
            setzt den Spot-Kurs (Marktwert)
          </span>
          <Button
            variant="ghost"
            size="md"
            onClick={onOverride}
            title="Spot-Override → setzt den Marktwert dieses Metalls (nicht die Ankaufmarge)"
          >
            Spot-Override
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
      {Math.abs(delta.abs).toFixed(4)} € · {sign}
      {Math.abs(delta.pct).toFixed(2)} %
    </div>
  );
}

function RatesBlock({ rate }: { rate: MetalRate | undefined }): JSX.Element | null {
  if (!rate) return null;
  const spot = rate.verkaufBasePerGramEur ?? rate.currentPricePerGramEur;
  const ankaufLabel = `Ankauf-Kurs (−${formatPct(rate.safetyMarginPct ?? 0.1)})`;
  return (
    <div style={{ marginTop: 12, display: 'grid', gap: 4 }}>
      <RateRow label="Spot-Kurs (Marktwert)" value={spot} />
      <RateRow label={ankaufLabel} value={rate.ankaufRatePerGramEur} tone="wax" />
      <RateRow label="10-Tage-Mittel" value={rate.avg10dPricePerGramEur} muted />
    </div>
  );
}

function RateRow({
  label,
  value,
  tone,
  muted,
}: {
  label: string;
  value: string | null;
  tone?: 'wax';
  muted?: boolean;
}): JSX.Element {
  const color =
    tone === 'wax' ? 'var(--w14-wax-red)' : muted ? 'var(--w14-ink-faded)' : 'var(--w14-ink)';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span
        className="w14-smallcaps"
        style={{ color: 'var(--w14-ink-faded)', letterSpacing: '0.06em', fontSize: '0.74rem' }}
      >
        {label}
      </span>
      <span
        className="w14-tabular"
        style={{ fontFamily: 'var(--w14-font-mono)', fontSize: '0.86rem', color }}
      >
        {value !== null ? `${formatPrice(value)} €/g` : '-'}
      </span>
    </div>
  );
}

function formatPct(frac: number): string {
  return `${(frac * 100).toLocaleString('de-DE', { maximumFractionDigits: 2 })} %`;
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

/**
 * PriceChart — an advanced area chart: gradient fill under the line, min/max
 * y-axis labels, first/last date labels, the 10-day mean (dashed), and a
 * highlighted last point. Pure SVG, no chart dependency.
 */
function PriceChart({
  history,
  accent,
  avg,
}: {
  history: MetalPriceHistoryRow[];
  accent: string;
  avg?: string | null;
}): JSX.Element | null {
  const gradId = useId();
  if (history.length < 2) return null;

  // History is DESC → ASC for time order.
  const rows = [...history]
    .reverse()
    .map((r) => ({ v: Number.parseFloat(r.pricePerGramEur), t: r.validFrom }))
    .filter((p) => Number.isFinite(p.v));
  if (rows.length < 2) return null;

  const values = rows.map((p) => p.v);
  const avgNum = avg != null ? Number.parseFloat(avg) : Number.NaN;
  const hasAvg = Number.isFinite(avgNum);

  const domain = hasAvg ? [...values, avgNum] : values;
  const min = Math.min(...domain);
  const max = Math.max(...domain);
  const range = max - min || 1;

  const W = 300;
  const H = 120;
  const top = 8;
  const bottom = 96;
  const plotH = bottom - top;
  const step = values.length > 1 ? W / (values.length - 1) : W;
  const xOf = (i: number): number => i * step;
  const yOf = (v: number): number => bottom - ((v - min) / range) * plotH;

  const linePts = values.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');
  const areaPath = `M0,${bottom} ${values
    .map((v, i) => `L${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`)
    .join(' ')} L${W},${bottom} Z`;
  const avgY = hasAvg ? yOf(avgNum) : null;
  // biome-ignore lint/style/noNonNullAssertion: values.length >= 2 guarded above.
  const lastV = values[values.length - 1]!;

  const fmtDate = (s: string): string => {
    const d = new Date(s);
    return Number.isNaN(d.getTime())
      ? ''
      : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={120}
      preserveAspectRatio="none"
      role="img"
      style={{ marginTop: 12, display: 'block' }}
    >
      <title>Verlauf{hasAvg ? ' · 10-Tage-Mittel (gestrichelt)' : ''}</title>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: accent, stopOpacity: 0.3 }} />
          <stop offset="100%" style={{ stopColor: accent, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <line
        x1={0}
        x2={W}
        y1={bottom}
        y2={bottom}
        stroke="var(--w14-rule)"
        strokeWidth={0.75}
        opacity={0.5}
      />
      {avgY !== null && (
        <line
          x1={0}
          x2={W}
          y1={avgY.toFixed(1)}
          y2={avgY.toFixed(1)}
          stroke="var(--w14-ink-faded)"
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.6}
        />
      )}
      <path d={areaPath} fill={`url(#${gradId})`} />
      <polyline
        fill="none"
        stroke={accent}
        strokeWidth={1.8}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={linePts}
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={xOf(values.length - 1).toFixed(1)}
        cy={yOf(lastV).toFixed(1)}
        r={3}
        fill={accent}
      />
      <text
        x={2}
        y={top + 4}
        fontSize={8}
        fontFamily="var(--w14-font-mono)"
        fill="var(--w14-ink-faded)"
      >
        {max.toFixed(2)}
      </text>
      <text
        x={2}
        y={bottom - 3}
        fontSize={8}
        fontFamily="var(--w14-font-mono)"
        fill="var(--w14-ink-faded)"
      >
        {min.toFixed(2)}
      </text>
      <text
        x={2}
        y={H - 3}
        fontSize={8}
        fontFamily="var(--w14-font-mono)"
        fill="var(--w14-ink-faded)"
      >
        {fmtDate(rows[0]?.t ?? '')}
      </text>
      <text
        x={W - 2}
        y={H - 3}
        fontSize={8}
        textAnchor="end"
        fontFamily="var(--w14-font-mono)"
        fill="var(--w14-ink-faded)"
      >
        {fmtDate(rows[rows.length - 1]?.t ?? '')}
      </text>
    </svg>
  );
}

function formatPrice(s: string): string {
  const n = Number.parseFloat(s);
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
      addToast({
        tone: 'success',
        title: 'Override gespeichert',
        body: `${METAL_LABEL[metal]} aktualisiert`,
      });
      await qc.invalidateQueries({ queryKey: ['metal-prices'] });
      onClose();
    },
    onError: (err: unknown) => {
      addToast({
        tone: 'alert',
        title: 'Override fehlgeschlagen',
        body: err instanceof ApiError ? describeError(err) : 'Bitte erneut versuchen.',
      });
    },
  });

  const priceValid = isMoneyInput(price.trim(), 4);
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
              override.mutate({
                metal,
                pricePerGramEur: normalizeDecimal(price.trim(), 4),
                reason: reason.trim(),
              })
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

// ════════════════════════════════════════════════════════════════════════
// Safety-Margin Modal (Owner / step-up)
// ════════════════════════════════════════════════════════════════════════

function MarginModal({ rates, onClose }: { rates: MetalRate[]; onClose: () => void }): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  // Each field edits a PERCENT (e.g. 10); the API stores a fraction (0.10).
  const initial = useMemo(() => {
    const m = {} as Record<MetalKind, string>;
    for (const mk of METAL_KIND_ORDER) {
      const r = rates.find((x) => x.metal === mk);
      m[mk] = r ? String(Number(((r.safetyMarginPct ?? 0.1) * 100).toFixed(2))) : '10';
    }
    return m;
  }, [rates]);
  const [pcts, setPcts] = useState<Record<MetalKind, string>>(initial);

  const numOf = (mk: MetalKind): number => Number(pcts[mk].replace(',', '.'));
  const validOf = (mk: MetalKind): boolean => {
    const n = numOf(mk);
    return Number.isFinite(n) && n >= 0 && n <= 50;
  };
  const allValid = METAL_KIND_ORDER.every(validOf);

  // The base the server applies the margin to: the 10-day time-weighted mean.
  const baseOf = (mk: MetalKind): string | null => {
    const r = rates.find((x) => x.metal === mk);
    return r?.avg10dPricePerGramEur ?? r?.currentPricePerGramEur ?? null;
  };
  // Live Ankauf preview via the SAME formula the server uses (deriveAnkaufPerGram
  // mirrors ROUND(avg × (1 − margin), 4)); the authoritative value still arrives
  // from the /rates refetch after save.
  const previewAnkauf = (mk: MetalKind): string =>
    formatPerGram(deriveAnkaufPerGram(baseOf(mk), numOf(mk) / 100));

  const save = useMutation({
    mutationFn: async () => {
      // PATCH only the metals whose margin changed. The first call triggers the
      // step-up modal; the elevated session covers the rest of the burst.
      for (const mk of METAL_KIND_ORDER) {
        const r = rates.find((x) => x.metal === mk);
        const cur = r ? Number((r.safetyMarginPct * 100).toFixed(2)) : null;
        const n = numOf(mk);
        if (validOf(mk) && n !== cur) {
          await metalPricesApi.updateMargin(api, { metal: mk, marginPct: n / 100 });
        }
      }
    },
    onSuccess: async () => {
      addToast({
        tone: 'success',
        title: 'Margen gespeichert',
        body: 'Ankaufskurse überall aktualisiert: Ticker, Ankauf-Vorschlag, Kursraum.',
      });
      // CORE FIX: invalidate the WHOLE metal-prices family (not just 'rates') so
      // EVERY consumer refetches the new server-derived Ankauf rate at once. The
      // chrome ticker (useMetalRates), the Ankauf estimator (IntakeList +
      // AppraisalItemForm) and this Kursraum all share the ['metal-prices', …]
      // key prefix → a single invalidation reaches all of them.
      await qc.invalidateQueries({ queryKey: ['metal-prices'] });
      onClose();
    },
    onError: (err: unknown) => {
      addToast({
        tone: 'alert',
        title: 'Speichern fehlgeschlagen',
        body: err instanceof ApiError ? describeError(err) : 'Bitte erneut versuchen.',
      });
    },
  });

  return (
    // biome-ignore lint/a11y/useSemanticElements: backdrop overlay uses role="dialog" to match the existing modal pattern in this screen
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sicherheitsmargen je Metall"
      tabIndex={-1}
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
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <ParchmentCard
        padding="lg"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(520px, 100%)' }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: '1.3rem',
          }}
        >
          Sicherheitsmargen je Metall
        </h2>
        <DiamondRule />

        <p style={{ margin: '8px 0 0', fontSize: '0.84rem', color: 'var(--w14-ink-aged)' }}>
          <strong>Ankaufpreis = 10-Tage-Mittel (Spot) × (1 − Marge).</strong> Jede Marge ist einzeln
          einstellbar (0 bis 50 %). Speichern wirkt <strong>sofort überall</strong>: Ticker,
          Ankauf-Vorschlag und Kursraum.
        </p>
        <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--w14-ink-faded)' }}>
          Die Marge betrifft nur den <strong>Ankauf</strong>. Verkaufspreise sind je Artikel
          (Listenpreis), nicht Spot × Marge.
        </p>

        <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
          {METAL_KIND_ORDER.map((mk) => (
            <div
              key={mk}
              style={{
                display: 'grid',
                gridTemplateColumns: '90px 96px 1fr',
                gap: 12,
                alignItems: 'center',
              }}
            >
              <span
                className="w14-smallcaps"
                style={{ color: METAL_ACCENT[mk], fontWeight: 600, letterSpacing: '0.06em' }}
              >
                {METAL_LABEL[mk]}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
                <input
                  value={pcts[mk]}
                  onChange={(e) => setPcts((s) => ({ ...s, [mk]: e.target.value }))}
                  inputMode="decimal"
                  aria-label={`Marge ${METAL_LABEL[mk]} in Prozent`}
                  style={{
                    ...inputStyle,
                    fontFamily: 'var(--w14-font-mono)',
                    textAlign: 'right',
                    borderColor: validOf(mk) ? 'var(--w14-rule)' : 'var(--w14-wax-red)',
                  }}
                />
                <span style={{ color: 'var(--w14-ink-faded)' }}>%</span>
              </span>
              <span
                className="w14-tabular"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  fontFamily: 'var(--w14-font-mono)',
                  fontSize: '0.82rem',
                  lineHeight: 1.3,
                }}
              >
                <span style={{ color: 'var(--w14-ink-faded)' }}>
                  Ø10T {formatPerGram(baseOf(mk))}
                </span>
                <span style={{ color: 'var(--w14-wax-red)', fontWeight: 600 }}>
                  → Ankauf {previewAnkauf(mk)}
                </span>
              </span>
            </div>
          ))}
        </div>

        {!allValid && (
          <p style={{ margin: '8px 0 0', fontSize: '0.76rem', color: 'var(--w14-wax-red)' }}>
            Bitte je Metall einen Wert zwischen 0 und 50 eingeben.
          </p>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Abbrechen
          </Button>
          <Button
            variant="primary"
            disabled={!allValid || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Speichert…' : 'Übernehmen'}
          </Button>
        </div>
      </ParchmentCard>
    </div>
  );
}
