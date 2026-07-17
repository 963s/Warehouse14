/**
 * Zielkarte instruments — pure DOM-SVG (no baked plates).
 *
 * The mobile board lays high-fidelity pre-rendered PNG plates with live SVG
 * overlays; on the desktop we draw every instrument as resolution-independent
 * vector art so it stays crisp on any monitor and ships no assets. Each tile is
 * a self-contained SVG (brass frames, dark glass faces, the red→amber→green
 * ramp) plus a uniform engraved value line below.
 *
 * WebKit note: Tauri on macOS renders through WKWebView, which does NOT animate
 * SVG geometry attributes (x/width/cx/r) via CSS. So every live fill animates
 * only `transform`, `stroke-dashoffset` or `opacity` — all WebKit-safe — and
 * reduced-motion turns the transitions off entirely.
 */

import { useEffect, useState, type ReactNode } from 'react';

import type { GoalMetric, MonthlyBar } from './zielkarte-data.js';

/** A deliberate dark instrument-panel palette, independent of the app theme. */
export const C = {
  page: '#0c0b08',
  panel: '#15130e',
  panelTop: '#1e1a12',
  edge: '#2c271e',
  edgeTop: '#3b3120',
  edgeBottom: '#0a0806',
  ink: '#efe7d6',
  inkMuted: '#9c9384',
  inkFaint: '#6f6757',
  gilt: '#c9a55c',
  giltBright: '#e6c878',
  giltDeep: '#876a2c',
  green: '#74c07a',
  amber: '#e0a63f',
  red: '#d65a3f',
  silver: '#c4c9d0',
  silverDeep: '#7e858f',
  gold: '#d9b154',
  goldDeep: '#9c7a2e',
  glass: '#080706',
  parchment: '#d7c59c',
  parchmentInk: '#3b3020',
} as const;

function toneFor(ratio: number): string {
  if (ratio >= 0.75) return C.green;
  if (ratio >= 0.4) return C.amber;
  return C.red;
}
function bandColor(f: number): string {
  if (f < 0.34) return C.red;
  if (f < 0.66) return C.amber;
  return C.green;
}
function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent): void => setReduced(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

// ─────────────────────────────────────────────────────────────────────────────
// Frame + shared bits
// ─────────────────────────────────────────────────────────────────────────────

function WidgetFrame({
  title,
  zielText,
  children,
}: {
  title: string;
  zielText: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div
      style={{
        position: 'relative',
        background: `linear-gradient(180deg, ${C.panelTop}, ${C.panel})`,
        borderRadius: 12,
        border: `1px solid ${C.edge}`,
        borderTopColor: C.edgeTop,
        borderBottomColor: C.edgeBottom,
        padding: '12px 12px 14px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        overflow: 'hidden',
        boxShadow: 'inset 0 1px 0 rgba(255,240,200,0.06), 0 2px 8px rgba(0,0,0,0.35)',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            color: C.giltBright,
            fontSize: title.length > 14 ? 11 : 12.5,
            fontWeight: 800,
            letterSpacing: title.length > 14 ? '0.06em' : '0.1em',
            textShadow: '0 1px 1px #000',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </div>
        <div style={{ color: C.inkMuted, fontSize: 10, marginTop: 1 }}>{zielText}</div>
      </div>
      {children}
    </div>
  );
}

/** A uniform engraved value line for every tile. */
function ValueLine({ value, pct, tone }: { value: string; pct: string | null; tone: string }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
        marginTop: 2,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <span style={{ color: C.ink, fontSize: 17, fontWeight: 800, textShadow: '0 1px 1px #000' }}>
        {value}
      </span>
      {pct != null && <span style={{ color: tone, fontSize: 12, fontWeight: 800 }}>{pct}</span>}
    </div>
  );
}

function LockedFace(): JSX.Element {
  return (
    <div style={{ width: '100%', display: 'grid', placeItems: 'center', minHeight: 118 }}>
      <svg width="100%" viewBox="0 0 156 118" style={{ maxWidth: 176 }} role="img" aria-label="gleich verfügbar">
        <defs>
          <radialGradient id="lk_glass" cx="0.4" cy="0.35" r="0.8">
            <stop offset="0" stopColor="#181510" />
            <stop offset="1" stopColor="#060504" />
          </radialGradient>
          <linearGradient id="lk_rim" x1="0" y1="0" x2="0.7" y2="1">
            <stop offset="0" stopColor="#565c66" />
            <stop offset="1" stopColor="#17191d" />
          </linearGradient>
        </defs>
        <circle cx={78} cy={56} r={32} fill="url(#lk_glass)" stroke="url(#lk_rim)" strokeWidth={4} />
        <text x={78} y={60} fontSize={9} fontWeight={700} fill={C.inkFaint} textAnchor="middle">
          gleich verfügbar
        </text>
      </svg>
    </div>
  );
}

const brassDefs = (
  <defs>
    <linearGradient id="ziel_brass" x1="0" y1="0" x2="0.85" y2="1">
      <stop offset="0" stopColor="#fdecb2" />
      <stop offset="0.5" stopColor="#c9a55c" />
      <stop offset="1" stopColor="#5c4517" />
    </linearGradient>
    <radialGradient id="ziel_face" cx="0.5" cy="0.28" r="1">
      <stop offset="0" stopColor="#171310" />
      <stop offset="0.7" stopColor="#0c0a07" />
      <stop offset="1" stopColor="#050403" />
    </radialGradient>
    <linearGradient id="ziel_gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#f4d888" />
      <stop offset="0.5" stopColor="#d9b154" />
      <stop offset="1" stopColor="#9c7a2e" />
    </linearGradient>
    <linearGradient id="ziel_silver" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#e8ecf1" />
      <stop offset="0.5" stopColor="#c4c9d0" />
      <stop offset="1" stopColor="#7e858f" />
    </linearGradient>
    <linearGradient id="ziel_merc" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stopColor="#7c1e10" />
      <stop offset="0.5" stopColor="#d63a24" />
      <stop offset="1" stopColor="#ff7c60" />
    </linearGradient>
  </defs>
);

// ─────────────────────────────────────────────────────────────────────────────
// Instruments
// ─────────────────────────────────────────────────────────────────────────────

/** Half-circle brass speedometer: value-arc + swinging needle. */
function ArcGauge({ ratio, reduced }: { ratio: number; reduced: boolean }): JSX.Element {
  const W = 200;
  const H = 116;
  const cx = W / 2;
  const cy = 100;
  const R = 78;
  const semi = Math.PI * R;
  const trans = reduced ? 'none' : `stroke-dashoffset 800ms ${EASE}`;
  const needleTrans = reduced ? 'none' : `transform 800ms ${EASE}`;
  const angle = ratio * 180;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: 210 }}>
      {brassDefs}
      {/* dial ground */}
      <path
        d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`}
        fill="none"
        stroke="#0e0c09"
        strokeWidth={16}
        strokeLinecap="round"
      />
      {/* tick marks */}
      {Array.from({ length: 11 }).map((_, i) => {
        const a = 180 + (i / 10) * 180;
        const p1 = polar(cx, cy, R - 10, a);
        const p2 = polar(cx, cy, R + 2, a);
        return (
          <line
            key={i}
            x1={p1.x}
            y1={p1.y}
            x2={p2.x}
            y2={p2.y}
            stroke={C.giltDeep}
            strokeWidth={i % 5 === 0 ? 2 : 1}
            opacity={0.7}
          />
        );
      })}
      {/* value arc */}
      <path
        d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`}
        fill="none"
        stroke={toneFor(ratio)}
        strokeWidth={11}
        strokeLinecap="round"
        strokeDasharray={semi}
        strokeDashoffset={semi * (1 - Math.max(0.005, ratio))}
        style={{ transition: trans }}
      />
      {/* needle */}
      <g
        style={{ transform: `rotate(${angle}deg)`, transformOrigin: `${cx}px ${cy}px`, transition: needleTrans }}
      >
        <path
          d={`M ${cx} ${cy - 3} L ${cx - R * 0.82} ${cy} L ${cx} ${cy + 3} Z`}
          fill="url(#ziel_brass)"
          stroke="#2a1e08"
          strokeWidth={1}
        />
      </g>
      <circle cx={cx} cy={cy} r={7} fill="#caa55e" stroke="#33270f" strokeWidth={2} />
      <circle cx={cx} cy={cy} r={3} fill="#962214" />
    </svg>
  );
}

/** Closed vault ring of 22 segments, red→amber→green, filled to ratio. */
function VaultRing({ ratio, pct }: { ratio: number; pct: string }): JSX.Element {
  const W = 150;
  const H = 150;
  const cx = W / 2;
  const cy = H / 2;
  const R = 58;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: 150 }}>
      <circle cx={cx} cy={cy} r={R + 12} fill="url(#ziel_face)" stroke="#241f16" strokeWidth={3} />
      {Array.from({ length: 22 }).map((_, i) => {
        const f = i / 21;
        const a0 = -90 + f * 360;
        const p = polar(cx, cy, R, a0);
        const q = polar(cx, cy, R, a0 + 11);
        const filled = f <= ratio || ratio >= 0.999;
        return (
          <path
            key={i}
            d={`M ${p.x} ${p.y} A ${R} ${R} 0 0 1 ${q.x} ${q.y}`}
            stroke={bandColor(f)}
            strokeWidth={9}
            opacity={filled ? 1 : 0.18}
            fill="none"
            style={{ transition: 'opacity 500ms linear' }}
          />
        );
      })}
      <text x={cx} y={cy + 8} fontSize={26} fontWeight={800} fill={C.ink} textAnchor="middle">
        {pct}
      </text>
    </svg>
  );
}

/** Upright thermometer: mercury column fills from the bulb. */
function Thermometer({ ratio, reduced }: { ratio: number; reduced: boolean }): JSX.Element {
  const W = 120;
  const H = 138;
  const tx = W / 2;
  const ty0 = 12;
  const ty1 = 108;
  const tubeH = ty1 - ty0;
  const trans = reduced ? 'none' : `transform 800ms ${EASE}`;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: 120 }}>
      {brassDefs}
      {/* glass tube */}
      <rect x={tx - 11} y={ty0} width={22} height={tubeH} rx={11} fill={C.glass} stroke="#3a3427" strokeWidth={2} />
      {/* mercury — a full column scaled from the bottom */}
      <g style={{ transform: `scaleY(${Math.max(0.02, ratio)})`, transformBox: 'fill-box', transformOrigin: 'bottom', transition: trans }}>
        <rect x={tx - 7} y={ty0} width={14} height={tubeH} rx={7} fill="url(#ziel_merc)" />
      </g>
      <rect x={tx - 6} y={ty0} width={3} height={tubeH} rx={1.5} fill="#fff" opacity={0.35} />
      {/* bulb */}
      <circle cx={tx} cy={ty1 + 12} r={16} fill="#d63a24" stroke="#7c1e10" strokeWidth={2} />
      <circle cx={tx - 5} cy={ty1 + 7} r={4} fill="#ff9c85" opacity={0.7} />
      {/* scale ticks */}
      {Array.from({ length: 6 }).map((_, i) => (
        <line
          key={i}
          x1={tx + 13}
          y1={ty0 + (i / 5) * tubeH}
          x2={tx + 18}
          y2={ty0 + (i / 5) * tubeH}
          stroke={C.inkFaint}
          strokeWidth={1}
        />
      ))}
    </svg>
  );
}

/** Horizontal glass cylinder that fills left→right with molten metal. */
function GlassTank({ ratio, metal, reduced }: { ratio: number; metal: 'gold' | 'silver'; reduced: boolean }): JSX.Element {
  const W = 200;
  const H = 116;
  const x0 = 20;
  const y0 = 26;
  const bw = 160;
  const bh = 64;
  const grad = metal === 'gold' ? 'url(#ziel_gold)' : 'url(#ziel_silver)';
  const trans = reduced ? 'none' : `transform 800ms ${EASE}`;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: 210 }}>
      {brassDefs}
      {/* glass body */}
      <rect x={x0} y={y0} width={bw} height={bh} rx={14} fill={C.glass} stroke="#3a3427" strokeWidth={2.5} />
      {/* metal fill */}
      <clipPath id={`tank_clip_${metal}`}>
        <rect x={x0 + 5} y={y0 + 5} width={bw - 10} height={bh - 10} rx={10} />
      </clipPath>
      <g clipPath={`url(#tank_clip_${metal})`}>
        <g style={{ transform: `scaleX(${Math.max(0.02, ratio)})`, transformBox: 'fill-box', transformOrigin: 'left', transition: trans }}>
          <rect x={x0 + 5} y={y0 + 5} width={bw - 10} height={bh - 10} fill={grad} />
        </g>
      </g>
      {/* glass highlights */}
      <rect x={x0 + 6} y={y0 + 7} width={bw - 12} height={7} rx={3.5} fill="#fff" opacity={0.14} />
      <rect x={x0} y={y0} width={bw} height={bh} rx={14} fill="none" stroke="#000" strokeWidth={1} opacity={0.5} />
    </svg>
  );
}

/** A treasure chest with a filling coin-slot bar. */
function TreasureChest({ ratio, metal, tone, reduced }: { ratio: number; metal: 'gold' | 'silver'; tone: string; reduced: boolean }): JSX.Element {
  const W = 200;
  const H = 116;
  const bx = 42;
  const by = 34;
  const bw = 116;
  const bh = 58;
  const grad = metal === 'gold' ? 'url(#ziel_gold)' : 'url(#ziel_silver)';
  const trans = reduced ? 'none' : `transform 800ms ${EASE}`;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: 210 }}>
      {brassDefs}
      {/* chest lid */}
      <path d={`M ${bx} ${by + 14} Q ${bx} ${by - 10} ${bx + bw / 2} ${by - 10} Q ${bx + bw} ${by - 10} ${bx + bw} ${by + 14} Z`} fill="#4a3722" stroke="#241708" strokeWidth={2} />
      <path d={`M ${bx} ${by + 14} Q ${bx} ${by - 10} ${bx + bw / 2} ${by - 10} Q ${bx + bw} ${by - 10} ${bx + bw} ${by + 14} Z`} fill={grad} opacity={0.25} />
      {/* chest body */}
      <rect x={bx} y={by + 12} width={bw} height={bh} rx={6} fill="#3a2b1a" stroke="#241708" strokeWidth={2} />
      {/* coin slot with fill bar */}
      <rect x={bx + 12} y={by + 30} width={bw - 24} height={12} rx={6} fill="#0d0b08" stroke="#5c4517" strokeWidth={1.5} />
      <clipPath id={`chest_clip_${metal}`}>
        <rect x={bx + 14} y={by + 32} width={bw - 28} height={8} rx={4} />
      </clipPath>
      <g clipPath={`url(#chest_clip_${metal})`}>
        <g style={{ transform: `scaleX(${Math.max(0.02, ratio)})`, transformBox: 'fill-box', transformOrigin: 'left', transition: trans }}>
          <rect x={bx + 14} y={by + 32} width={bw - 28} height={8} fill={tone} />
        </g>
      </g>
      {/* brass bands + lock */}
      <line x1={bx + bw / 2} y1={by - 8} x2={bx + bw / 2} y2={by + 70} stroke="#5c4517" strokeWidth={4} opacity={0.6} />
      <rect x={bx + bw / 2 - 8} y={by + 44} width={16} height={14} rx={2} fill="url(#ziel_brass)" stroke="#241708" strokeWidth={1} />
    </svg>
  );
}

/** A balance scale whose beam tilts toward the value pan as the ratio climbs. */
function BalanceScale({ ratio, reduced }: { ratio: number; reduced: boolean }): JSX.Element {
  const W = 200;
  const H = 116;
  const cx = W / 2;
  const pivotY = 30;
  const tilt = (ratio - 0.5) * 26; // degrees
  const trans = reduced ? 'none' : `transform 800ms ${EASE}`;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: 210 }}>
      {brassDefs}
      {/* column + base */}
      <rect x={cx - 3} y={pivotY} width={6} height={66} fill="url(#ziel_brass)" />
      <rect x={cx - 30} y={98} width={60} height={7} rx={3} fill="url(#ziel_brass)" stroke="#241708" strokeWidth={1} />
      {/* tilting beam + pans */}
      <g style={{ transform: `rotate(${tilt}deg)`, transformOrigin: `${cx}px ${pivotY}px`, transition: trans }}>
        <rect x={cx - 74} y={pivotY - 2.5} width={148} height={5} rx={2.5} fill="url(#ziel_brass)" stroke="#241708" strokeWidth={0.8} />
        <path d={`M ${cx - 74} ${pivotY} L ${cx - 92} ${pivotY + 34} L ${cx - 56} ${pivotY + 34} Z`} fill="none" stroke={C.giltDeep} strokeWidth={1.5} />
        <path d={`M ${cx - 92} ${pivotY + 34} A 18 8 0 0 0 ${cx - 56} ${pivotY + 34}`} fill="url(#ziel_gold)" stroke="#241708" strokeWidth={1} />
        <path d={`M ${cx + 74} ${pivotY} L ${cx + 56} ${pivotY + 34} L ${cx + 92} ${pivotY + 34} Z`} fill="none" stroke={C.giltDeep} strokeWidth={1.5} />
        <path d={`M ${cx + 56} ${pivotY + 34} A 18 8 0 0 0 ${cx + 92} ${pivotY + 34}`} fill="url(#ziel_silver)" stroke="#241708" strokeWidth={1} />
      </g>
      <circle cx={cx} cy={pivotY} r={5} fill="#caa55e" stroke="#33270f" strokeWidth={1.5} />
    </svg>
  );
}

/** A jeweller's loupe whose lens rim fills as a circular progress ring. */
function MagnifierLens({ ratio, pct, tone }: { ratio: number; pct: string; tone: string }): JSX.Element {
  const W = 150;
  const H = 150;
  const cx = 66;
  const cy = 60;
  const R = 46;
  const circ = 2 * Math.PI * R;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: 150 }}>
      {brassDefs}
      {/* handle */}
      <line x1={cx + 30} y1={cy + 34} x2={W - 16} y2={H - 12} stroke="url(#ziel_brass)" strokeWidth={9} strokeLinecap="round" />
      {/* lens glass */}
      <circle cx={cx} cy={cy} r={R} fill="url(#ziel_face)" />
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="#08110d" strokeWidth={7} opacity={0.85} />
      {/* progress ring */}
      <circle
        cx={cx}
        cy={cy}
        r={R}
        fill="none"
        stroke={tone}
        strokeWidth={6}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - Math.max(0.012, ratio))}
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: `stroke-dashoffset 800ms ${EASE}` }}
      />
      {/* brass bezel */}
      <circle cx={cx} cy={cy} r={R + 4} fill="none" stroke="url(#ziel_brass)" strokeWidth={4} />
      <text x={cx} y={cy + 8} fontSize={22} fontWeight={800} fill={C.ink} textAnchor="middle">
        {pct}
      </text>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tile dispatcher
// ─────────────────────────────────────────────────────────────────────────────

export function GoalTile({ metric }: { metric: GoalMetric }): JSX.Element {
  const reduced = useReducedMotion();
  const tone = toneFor(metric.ratio);
  let face: ReactNode;
  if (!metric.available) {
    face = <LockedFace />;
  } else {
    switch (metric.kind) {
      case 'arc':
        face = <ArcGauge ratio={metric.ratio} reduced={reduced} />;
        break;
      case 'ring':
        face = <VaultRing ratio={metric.ratio} pct={metric.pctText ?? ''} />;
        break;
      case 'thermo':
        face = <Thermometer ratio={metric.ratio} reduced={reduced} />;
        break;
      case 'tank':
        face = <GlassTank ratio={metric.ratio} metal={metric.metal ?? 'gold'} reduced={reduced} />;
        break;
      case 'chest':
        face = <TreasureChest ratio={metric.ratio} metal={metric.metal ?? 'gold'} tone={tone} reduced={reduced} />;
        break;
      case 'scale':
        face = <BalanceScale ratio={metric.ratio} reduced={reduced} />;
        break;
      case 'lens':
        face = <MagnifierLens ratio={metric.ratio} pct={metric.pctText ?? ''} tone={tone} />;
        break;
      default:
        face = <LockedFace />;
    }
  }
  return (
    <WidgetFrame title={metric.title} zielText={metric.zielText}>
      {face}
      <ValueLine value={metric.valueText} pct={metric.pctText} tone={tone} />
    </WidgetFrame>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature panels
// ─────────────────────────────────────────────────────────────────────────────

/** Parchment scroll with the five month-goal bars. */
export function GoalsScroll({ bars }: { bars: MonthlyBar[] }): JSX.Element {
  return (
    <div
      style={{
        position: 'relative',
        borderRadius: 12,
        padding: '18px 22px',
        background: `linear-gradient(180deg, #e6d8b2, ${C.parchment})`,
        border: '1px solid #b7a172',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.4), 0 2px 10px rgba(0,0,0,0.4)',
      }}
    >
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <div style={{ color: C.parchmentInk, fontSize: 13, fontWeight: 800, letterSpacing: '0.1em' }}>
          MONATSZIELE
        </div>
        <div style={{ color: C.giltDeep, fontSize: 10 }}>Übersicht</div>
      </div>
      <div style={{ display: 'grid', gap: 12 }}>
        {bars.map((b) => {
          const pct = Math.round(b.ratio * 100);
          const fill = b.ratio >= 0.75 ? '#587f3c' : b.ratio >= 0.4 ? '#b07d22' : '#9c4527';
          return (
            <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ color: C.parchmentInk, fontSize: 12, fontWeight: 700, width: 78 }}>
                {b.label}
              </span>
              <div
                style={{
                  flex: 1,
                  height: 12,
                  borderRadius: 6,
                  background: 'rgba(0,0,0,0.18)',
                  border: '1px solid rgba(0,0,0,0.22)',
                  overflow: 'hidden',
                }}
              >
                {b.available && (
                  <div
                    style={{
                      width: `${pct}%`,
                      height: '100%',
                      borderRadius: 5,
                      background: fill,
                      transition: `width 800ms ${EASE}`,
                    }}
                  />
                )}
              </div>
              <span
                style={{
                  color: C.parchmentInk,
                  fontSize: 12,
                  fontWeight: 800,
                  width: 40,
                  textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {b.available ? `${pct}%` : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Treasure map: a dashed route, a galleon along it, and the overall Zielerreichung. */
export function TreasureMapPanel({ overall, available }: { overall: number; available: boolean }): JSX.Element {
  const W = 420;
  const H = 220;
  const p = Math.max(0, Math.min(1, overall));
  const pct = Math.round(p * 100);
  const routeLen = 520;
  const bez = (a: number, b: number, c: number, d: number, t: number): number => {
    const mt = 1 - t;
    return mt * mt * mt * a + 3 * mt * mt * t * b + 3 * mt * t * t * c + t * t * t * d;
  };
  const shipX = bez(W * 0.12, W * 0.34, W * 0.54, W * 0.82, p);
  const shipY = bez(H * 0.62, H * 0.34, H * 0.82, H * 0.54, p) - H * 0.03;
  const route = `M ${W * 0.12} ${H * 0.62} C ${W * 0.34} ${H * 0.34}, ${W * 0.54} ${H * 0.82}, ${W * 0.82} ${H * 0.54}`;
  return (
    <div
      style={{
        position: 'relative',
        borderRadius: 12,
        overflow: 'hidden',
        background: `radial-gradient(120% 100% at 30% 20%, #e6d8b2, ${C.parchment} 70%, #c6b485)`,
        border: '1px solid #b7a172',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.4), 0 2px 10px rgba(0,0,0,0.4)',
        minHeight: 220,
      }}
    >
      <div style={{ position: 'absolute', top: 14, left: 0, right: 0, textAlign: 'center', zIndex: 2 }}>
        <div style={{ color: '#2e2412', fontSize: 13, fontWeight: 800, letterSpacing: '0.1em' }}>
          GESAMTÜBERSICHT
        </div>
        <div style={{ color: '#6b552c', fontSize: 10 }}>Alle Ziele auf einen Blick</div>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="ziel_hull" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5d4526" />
            <stop offset="1" stopColor="#2c1f0e" />
          </linearGradient>
        </defs>
        {/* faint compass rose */}
        <g transform={`translate(${W * 0.5} ${H * 0.56})`} opacity={0.12}>
          {Array.from({ length: 8 }).map((_, i) => {
            const a = (i * 45 * Math.PI) / 180;
            return (
              <line key={i} x1={0} y1={0} x2={Math.cos(a) * 90} y2={Math.sin(a) * 90} stroke="#3a2c16" strokeWidth={i % 2 === 0 ? 2 : 1} />
            );
          })}
          <circle cx={0} cy={0} r={90} fill="none" stroke="#3a2c16" strokeWidth={1} />
        </g>
        {/* route: laid path + progress */}
        <path d={route} fill="none" stroke="#5c4626" strokeWidth={5.4} opacity={0.35} strokeDasharray="3 14" strokeLinecap="round" />
        <path
          d={route}
          fill="none"
          stroke="#3f2f13"
          strokeWidth={5.6}
          opacity={0.92}
          strokeLinecap="round"
          strokeDasharray={routeLen}
          strokeDashoffset={routeLen * (1 - p)}
          style={{ transition: `stroke-dashoffset 900ms ${EASE}` }}
        />
        {/* X marks the treasure */}
        <g transform={`translate(${W * 0.82} ${H * 0.54})`}>
          <line x1={-7} y1={-7} x2={7} y2={7} stroke="#a02c17" strokeWidth={3} strokeLinecap="round" />
          <line x1={7} y1={-7} x2={-7} y2={7} stroke="#a02c17" strokeWidth={3} strokeLinecap="round" />
        </g>
        {/* galleon */}
        <g transform={`translate(${shipX} ${shipY}) scale(1.5)`} style={{ transition: `transform 900ms ${EASE}` }}>
          <path d="M -16 2 Q 0 9 16 2 L 11 12 L -11 12 Z" fill="url(#ziel_hull)" stroke="#241708" strokeWidth={1} />
          <path d="M -16 2 L 16 2" stroke="#c9a55c" strokeWidth={1.2} />
          <path d="M -6 2 L -6 -20" stroke="#241708" strokeWidth={1.6} />
          <path d="M -6 -19 Q 2 -13 5 -5 L -6 -3 Z" fill="#efe8d5" />
          <path d="M -6 -13 Q -12 -9 -14 -4 L -6 -2.6 Z" fill="#e4dbc4" />
          <path d="M -6 -20.4 L -1 -18.8 L -6 -17.2 Z" fill="#a02c17" />
        </g>
        <text x={W * 0.5} y={H * 0.9} fontSize={30} fontWeight={800} fill={available && pct >= 75 ? '#4e7a3a' : '#6f5620'} textAnchor="middle">
          {available ? `${pct}%` : '—'}
        </text>
        <text x={W * 0.5} y={H * 0.98} fontSize={10} fontWeight={600} fill="#4a3a20" textAnchor="middle">
          Zielerreichung
        </text>
      </svg>
    </div>
  );
}
