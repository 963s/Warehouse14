/**
 * LivePriceChart — a trading-desk style price chart for one metal.
 *
 *   • Two series: Verkauf (sell / spot) + Ankauf (buy = spot × (1 − Marge)),
 *     with a soft filled spread band between them.
 *   • Live pulse on the latest point.
 *   • Mouse crosshair: hover anywhere → a vertical guide snaps to the nearest
 *     day and a tooltip shows the date + Verkauf + Ankauf at that moment.
 *   • Smooth fade when the selected metal changes (keyed remount).
 *
 * Pure SVG + a thin HTML overlay for the tooltip — no chart dependency.
 */

import { useId, useMemo, useRef, useState } from 'react';

export interface LiveChartPoint {
  pricePerGramEur: string;
  validFrom: string;
}

interface Props {
  metalLabel: string;
  accent: string;
  history: readonly LiveChartPoint[]; // DESC (newest first)
  safetyMarginPct: number | null;
  fetching?: boolean;
}

const W = 1000;
const H = 340;
const PAD_L = 8;
const PAD_R = 8;
const PAD_T = 18;
const PAD_B = 26;

function fmtEur(n: number): string {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}
function fmtDate(s: string, withYear = false): string {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    ...(withYear ? { year: '2-digit' } : {}),
  });
}

export function LivePriceChart({
  metalLabel,
  accent,
  history,
  safetyMarginPct,
  fetching = false,
}: Props): JSX.Element {
  const gradId = useId();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const model = useMemo(() => {
    const rows = [...history]
      .reverse()
      .map((r) => ({ sell: Number.parseFloat(r.pricePerGramEur), t: r.validFrom }))
      .filter((p) => Number.isFinite(p.sell));
    const margin = safetyMarginPct ?? 0.1;
    const sell = rows.map((r) => r.sell);
    const buy = sell.map((s) => s * (1 - margin));
    const all = [...sell, ...buy];
    const rawMin = all.length ? Math.min(...all) : 0;
    const rawMax = all.length ? Math.max(...all) : 1;
    const pad = (rawMax - rawMin) * 0.08 || 1;
    const min = rawMin - pad;
    const max = rawMax + pad;
    return { rows, sell, buy, min, max, n: rows.length };
  }, [history, safetyMarginPct]);

  const { rows, sell, buy, min, max, n } = model;
  if (n < 2) {
    return (
      <div
        style={{
          height: 220,
          display: 'grid',
          placeItems: 'center',
          color: 'var(--w14-ink-faded)',
          fontStyle: 'italic',
          border: '1px solid var(--w14-rule)',
          borderRadius: 'var(--w14-radius-card)',
          background: 'var(--w14-parchment-2)',
        }}
      >
        Noch nicht genug Kursverlauf für {metalLabel}.
      </div>
    );
  }

  const range = max - min || 1;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const xOf = (i: number): number => PAD_L + (i / (n - 1)) * plotW;
  const yOf = (v: number): number => PAD_T + (1 - (v - min) / range) * plotH;

  const sellPts = sell.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`);
  const buyPts = buy.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`);
  // Spread band: down the sell line, back along the buy line.
  const band = `M${sellPts.join(' L')} L${[...buyPts].reverse().join(' L')} Z`;

  // y gridlines (4 ticks)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + f * range);

  const lastSell = sell[n - 1] as number;
  const lastX = xOf(n - 1);
  const lastY = yOf(lastSell);

  const onMove = (clientX: number): void => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setHoverIdx(Math.round(frac * (n - 1)));
  };

  const hv = hoverIdx != null && hoverIdx >= 0 && hoverIdx < n ? hoverIdx : null;
  const hoverLeftPct = hv != null ? (hv / (n - 1)) * 100 : 0;

  return (
    <div
      ref={wrapRef}
      // remount on metal change → fade-in
      key={metalLabel}
      onMouseMove={(e) => onMove(e.clientX)}
      onMouseLeave={() => setHoverIdx(null)}
      onTouchMove={(e) => e.touches[0] && onMove(e.touches[0].clientX)}
      onTouchEnd={() => setHoverIdx(null)}
      style={{
        position: 'relative',
        width: '100%',
        animation: 'w14-fade-in 280ms var(--w14-ease-curator, ease)',
      }}
    >
      <style>{`@keyframes w14-fade-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
        @keyframes w14-pulse{0%{r:4;opacity:.55}70%{r:11;opacity:0}100%{r:11;opacity:0}}`}</style>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Kursverlauf ${metalLabel}`}
        style={{ display: 'block' }}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: accent, stopOpacity: 0.22 }} />
            <stop offset="100%" style={{ stopColor: accent, stopOpacity: 0.02 }} />
          </linearGradient>
        </defs>

        {/* gridlines + y labels */}
        {ticks.map((tv, i) => {
          const y = yOf(tv);
          return (
            <g key={`t${i}`}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={y.toFixed(1)}
                y2={y.toFixed(1)}
                stroke="var(--w14-rule)"
                strokeWidth={0.6}
                opacity={0.6}
              />
              <text
                x={PAD_L + 2}
                y={(y - 3).toFixed(1)}
                fontSize={11}
                fontFamily="var(--w14-font-mono)"
                fill="var(--w14-ink-faded)"
              >
                {fmtEur(tv)}
              </text>
            </g>
          );
        })}

        {/* spread band (Verkauf↔Ankauf) */}
        <path d={band} fill={`url(#${gradId})`} opacity={0.9} />

        {/* Ankauf (buy) line — lighter dashed */}
        <polyline
          points={buyPts.join(' ')}
          fill="none"
          stroke="var(--w14-ink-faded)"
          strokeWidth={1.2}
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
          opacity={0.8}
        />
        {/* Verkauf (sell / spot) line — accent */}
        <polyline
          points={sellPts.join(' ')}
          fill="none"
          stroke={accent}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* live pulse on the last point */}
        <circle cx={lastX.toFixed(1)} cy={lastY.toFixed(1)} r={4} fill={accent}>
          {fetching && (
            <animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite" />
          )}
        </circle>
        <circle cx={lastX.toFixed(1)} cy={lastY.toFixed(1)} fill={accent}>
          <animate attributeName="r" values="4;11;11" dur="1.8s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.5;0;0" dur="1.8s" repeatCount="indefinite" />
        </circle>

        {/* x date labels (first, ~mid, last) */}
        {[0, Math.floor((n - 1) / 2), n - 1].map((i, k) => (
          <text
            key={`x${k}`}
            x={Math.max(PAD_L, Math.min(W - PAD_R, xOf(i))).toFixed(1)}
            y={H - 8}
            fontSize={11}
            fontFamily="var(--w14-font-mono)"
            fill="var(--w14-ink-faded)"
            textAnchor={k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}
          >
            {fmtDate(rows[i]?.t ?? '', true)}
          </text>
        ))}

        {/* crosshair */}
        {hv != null && (
          <g>
            <line
              x1={xOf(hv).toFixed(1)}
              x2={xOf(hv).toFixed(1)}
              y1={PAD_T}
              y2={H - PAD_B}
              stroke="var(--w14-ink)"
              strokeWidth={0.8}
              strokeDasharray="3 3"
              opacity={0.5}
            />
            <circle
              cx={xOf(hv).toFixed(1)}
              cy={yOf(sell[hv] as number).toFixed(1)}
              r={4}
              fill={accent}
              stroke="var(--w14-parchment-2)"
              strokeWidth={1.5}
            />
            <circle
              cx={xOf(hv).toFixed(1)}
              cy={yOf(buy[hv] as number).toFixed(1)}
              r={3.4}
              fill="var(--w14-ink-faded)"
              stroke="var(--w14-parchment-2)"
              strokeWidth={1.5}
            />
          </g>
        )}
      </svg>

      {/* tooltip (HTML overlay, follows the crosshair) */}
      {hv != null && (
        <div
          style={{
            position: 'absolute',
            top: 6,
            left: `${hoverLeftPct}%`,
            transform: `translateX(${hoverLeftPct > 60 ? '-104%' : '8px'})`,
            pointerEvents: 'none',
            background: 'var(--w14-parchment-2)',
            border: '1px solid var(--w14-rule)',
            borderRadius: 'var(--w14-radius-button)',
            boxShadow: 'var(--w14-shadow-modal)',
            padding: '8px 10px',
            fontSize: '0.74rem',
            minWidth: 150,
            zIndex: 5,
          }}
        >
          <div
            className="w14-smallcaps"
            style={{
              color: 'var(--w14-ink-faded)',
              letterSpacing: '0.06em',
              marginBottom: 4,
            }}
          >
            {fmtDate(rows[hv]?.t ?? '', true)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ color: accent }}>Verkauf</span>
            <span className="w14-tabular" style={{ fontFamily: 'var(--w14-font-mono)' }}>
              {fmtEur(sell[hv] as number)} €
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ color: 'var(--w14-ink-faded)' }}>Ankauf</span>
            <span className="w14-tabular" style={{ fontFamily: 'var(--w14-font-mono)' }}>
              {fmtEur(buy[hv] as number)} €
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
