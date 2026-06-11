"use client";

/* warehouse14 — der Markenfilm: vom Nachlass zum Schatz.
 *
 * A self-contained, buttery looping "brand film" built from framer-motion +
 * SVG. One rAF timeline drives every scene, inview-gated so the loop only
 * spins while on screen (and resumes where it paused), with a graceful
 * prefers-reduced-motion still frame. The look is an animated engraving on
 * paper: cream grounds, ink line-work, hatching shading. Verdigris appears
 * ONLY as the Geprüft check, wax red ONLY as the seal, and ONE gilt hairline
 * circles the treasure in scene 4 — the single gold moment of the film.
 *
 * The story is the house's true loop: a sealed estate carton lands on the
 * counter, the loupe inspects it, the pieces are sorted into trays, one
 * treasure rises, and the plaque closes the film. German copy only, no dashes.
 */
import { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useInView,
  useReducedMotion,
} from "framer-motion";
import { BrandPlaque } from "@/components/brand/marks";

// ── palette (mirrors the storefront tokens in globals.css) ───────────────────
const INK = "#1c1c1c"; // --w14-ink, primary line-work
const INK_SOFT = "#4c4a45"; // --w14-ink-aged, secondary line-work + copy
const INK_MUTED = "#6e6b64"; // --w14-ink-faded, quiet labels
const RULE = "#e9e7e1"; // --w14-rule, hairlines
const CARD = "#ffffff"; // --w14-parchment-2, card panels
const RAISED = "#f1efea"; // --w14-parchment-3, raised paper
const VERDIGRIS = "#3f6b54"; // --w14-verdigris, the Geprüft check ONLY
const WAX = "#c0492f"; // --w14-wax-red, the seal ONLY
const GILT = "#a3823b"; // --w14-gilt, ONE hairline thread in scene 4 ONLY
const EASE = [0.16, 1, 0.3, 1] as const;

// ── timeline ──────────────────────────────────────────────────────────────────
// One looping clock in SECONDS. Each scene owns a window [start,end). The active
// scene gets a 0..1 local progress; we cross-fade between them. Total = 20 s,
// echoing the "in zwanzig Sekunden" promise in the copy.
const SCENES = [
  { id: "nachlass", at: 0.0, len: 4.0 },
  { id: "pruefung", at: 4.0, len: 4.2 },
  { id: "sortieren", at: 8.2, len: 4.8 },
  { id: "schatz", at: 13.0, len: 4.0 },
  { id: "outro", at: 17.0, len: 3.0 },
] as const;
const LOOP = SCENES.reduce((m, s) => Math.max(m, s.at + s.len), 0);

type SceneId = (typeof SCENES)[number]["id"];

// smootherstep — soft in/out without a library
const ss = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

// ── shared type styles (the film borrows the page's own faces) ───────────────
const DISPLAY = { fontFamily: "var(--font-display), 'Bricolage Grotesque', system-ui, sans-serif" } as const;
const SANS = { fontFamily: "var(--font-inter), system-ui, sans-serif" } as const;

// ── reusable atoms ────────────────────────────────────────────────────────────

function Loupe({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120">
      <defs>
        <radialGradient id="filmLens" cx="0.4" cy="0.35" r="0.8">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.6" />
          <stop offset="0.6" stopColor="#ffffff" stopOpacity="0.12" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <line x1="78" y1="78" x2="112" y2="112" stroke={INK} strokeWidth="11" strokeLinecap="round" />
      <line x1="78" y1="78" x2="112" y2="112" stroke={INK_SOFT} strokeWidth="6" strokeLinecap="round" />
      <circle cx="50" cy="50" r="46" fill="url(#filmLens)" stroke={INK} strokeWidth="6" />
      <circle cx="50" cy="50" r="46" fill="none" stroke={RULE} strokeWidth="1.5" opacity="0.8" />
    </svg>
  );
}

// The rare stamp — perforated edge as a string of round dots, inner frame,
// the house "14" as its quiet denomination. Drawn around (0,0).
function StampGlyph() {
  return (
    <g>
      <rect x={-19} y={-23} width={38} height={46} rx={1} fill={CARD} stroke={INK} strokeWidth={2.2} strokeDasharray="0.1 5" strokeLinecap="round" />
      <rect x={-13.5} y={-17.5} width={27} height={35} fill="none" stroke={INK_SOFT} strokeWidth={1.2} />
      {/* corner hatching, like an engraved vignette */}
      <path d="M -11 -15 L -6 -10 M -11 -10 L -8 -7" stroke={INK_SOFT} strokeWidth={0.9} opacity={0.5} />
      <path d="M 11 13 L 6 8 M 11 8 L 8 5" stroke={INK_SOFT} strokeWidth={0.9} opacity={0.5} />
      <text x={0} y={1.5} textAnchor="middle" dominantBaseline="central" style={DISPLAY} fontWeight={600} fontSize="15" fill={INK}>14</text>
    </g>
  );
}

// A ring in ink line-work: band plus a small cut stone. Drawn around (0,0).
function RingGlyph() {
  return (
    <g>
      <circle cx={0} cy={8} r={13} fill="none" stroke={INK} strokeWidth={3} />
      <circle cx={0} cy={8} r={9.5} fill="none" stroke={INK_SOFT} strokeWidth={0.9} opacity={0.45} />
      <path d="M 0 -19 L 7 -12 L 0 -5 L -7 -12 Z" fill={CARD} stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      <path d="M -7 -12 H 7 M 0 -12 L 0 -5" stroke={INK_SOFT} strokeWidth={0.9} opacity={0.6} />
    </g>
  );
}

// A pocket watch in ink line-work: case, dial, crown. Drawn around (0,0).
function WatchGlyph() {
  return (
    <g>
      <circle cx={0} cy={-29.5} r={3.2} fill="none" stroke={INK} strokeWidth={1.8} />
      <rect x={-3.5} y={-26} width={7} height={5.5} fill={CARD} stroke={INK} strokeWidth={1.8} strokeLinejoin="round" />
      <circle cx={0} cy={0} r={19} fill={CARD} stroke={INK} strokeWidth={2.4} />
      <circle cx={0} cy={0} r={14.5} fill="none" stroke={INK_SOFT} strokeWidth={0.9} opacity={0.6} />
      <path d="M 0 -14.5 V -11 M 0 14.5 V 11 M -14.5 0 H -11 M 14.5 0 H 11" stroke={INK_SOFT} strokeWidth={1.2} opacity={0.7} />
      <path d="M 0 0 L 0 -9 M 0 0 L 6 3.5" stroke={INK} strokeWidth={1.9} strokeLinecap="round" />
      <circle cx={0} cy={0} r={1.6} fill={INK} />
    </g>
  );
}

// The Geprüft tick: verdigris ring + check, drawn in. Verdigris lives ONLY here.
function TrayTick({ x, y, q }: { x: number; y: number; q: number }) {
  const ring = 1 - ss(q);
  const tick = 1 - ss(Math.max(0, (q - 0.35) / 0.65));
  return (
    <g transform={`translate(${x} ${y})`} opacity={q > 0 ? 1 : 0}>
      <circle r={9} fill={CARD} stroke={VERDIGRIS} strokeWidth={1.8} pathLength={1} strokeDasharray={1} strokeDashoffset={ring} />
      <path d="M -4 0.5 L -1.2 3.4 L 4.5 -3.2" fill="none" stroke={VERDIGRIS} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={tick} />
    </g>
  );
}

function Title({ children, sub, p }: { children: React.ReactNode; sub?: string; p: number }) {
  const o = ss(Math.min(1, p / 0.25));
  const y = lerp(20, 0, o);
  return (
    <div style={{ textAlign: "center", transform: `translateY(${y}px)`, opacity: o }}>
      <div style={{ ...DISPLAY, fontWeight: 600, fontSize: "clamp(26px, 4.4vw, 44px)", color: INK, letterSpacing: "-0.015em", lineHeight: 1.08 }}>{children}</div>
      {sub ? <div style={{ ...SANS, fontSize: "clamp(13px, 1.5vw, 18px)", color: INK_SOFT, marginTop: 12, letterSpacing: "0.01em", maxWidth: 560, marginInline: "auto" }}>{sub}</div> : null}
    </div>
  );
}

// ── scenes ───────────────────────────────────────────────────────────────────
// Each receives local progress p∈[0,1]. They are absolutely positioned and
// cross-faded by the stage; inside, every transform is driven by p.

// dust puff strokes around the carton's landing corners
const DUST = [
  { x: 64, y: 198, dx: -0.95, dy: -0.35 },
  { x: 60, y: 203, dx: -1, dy: 0.05 },
  { x: 68, y: 193, dx: -0.7, dy: -0.7 },
  { x: 202, y: 200, dx: 0.95, dy: -0.4 },
  { x: 208, y: 205, dx: 1, dy: 0.05 },
  { x: 198, y: 194, dx: 0.75, dy: -0.7 },
];

function SceneNachlass({ p }: { p: number }) {
  // the carton falls (accelerating), lands on the counter, squashes a breath,
  // and a puff of dust strokes blooms from the corners.
  const dropT = Math.min(1, p / 0.38);
  const dropY = lerp(-190, 0, dropT * dropT);
  const sq = clamp01((p - 0.38) / 0.14);
  const scaleY = 1 - Math.sin(sq * Math.PI) * 0.05;
  const dust = clamp01((p - 0.4) / 0.32);
  const landed = ss(clamp01((p - 0.38) / 0.2));
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-6">
      <Title p={p} sub="Ein Karton voller Geschichte landet auf dem Tresen.">
        Ein Nachlass kommt an
      </Title>
      <svg viewBox="0 0 300 230" style={{ width: "min(78%, 330px)", overflow: "visible" }} aria-hidden="true">
        {/* the counter — one quiet ink rule */}
        <line x1="18" y1="206" x2="282" y2="206" stroke={INK} strokeWidth="2" opacity="0.85" />
        <line x1="34" y1="213" x2="266" y2="213" stroke={INK_SOFT} strokeWidth="1" opacity="0.3" />
        {/* contact shadow once the carton sits */}
        <ellipse cx="136" cy="205" rx="72" ry="3.4" fill={INK} opacity={0.07 * landed} />
        {/* the worn, sealed carton */}
        <g transform={`translate(0 ${dropY})`}>
          <g transform={`translate(136 204) scale(1 ${scaleY}) translate(-136 -204)`}>
            {/* top face */}
            <path d="M 70 118 L 126 98 L 252 104 L 198 122 Z" fill={CARD} stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
            {/* flap seam + sealing tape */}
            <path d="M 98 108 L 225 113" stroke={INK_SOFT} strokeWidth="1.4" opacity="0.8" />
            <path d="M 154 103 L 168 100 L 174 116 L 160 119 Z" fill={RULE} stroke={INK_SOFT} strokeWidth="1.2" opacity="0.9" />
            {/* side face with hatching shade */}
            <path d="M 198 122 L 252 104 L 254 182 L 196 204 Z" fill={RAISED} stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
            {Array.from({ length: 5 }).map((_, i) => (
              <line key={i} x1={210 + i * 9} y1={132 + i * 2} x2={203 + i * 9} y2={158 + i * 4} stroke={INK_SOFT} strokeWidth="1" opacity="0.35" />
            ))}
            {/* front face, an old label with an unreadable hand */}
            <path d="M 70 118 L 68 200 L 196 204 L 198 122 Z" fill={CARD} stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
            <rect x="92" y="140" width="56" height="32" rx="2" fill={CARD} stroke={INK_SOFT} strokeWidth="1.3" />
            <path d="M 100 151 L 138 152 M 100 160 L 126 161" stroke={INK_SOFT} strokeWidth="1.3" opacity="0.6" />
            {/* worn scuffs */}
            <path d="M 76 188 L 84 182 M 80 194 L 90 187 M 178 130 L 186 126" stroke={INK_SOFT} strokeWidth="1.1" opacity="0.4" />
          </g>
        </g>
        {/* dust puff strokes on landing */}
        {DUST.map((d, i) => {
          const o = Math.sin(clamp01(dust) * Math.PI);
          const off = 4 + dust * 17;
          return (
            <line
              key={i}
              x1={d.x + d.dx * off}
              y1={d.y + d.dy * off}
              x2={d.x + d.dx * (off + 11)}
              y2={d.y + d.dy * (off + 11)}
              stroke={INK_SOFT}
              strokeWidth="1.7"
              strokeLinecap="round"
              opacity={o * 0.75}
            />
          );
        })}
      </svg>
    </div>
  );
}

// what peeks out of the opened carton, left to right; revealed as the loupe passes
const SILHOUETTES = [0.2, 0.38, 0.56];

function ScenePruefung({ p }: { p: number }) {
  const sweep = ss(clamp01((p - 0.08) / 0.62));
  const left = lerp(18, 82, sweep);
  const rev = SILHOUETTES.map((t) => ss(Math.max(0, (p - t) / 0.18)));
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-5 px-6">
      <Title p={p} sub="Die Lupe entscheidet, Stück für Stück.">
        Die Prüfung
      </Title>
      <div style={{ position: "relative", width: "min(72%, 360px)" }}>
        <svg viewBox="0 0 280 200" style={{ width: "100%", display: "block", overflow: "visible" }} aria-hidden="true">
          {/* back flaps, standing open */}
          <path d="M 88 84 L 82 34 L 128 36 L 134 84 Z" fill={CARD} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" opacity="0.9" />
          <path d="M 150 84 L 158 36 L 202 40 L 196 86 Z" fill={CARD} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" opacity="0.9" />
          {/* the dark of the open carton */}
          <path d="M 60 90 L 64 76 L 218 79 L 222 93 Z" fill={INK} opacity="0.07" />
          {/* objects silhouetted inside: a frame, a ring, a pocket watch */}
          <g opacity={rev[0]}>
            <rect x="92" y="58" width="28" height="34" fill={INK} opacity="0.82" />
            <rect x="97" y="63" width="18" height="24" fill={RAISED} />
          </g>
          <g opacity={rev[1]}>
            <circle cx="156" cy="76" r="10" fill="none" stroke={INK} strokeWidth="4.5" opacity="0.85" />
            <path d="M 156 56 L 161 61 L 156 66 L 151 61 Z" fill={INK} opacity="0.85" />
          </g>
          <g opacity={rev[2]}>
            <circle cx="196" cy="78" r="12" fill={INK} opacity="0.82" />
            <rect x="193" y="60" width="6" height="6" fill={INK} opacity="0.82" />
          </g>
          {/* splayed side flaps + front face */}
          <path d="M 58 90 L 16 68 L 28 44 L 64 78 Z" fill={RAISED} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
          <path d="M 222 93 L 264 72 L 252 47 L 216 80 Z" fill={RAISED} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
          <path d="M 58 90 L 56 176 L 224 179 L 222 93 Z" fill={CARD} stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
          <rect x="86" y="116" width="50" height="28" rx="2" fill={CARD} stroke={INK_SOFT} strokeWidth="1.2" />
          <path d="M 93 126 L 128 127 M 93 134 L 116 135" stroke={INK_SOFT} strokeWidth="1.2" opacity="0.6" />
          {Array.from({ length: 4 }).map((_, i) => (
            <line key={i} x1={176 + i * 10} y1={128 + i * 3} x2={168 + i * 10} y2={158 + i * 3} stroke={INK_SOFT} strokeWidth="1" opacity="0.28" />
          ))}
        </svg>
        {/* the loupe sweeps the opening once — the meaningful gesture */}
        <div style={{ position: "absolute", top: "38%", left: `${left}%`, transform: "translate(-50%, -50%)" }}>
          <Loupe size={104} />
        </div>
      </div>
    </div>
  );
}

// the three trays: where each kind of piece comes to rest
const TRAYS = [
  { cx: 85, label: "Schmuck", endY: 184 },
  { cx: 230, label: "Uhren", endY: 176 },
  { cx: 375, label: "Briefmarken", endY: 174 },
] as const;
const GLIDE_START = [0.08, 0.28, 0.48];

function SceneSortieren({ p }: { p: number }) {
  const e = GLIDE_START.map((t) => ss(clamp01((p - t) / 0.18)));
  const ticks = GLIDE_START.map((t) => clamp01((p - (t + 0.2)) / 0.12));
  const sq = clamp01((p - 0.76) / 0.12);
  const sealScale = lerp(1.8, 1, ss(sq));
  const sealO = ss(sq) * 0.92;
  const glyphs = [RingGlyph, WatchGlyph, StampGlyph];
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-6">
      <Title p={p} sub="Schmuck, Uhren, Briefmarken, jedes Stück findet sein Fach.">
        Das Sortieren
      </Title>
      <svg viewBox="0 0 460 280" style={{ width: "min(92%, 520px)", overflow: "visible" }} aria-hidden="true">
        {/* trays */}
        {TRAYS.map((t) => (
          <g key={t.label}>
            <path d={`M ${t.cx - 58} 200 L ${t.cx - 50} 240 L ${t.cx + 50} 240 L ${t.cx + 58} 200 Z`} fill={CARD} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
            <path d={`M ${t.cx - 54} 208 L ${t.cx + 54} 208`} stroke={INK_SOFT} strokeWidth="1" opacity="0.45" />
            <text x={t.cx} y={262} textAnchor="middle" style={SANS} fontSize="13" fill={INK_MUTED} letterSpacing="0.06em">{t.label}</text>
          </g>
        ))}
        {/* the pieces glide in from above, each settling with a gentle tick */}
        {TRAYS.map((t, i) => {
          const Glyph = glyphs[i];
          const ei = e[i];
          const x = lerp(230, t.cx, ei);
          const y = lerp(6, t.endY, ei) - Math.sin(ei * Math.PI) * 36;
          return (
            <g key={t.label} transform={`translate(${x} ${y})`} opacity={Math.min(1, ei * 5)}>
              <Glyph />
            </g>
          );
        })}
        {TRAYS.map((t, i) => (
          <TrayTick key={t.label} x={t.cx + 44} y={168} q={ticks[i]} />
        ))}
        {/* the wax seal stamps down: Geprüft */}
        <g transform={`translate(230 88) rotate(-10) scale(${sealScale})`} opacity={sealO}>
          <circle r={46} fill="none" stroke={WAX} strokeWidth={3} />
          <circle r={38} fill="none" stroke={WAX} strokeWidth={1.2} />
          <circle cy={-17} r={1.8} fill={WAX} />
          <circle cy={17} r={1.8} fill={WAX} />
          <text y={1} textAnchor="middle" dominantBaseline="central" style={SANS} fontWeight={700} fontSize="14" letterSpacing="0.18em" fill={WAX}>GEPRÜFT</text>
        </g>
      </svg>
    </div>
  );
}

function SceneSchatz({ p }: { p: number }) {
  const rise = ss(clamp01((p - 0.04) / 0.32));
  const gilt = ss(clamp01((p - 0.4) / 0.34));
  const tag = ss(clamp01((p - 0.66) / 0.2));
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6">
      <Title p={p} sub="Ein Stück sticht heraus.">
        Der Schatz
      </Title>
      <svg viewBox="0 0 320 290" style={{ width: "min(82%, 330px)", overflow: "visible" }} aria-hidden="true">
        {/* the piece rises to centre stage */}
        <g transform={`translate(0 ${lerp(64, 0, rise)})`} opacity={rise}>
          <g transform="translate(160 112) scale(2.15)">
            <StampGlyph />
          </g>
        </g>
        {/* the ONLY gold of the film: one gilt hairline circles the treasure once */}
        <circle
          cx={160}
          cy={112}
          r={88}
          fill="none"
          stroke={GILT}
          strokeWidth={1.4}
          opacity={0.9}
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - gilt}
          transform="rotate(-90 160 112)"
        />
        {/* a quiet value tag — deliberately without a number */}
        <g opacity={tag} transform={`translate(0 ${lerp(10, 0, tag)})`}>
          <line x1={160} y1={166} x2={160} y2={228} stroke={INK_SOFT} strokeWidth={1} opacity={0.55} />
          <rect x={96} y={228} width={128} height={32} rx={16} fill={CARD} stroke={RULE} strokeWidth={1.5} />
          <text x={160} y={245} textAnchor="middle" dominantBaseline="central" style={SANS} fontWeight={500} fontSize="14.5" fill={INK}>Fair bewertet</text>
        </g>
      </svg>
    </div>
  );
}

function SceneOutro({ p }: { p: number }) {
  const settle = ss(Math.min(1, p / 0.4));
  const word = ss(Math.max(0, (p - 0.3) / 0.4));
  return (
    <div className="grid h-full w-full place-items-center px-6">
      <div className="flex flex-col items-center">
        {/* the full shop plaque settles in ink on cream — the registered mark, never redrawn */}
        <div
          style={{
            color: INK,
            width: "clamp(190px, 30vw, 290px)",
            opacity: settle,
            transform: `translateY(${lerp(12, 0, settle)}px) scale(${lerp(1.05, 1, settle)})`,
          }}
        >
          <BrandPlaque className="h-auto w-full" />
        </div>
        <div
          style={{
            ...DISPLAY,
            fontWeight: 600,
            fontSize: "clamp(20px, 3.2vw, 34px)",
            color: INK,
            letterSpacing: "-0.01em",
            textAlign: "center",
            maxWidth: 560,
            marginTop: 18,
            opacity: word,
            transform: `translateY(${lerp(10, 0, word)}px)`,
          }}
        >
          warehouse14. Vom Nachlass in gute Hände.
        </div>
      </div>
    </div>
  );
}

const SCENE_CMP: Record<SceneId, (props: { p: number }) => React.JSX.Element> = {
  nachlass: SceneNachlass,
  pruefung: ScenePruefung,
  sortieren: SceneSortieren,
  schatz: SceneSchatz,
  outro: SceneOutro,
};

// A short German caption per scene, shown bottom-left like a film lower-third.
const CAPTIONS: Record<SceneId, string> = {
  nachlass: "Schritt 1, der Nachlass kommt an",
  pruefung: "Schritt 2, die Prüfung",
  sortieren: "Schritt 3, das Sortieren",
  schatz: "Schritt 4, der Schatz",
  outro: "warehouse14, vom Nachlass in gute Hände",
};

// ── the looping stage ─────────────────────────────────────────────────────────

// The frame the film parks on before its clock has ever run: late in scene 1,
// the carton landed on the counter, dust settled, title up. A composed still,
// so a delayed rAF or a silent observer never leaves an empty cream band.
const POSTER_T = SCENES[0].at + SCENES[0].len * 0.85;

export function ExplainerPlayer() {
  const wrap = useRef<HTMLElement>(null);
  // amount 0.3: the clock starts rolling as soon as a third of the stage is
  // up, so the film is already alive while it slides into view.
  const inView = useInView(wrap, { amount: 0.3 });
  const reduce = useReducedMotion();
  const [clock, setClock] = useState(POSTER_T); // seconds within LOOP
  // where the film stood when it last paused — lets scrolling away and back
  // RESUME the story instead of restarting it (a real player's behaviour).
  // Starts at 0 so the first real playback tells the story from the top.
  const playedRef = useRef(0);

  // One rAF clock, timestamp-based so pacing is identical at any frame rate.
  // Pauses entirely when off-screen or under reduced motion, so the loop is
  // free when idle and never fights the user's preference.
  useEffect(() => {
    if (reduce) {
      // park on the "pruefung" beat — the loupe over the carton, the most
      // legible, brand-rich still frame
      setClock(SCENES[1].at + SCENES[1].len * 0.6);
      return;
    }
    if (!inView) return;
    let raf = 0;
    let start = 0;
    const tick = (ts: number) => {
      // re-anchor the clock so the loop continues from where it paused
      if (!start) start = ts - playedRef.current * 1000;
      const t = ((ts - start) / 1000) % LOOP;
      playedRef.current = t;
      setClock(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, reduce]);

  // resolve which scene(s) are visible + their local progress
  const active = SCENES.find((s) => clock >= s.at && clock < s.at + s.len) ?? SCENES[0];
  const local = Math.min(1, Math.max(0, (clock - active.at) / active.len));
  // cross-fade: fade the previous out in the first 0.5 s of each scene.
  // While the clock is PAUSED (off screen, not started yet, reduced motion)
  // the film is a still photograph at full opacity — never parked inside a
  // cross-fade dip, never an invisible frame.
  const fadeIn = ss(Math.min(1, local / 0.12));
  const fadeOut = ss(Math.min(1, (1 - local) / 0.1));
  const sceneOpacity = reduce || !inView ? 1 : Math.min(fadeIn, fadeOut);

  // progress dots across the bottom — the film's "chapters"
  const overallProgress = clock / LOOP;

  const ActiveScene = SCENE_CMP[active.id];

  // NO inview-coupled fade on the figure itself: a fade keyed to a live
  // observer un-paints the whole band while it is partially on screen (the
  // exact dead-cream void reviewers caught). The stage always paints; only
  // the CLOCK pauses off screen.
  return (
    <figure
      ref={wrap}
      aria-label="Markenfilm: vom Nachlass zum Schatz. Ein Karton kommt an, wird geprüft, sortiert und fair bewertet."
      className="group relative m-0"
    >
      {/* Full-bleed stage — no frame, no rounding: the film is a band woven
          straight into the page. The stage stays transparent so the section's
          cream ground carries through and the film reads as ink on the page
          itself, like an animated engraving. */}
      <div className="relative aspect-[4/5] w-full overflow-hidden sm:aspect-video">
        {/* the film stage */}
        <div className="absolute inset-0" style={{ opacity: sceneOpacity }}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={active.id}
              className="absolute inset-0"
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduce ? undefined : { opacity: 0 }}
              transition={{ duration: 0.3, ease: EASE }}
            >
              <ActiveScene p={local} />
            </motion.div>
          </AnimatePresence>
        </div>

        {/* lower-third caption — light glass over paper, hairline edge */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 px-5 pb-5 md:px-8 md:pb-7">
          <AnimatePresence mode="wait">
            <motion.span
              key={active.id}
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.4, ease: EASE }}
              className="rounded-full px-3 py-1.5"
              style={{
                ...SANS,
                fontSize: "clamp(11px, 1.4vw, 14px)",
                color: INK_SOFT,
                letterSpacing: "0.04em",
                background: "rgba(250,249,246,0.82)",
                border: `1px solid ${RULE}`,
                backdropFilter: "blur(6px)",
              }}
            >
              {CAPTIONS[active.id]}
            </motion.span>
          </AnimatePresence>

          {/* chapter dots */}
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {SCENES.map((s) => {
              const on = s.id === active.id;
              return (
                <span
                  key={s.id}
                  style={{
                    width: on ? 18 : 6,
                    height: 6,
                    borderRadius: 999,
                    background: on ? INK : "rgba(28,28,28,0.22)",
                    transition: "width 0.4s cubic-bezier(0.16,1,0.3,1), background 0.4s",
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* top progress hairline — the film's timeline, a quiet ink rule */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px]" aria-hidden="true">
          <div
            className="h-full origin-left"
            style={{ background: INK, opacity: 0.7, transform: `scaleX(${reduce ? 1 : overallProgress})` }}
          />
        </div>
      </div>
    </figure>
  );
}
