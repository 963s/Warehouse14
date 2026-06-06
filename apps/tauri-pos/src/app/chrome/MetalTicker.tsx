/**
 * MetalTicker — the always-visible Edelmetall price strip in the app chrome
 * (UX-REDESIGN §3.A / §4.4). Replaces the Kurse PRIMARY tab on the daily hot
 * path: prices are a glanceable TICKER, not a 983-LOC screen.
 *
 * Four cells (Gold/Silber/Platin/Palladium) — label · €/g (mono) · Δ — driven
 * by the pure `formatMetalTick` over the SHARED rates query (no second fetch).
 * Clicking a cell anchors a lightweight detail popover (current/Δ/last-update
 * + a real-history Sparkline + a "Details" link to the full Kurse view).
 */
import { useQuery } from '@tanstack/react-query';
import { type CSSProperties, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  METAL_KIND_ORDER,
  type MetalKind,
  type MetalRate,
  metalPricesApi,
} from '@warehouse14/api-client';
import { Popover, Sparkline, type SparklineTone } from '@warehouse14/ui-kit';

import { useMetalRates } from '../../hooks/useMetalRates.js';
import { useApiClient } from '../../lib/api-context.js';
import { normalizeDecimal } from '../../lib/decimal.js';
import { type TickTone, formatMetalTick } from '../../lib/metal-tick.js';

const METAL_LABEL: Record<MetalKind, string> = {
  gold: 'Gold',
  silver: 'Silber',
  platinum: 'Platin',
  palladium: 'Palladium',
};

const TONE_COLOR: Record<TickTone, string> = {
  up: 'var(--w14-verdigris)',
  down: 'var(--w14-wax-red)',
  flat: 'var(--w14-ink-faded)',
};

const SPARK_TONE: Record<TickTone, SparklineTone> = {
  up: 'up',
  down: 'down',
  flat: 'gold',
};

export function MetalTicker(): JSX.Element {
  const ratesQ = useMetalRates();
  const byMetal = new Map<MetalKind, MetalRate>();
  for (const r of ratesQ.data?.rates ?? []) byMetal.set(r.metal, r);

  const loadingFirst = ratesQ.isLoading && !ratesQ.data;
  const stale = ratesQ.isError && !!ratesQ.data; // last-known shown, but flag it

  return (
    <section
      aria-label="Edelmetall-Ticker"
      style={{
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'stretch',
        gap: 0,
        borderBottom: '1px solid var(--w14-rule)',
        background: 'var(--w14-parchment-2)',
        overflowX: 'auto',
        opacity: stale ? 0.85 : 1,
      }}
    >
      {METAL_KIND_ORDER.map((metal) => (
        <MetalCell key={metal} metal={metal} rate={byMetal.get(metal)} loading={loadingFirst} />
      ))}
      {stale && (
        <span
          className="w14-smallcaps"
          title="Letzter bekannter Kurs — Verbindung gestört"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '0 12px',
            color: 'var(--w14-ink-faded)',
            fontSize: '0.7rem',
            letterSpacing: '0.08em',
            whiteSpace: 'nowrap',
          }}
        >
          · offline
        </span>
      )}
    </section>
  );
}

const CELL_BTN: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 44,
  padding: '6px 16px',
  border: 'none',
  borderRight: '1px solid var(--w14-rule)',
  background: 'transparent',
  color: 'var(--w14-ink)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

function MetalCell({
  metal,
  rate,
  loading,
}: {
  metal: MetalKind;
  rate: MetalRate | undefined;
  loading: boolean;
}): JSX.Element {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const tick = formatMetalTick(
    rate?.currentPricePerGramEur ?? null,
    rate?.avg10dPricePerGramEur ?? null,
  );

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        style={CELL_BTN}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--w14-parchment-3)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <span
          className="w14-smallcaps"
          style={{ fontSize: '0.72rem', letterSpacing: '0.06em', color: 'var(--w14-ink-faded)' }}
        >
          {METAL_LABEL[metal]}
        </span>
        {loading ? (
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              width: 64,
              height: 12,
              borderRadius: 4,
              background: 'var(--w14-parchment-3)',
            }}
          />
        ) : (
          <>
            <span
              className="w14-tabular"
              style={{ fontFamily: 'var(--w14-font-mono)', fontSize: '0.92rem', fontWeight: 600 }}
            >
              {tick.price}
              <span style={{ color: 'var(--w14-ink-faded)', fontWeight: 400 }}> €/g</span>
            </span>
            {tick.deltaLabel && (
              <span
                className="w14-tabular"
                style={{
                  fontFamily: 'var(--w14-font-mono)',
                  fontSize: '0.8rem',
                  color: TONE_COLOR[tick.tone],
                }}
              >
                {tick.deltaLabel}
              </span>
            )}
          </>
        )}
      </button>
      <Popover
        open={open}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
        ariaLabel={`${METAL_LABEL[metal]} — Kursdetail`}
      >
        <MetalDetail metal={metal} rate={rate} />
      </Popover>
    </>
  );
}

function MetalDetail({
  metal,
  rate,
}: { metal: MetalKind; rate: MetalRate | undefined }): JSX.Element {
  const api = useApiClient();
  const navigate = useNavigate();
  const tick = formatMetalTick(
    rate?.currentPricePerGramEur ?? null,
    rate?.avg10dPricePerGramEur ?? null,
  );

  // Shares Kurse's history queryKey → cache-deduped. Lazy: only runs while the
  // popover (and thus this component) is mounted.
  const histQ = useQuery({
    queryKey: ['metal-prices', 'history', metal],
    queryFn: () => metalPricesApi.history(api, { metal, limit: 60 }),
    staleTime: 60_000,
  });
  const items = histQ.data?.items ?? [];
  const values = items
    .map((i) => Number(normalizeDecimal(i.pricePerGramEur)))
    .filter((n) => Number.isFinite(n))
    .reverse(); // history is DESC; chart wants ASC
  const lastUpdateIso = items[0]?.fetchedAt ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <strong style={{ fontFamily: 'var(--w14-font-display)', fontSize: '1rem' }}>
          {METAL_LABEL[metal]}
        </strong>
        <span
          className="w14-tabular"
          style={{ fontFamily: 'var(--w14-font-mono)', fontWeight: 600 }}
        >
          {tick.price} €/g
        </span>
      </div>
      {tick.deltaLabel && (
        <div style={{ fontSize: '0.8rem', color: TONE_COLOR[tick.tone] }}>
          {tick.deltaLabel} <span style={{ color: 'var(--w14-ink-faded)' }}>ggü. Ø 10 Tage</span>
        </div>
      )}

      {histQ.isLoading ? (
        <div
          style={{
            height: 56,
            display: 'grid',
            placeItems: 'center',
            color: 'var(--w14-ink-faded)',
            fontSize: '0.8rem',
          }}
        >
          Verlauf lädt…
        </div>
      ) : values.length >= 2 ? (
        <Sparkline
          values={values}
          ariaLabel={`${METAL_LABEL[metal]} Kursverlauf`}
          tone={SPARK_TONE[tick.tone]}
        />
      ) : (
        <div
          style={{
            height: 56,
            display: 'grid',
            placeItems: 'center',
            color: 'var(--w14-ink-faded)',
            fontSize: '0.8rem',
          }}
        >
          Kein Verlauf verfügbar
        </div>
      )}

      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <span style={{ fontSize: '0.72rem', color: 'var(--w14-ink-faded)' }}>
          {lastUpdateIso ? `Stand: ${new Date(lastUpdateIso).toLocaleString('de-DE')}` : ''}
        </span>
        <button
          type="button"
          onClick={() => navigate('/kurse')}
          className="w14-smallcaps"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--w14-gold)',
            cursor: 'pointer',
            fontSize: '0.74rem',
            letterSpacing: '0.06em',
            padding: 0,
          }}
        >
          Details / Verlauf →
        </button>
      </div>
    </div>
  );
}
