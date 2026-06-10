/* warehouse14 storefront, brand explainer video (Remotion composition).
 *
 * NOTE: the live storefront section no longer embeds the @remotion/player —
 * in the Next.js standalone production build the Player mounted but rendered no
 * <video> and logged a licence warning, so the on-page film was replaced by a
 * self-contained framer-motion piece (see components/sections/explainer-player).
 * This file is kept as the CANONICAL composition for offline/MP4 renders (e.g.
 * `npx remotion render`) and as the source of the on-page scene DNA. Anyone who
 * re-embeds a <Player> here MUST pass `acknowledgeRemotionLicense` (see the
 * RemotionRoot + ACKNOWLEDGE_REMOTION_LICENSE note at the bottom) to silence the
 * licence banner. Everything is frame driven, no CSS transitions (those do not
 * render). Warm, antique, with physics (springs) and nature (drifting gold
 * dust) in the DNA. German copy only.
 */
import React from "react";
import {
  AbsoluteFill,
  Composition,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from "remotion";
import { SYMBOL_PATHS, SYMBOL_TINTS, type SymbolKey } from "@/components/collection-symbols";

export const EXPLAINER = { fps: 30, durationInFrames: 620, width: 1280, height: 720 };

// ── palette (mirrors the storefront tokens) ──────────────────────────────────
const GOLD = "#bf9430";
const GOLD_SOFT = "#e7d49b";
const GOLD_DEEP = "#8a6a1f";
const PAPER = "#fdfaf3";
const INK = "#17130c";
const VERDIGRIS = "#3f6b54";
const WAX = "#c0492f";
const SERIF = 'var(--font-cormorant), "Fraunces", Georgia, serif';
const SANS = 'var(--font-inter), system-ui, sans-serif';
const EASE = Easing.bezier(0.16, 1, 0.3, 1);

// deterministic pseudo random (no Math.random, render safe)
const rnd = (i: number, s: number) => {
  const x = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

// opacity envelope for a scene of length `dur`
const envelope = (frame: number, dur: number, inF = 12, outF = 16) =>
  interpolate(frame, [0, inF, dur - outF, dur], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

// ── shared atoms ─────────────────────────────────────────────────────────────

const Emblem: React.FC<{ size: number; progress: number }> = ({ size, progress }) => {
  // progress 0..1 draws the rings, then "14" settles in
  const ring = interpolate(progress, [0, 0.7], [1, 0], { extrapolateRight: "clamp" });
  const num = interpolate(progress, [0.45, 1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const ticks = Array.from({ length: 48 });
  return (
    <svg width={size} height={size} viewBox="0 0 200 200">
      <defs>
        <linearGradient id="g-emblem" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={GOLD_SOFT} />
          <stop offset="0.5" stopColor={GOLD} />
          <stop offset="1" stopColor={GOLD_DEEP} />
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="92" fill="none" stroke="url(#g-emblem)" strokeWidth="2.5"
        pathLength={1} strokeDasharray={1} strokeDashoffset={ring} />
      <circle cx="100" cy="100" r="78" fill="none" stroke="url(#g-emblem)" strokeWidth="1"
        opacity={0.55} pathLength={1} strokeDasharray={1} strokeDashoffset={ring} />
      <g opacity={interpolate(progress, [0.2, 0.6], [0, 0.9], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}>
        {ticks.map((_, i) => {
          const a = (i / ticks.length) * Math.PI * 2;
          const big = i % 4 === 0;
          const r1 = big ? 70 : 73;
          return (
            <line key={i} x1={100 + Math.cos(a) * r1} y1={100 + Math.sin(a) * r1}
              x2={100 + Math.cos(a) * 76} y2={100 + Math.sin(a) * 76}
              stroke={GOLD} strokeWidth={big ? 1.6 : 0.8} opacity={big ? 0.9 : 0.5} />
          );
        })}
      </g>
      <g transform={`translate(100 100) scale(${0.7 + num * 0.3})`} opacity={num}>
        <text x="0" y="0" textAnchor="middle" dominantBaseline="central"
          fontFamily={SERIF} fontWeight={600} fontSize="74" fill="url(#g-emblem)" letterSpacing="-3">14</text>
      </g>
    </svg>
  );
};

const Coin: React.FC<{ size: number; shimmer?: number }> = ({ size, shimmer = 0 }) => (
  <svg width={size} height={size} viewBox="0 0 200 200">
    <defs>
      <radialGradient id="g-coin" cx="0.38" cy="0.34" r="0.9">
        <stop offset="0" stopColor="#fbeec2" />
        <stop offset="0.4" stopColor={GOLD_SOFT} />
        <stop offset="0.75" stopColor={GOLD} />
        <stop offset="1" stopColor={GOLD_DEEP} />
      </radialGradient>
    </defs>
    <circle cx="100" cy="100" r="94" fill="url(#g-coin)" stroke={GOLD_DEEP} strokeWidth="3" />
    <circle cx="100" cy="100" r="80" fill="none" stroke={GOLD_DEEP} strokeWidth="1.5" opacity="0.5" />
    {Array.from({ length: 60 }).map((_, i) => {
      const a = (i / 60) * Math.PI * 2;
      return <line key={i} x1={100 + Math.cos(a) * 84} y1={100 + Math.sin(a) * 84}
        x2={100 + Math.cos(a) * 92} y2={100 + Math.sin(a) * 92} stroke={GOLD_DEEP} strokeWidth="1" opacity="0.4" />;
    })}
    <text x="100" y="104" textAnchor="middle" dominantBaseline="central"
      fontFamily={SERIF} fontWeight={600} fontSize="86" fill={GOLD_DEEP} letterSpacing="-4">14</text>
    {/* moving specular glint */}
    <ellipse cx={40 + shimmer * 120} cy={62} rx="26" ry="54" fill="#fff" opacity={0.18}
      transform={`rotate(20 ${40 + shimmer * 120} 62)`} />
  </svg>
);

const Loupe: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 120 120">
    <defs>
      <radialGradient id="g-lens" cx="0.4" cy="0.35" r="0.8">
        <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
        <stop offset="0.6" stopColor="#ffffff" stopOpacity="0.08" />
        <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
      </radialGradient>
    </defs>
    <line x1="78" y1="78" x2="112" y2="112" stroke={GOLD_DEEP} strokeWidth="11" strokeLinecap="round" />
    <line x1="78" y1="78" x2="112" y2="112" stroke={GOLD} strokeWidth="6" strokeLinecap="round" />
    <circle cx="50" cy="50" r="46" fill="url(#g-lens)" stroke={GOLD} strokeWidth="6" />
    <circle cx="50" cy="50" r="46" fill="none" stroke={GOLD_SOFT} strokeWidth="1.5" opacity="0.8" />
  </svg>
);

const Check: React.FC<{ progress: number }> = ({ progress }) => (
  <svg width="22" height="22" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="11" fill="none" stroke={VERDIGRIS} strokeWidth="2"
      pathLength={1} strokeDasharray={1} strokeDashoffset={1 - progress} />
    <path d="M7 12.5 L10.5 16 L17 8.5" fill="none" stroke={VERDIGRIS} strokeWidth="2.4"
      strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1}
      strokeDashoffset={1 - interpolate(progress, [0.4, 1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
  </svg>
);

// ── persistent ambience ──────────────────────────────────────────────────────

const GoldDust: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames, height, width } = useVideoConfig();
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {Array.from({ length: 34 }).map((_, i) => {
        const x0 = rnd(i, 1) * width;
        const sway = Math.sin((frame / 40) + i) * (8 + rnd(i, 2) * 26);
        const speed = 0.18 + rnd(i, 3) * 0.5;
        const y = height + 40 - ((frame * speed + rnd(i, 4) * durationInFrames) % (height + 120));
        const size = 1.5 + rnd(i, 5) * 4;
        // each mote breathes (twinkles) on its own phase — a living, never-static field
        const twinkle = 0.55 + 0.45 * Math.sin(frame / (7 + rnd(i, 7) * 9) + i * 1.7);
        const op = (0.12 + rnd(i, 6) * 0.4) * twinkle;
        return (
          <div key={i} style={{
            position: "absolute", left: x0 + sway, top: y, width: size, height: size,
            borderRadius: "50%", background: GOLD_SOFT, opacity: op, filter: "blur(0.5px)",
            boxShadow: `0 0 ${size * (3 + twinkle * 2)}px ${GOLD}`,
          }} />
        );
      })}
    </AbsoluteFill>
  );
};

const SceneTitle: React.FC<{ children: React.ReactNode; frame: number; sub?: string }> = ({ children, frame, sub }) => {
  const y = interpolate(frame, [0, 22], [22, 0], { extrapolateRight: "clamp", easing: EASE });
  const o = interpolate(frame, [0, 22], [0, 1], { extrapolateRight: "clamp" });
  return (
    <div style={{ textAlign: "center", transform: `translateY(${y}px)`, opacity: o }}>
      <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 50, color: PAPER, letterSpacing: "-0.01em", lineHeight: 1.05 }}>{children}</div>
      {sub ? <div style={{ fontFamily: SANS, fontSize: 19, color: GOLD_SOFT, marginTop: 12, letterSpacing: "0.02em" }}>{sub}</div> : null}
    </div>
  );
};

// ── scenes ───────────────────────────────────────────────────────────────────

const Intro: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const grow = spring({ frame, fps, config: { damping: 16, mass: 0.8 }, durationInFrames: 50 });
  const wordO = interpolate(frame, [26, 46], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const wordY = interpolate(frame, [26, 46], [18, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: envelope(frame, dur) }}>
      <div style={{ transform: `scale(${0.6 + grow * 0.4})` }}>
        <Emblem size={210} progress={interpolate(frame, [4, 50], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
      </div>
      <div style={{ opacity: wordO, transform: `translateY(${wordY}px)`, textAlign: "center", marginTop: 14 }}>
        <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 58, color: PAPER, letterSpacing: "0.04em" }}>
          WAREHOUSE<span style={{ color: GOLD }}>14</span>
        </div>
        <div style={{ fontFamily: SANS, fontSize: 17, color: GOLD_SOFT, letterSpacing: "0.32em", marginTop: 8 }}>
          GOLD · MÜNZEN · ANTIQUITÄTEN · SCHORNDORF
        </div>
      </div>
    </AbsoluteFill>
  );
};

const PRICES = [
  { m: "Gold", v: "76,42", c: "+0,84", up: true },
  { m: "Silber", v: "0,92", c: "+1,21", up: true },
  { m: "Platin", v: "31,78", c: "-0,36", up: false },
  { m: "Palladium", v: "28,14", c: "+0,42", up: true },
];

const LivePrices: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pts = [38, 34, 40, 30, 33, 26, 24, 18, 22, 14, 12, 8];
  const dPath = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${i * (560 / (pts.length - 1))} ${p}`).join(" ");
  const draw = interpolate(frame, [18, 70], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
  const pulse = 0.5 + 0.5 * Math.sin(frame / 5);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: envelope(frame, dur), padding: 70 }}>
      <SceneTitle frame={frame} sub="Tagespreise direkt aus dem Markt, automatisch im Laden und online.">
        Preise. Live. Jeden Tag.
      </SceneTitle>
      <div style={{ display: "flex", gap: 16, marginTop: 36 }}>
        {PRICES.map((p, i) => {
          const s = spring({ frame: frame - 20 - i * 6, fps, config: { damping: 18 }, durationInFrames: 30 });
          return (
            <div key={p.m} style={{
              transform: `translateY(${(1 - s) * 26}px)`, opacity: s,
              background: "rgba(253,250,243,0.05)", border: "1px solid rgba(191,148,48,0.35)",
              borderRadius: 16, padding: "16px 20px", minWidth: 150, backdropFilter: "blur(4px)",
            }}>
              <div style={{ fontFamily: SANS, fontSize: 13, color: GOLD_SOFT, letterSpacing: "0.12em", textTransform: "uppercase" }}>{p.m}</div>
              <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 30, color: PAPER, fontVariantNumeric: "tabular-nums" }}>{p.v}<span style={{ fontSize: 15, color: GOLD_SOFT }}> €/g</span></div>
              <div style={{ fontFamily: SANS, fontSize: 14, color: p.up ? "#6fae86" : WAX, fontVariantNumeric: "tabular-nums" }}>{p.up ? "▲" : "▼"} {p.c}%</div>
            </div>
          );
        })}
      </div>
      <svg width="560" height="56" viewBox="0 -4 560 52" style={{ marginTop: 30, overflow: "visible" }}>
        <defs>
          <linearGradient id="g-spark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={GOLD} stopOpacity="0.4" />
            <stop offset="1" stopColor={GOLD} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${dPath} L 560 48 L 0 48 Z`} fill="url(#g-spark)" opacity={interpolate(frame, [40, 70], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
        <path d={dPath} fill="none" stroke={GOLD} strokeWidth="2.5" strokeLinecap="round"
          pathLength={1} strokeDasharray={1} strokeDashoffset={draw} />
      </svg>
      <div style={{ position: "absolute", top: 36, right: 56, display: "flex", alignItems: "center", gap: 8, opacity: 0.9 }}>
        <div style={{ width: 9, height: 9, borderRadius: "50%", background: VERDIGRIS, opacity: 0.4 + pulse * 0.6, boxShadow: `0 0 10px ${VERDIGRIS}` }} />
        <span style={{ fontFamily: SANS, fontSize: 12, color: GOLD_SOFT, letterSpacing: "0.18em" }}>LIVE</span>
      </div>
    </AbsoluteFill>
  );
};

const FACTS = ["Material spektral geprüft", "Gewicht bestätigt, 31,1035 g", "Feingehalt 999,9", "Echtheit zertifiziert"];

const Pruefung: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const sweep = interpolate(frame, [24, 92], [-150, 150], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.ease) });
  // the loupe drags a gleam across the coin once, then the coin keeps a slow
  // continuous specular drift so it never freezes — luxury surfaces breathe.
  const sweepShimmer = interpolate(frame, [24, 92], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const idleShimmer = 0.5 + 0.5 * Math.sin(frame / 26);
  const shimmer = frame < 92 ? sweepShimmer : idleShimmer;
  const breathe = 1 + Math.sin(frame / 22) * 0.012;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: envelope(frame, dur) }}>
      <div style={{ position: "absolute", top: 64 }}>
        <SceneTitle frame={frame}>Jedes Stück wird geprüft.</SceneTitle>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 64, marginTop: 30 }}>
        <div style={{ position: "relative", transform: `scale(${breathe})` }}>
          <div style={{ position: "absolute", inset: -36, borderRadius: "50%", background: `radial-gradient(circle, ${GOLD}33, transparent 70%)` }} />
          <Coin size={250} shimmer={shimmer} />
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: `translate(calc(-50% + ${sweep}px), -58%)` }}>
            <Loupe size={130} />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 320 }}>
          {FACTS.map((f, i) => {
            const p = interpolate(frame, [34 + i * 13, 52 + i * 13], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            return (
              <div key={f} style={{ display: "flex", alignItems: "center", gap: 14, opacity: p, transform: `translateX(${(1 - p) * 16}px)` }}>
                <Check progress={p} />
                <span style={{ fontFamily: SANS, fontSize: 21, color: PAPER }}>{f}</span>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// The breadth of the house, crafted line-art per world.
const PIECES: SymbolKey[] = ["muenzen", "edelmetalle", "sammlerobjekte", "briefmarken", "schmuck", "antiquitaeten"];

const Vielfalt: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: envelope(frame, dur) }}>
      <div style={{ position: "absolute", top: 60 }}>
        <SceneTitle frame={frame} sub="Münzen, Schmuck, Uhren, Briefmarken, Antiquitäten und Anlagegold.">Viele Welten, ein Haus.</SceneTitle>
      </div>
      <div style={{ display: "flex", gap: 22, marginTop: 44 }}>
        {PIECES.map((key, i) => {
          const s = spring({ frame: frame - 24 - i * 7, fps, config: { damping: 14, mass: 0.7 }, durationInFrames: 30 });
          const tint = SYMBOL_TINTS[key].hero;
          return (
            <div key={key} style={{ transform: `translateY(${(1 - s) * 28}px) scale(${0.72 + s * 0.28})`, opacity: s }}>
              <div style={{ position: "relative", overflow: "hidden", width: 112, height: 112, borderRadius: 22, display: "grid", placeItems: "center", background: "rgba(253,250,243,0.05)", border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 18px 44px -22px rgba(0,0,0,0.7)" }}>
                <div style={{ position: "absolute", inset: 0, background: `radial-gradient(circle at 50% 42%, ${tint}26, transparent 70%)` }} />
                <svg viewBox="0 0 48 48" width="74" height="74" fill="none" stroke={tint} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">{SYMBOL_PATHS[key]}</svg>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontFamily: SANS, fontSize: 18, color: GOLD_SOFT, marginTop: 34, opacity: interpolate(frame, [82, 102], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
        Jedes Stück ein Unikat, jedes mit Geschichte.
      </div>
    </AbsoluteFill>
  );
};

const qbez = (t: number, p0: number, p1: number, p2: number) => {
  const u = 1 - t;
  return u * u * p0 + 2 * u * t * p1 + t * t * p2;
};

const Versand: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = interpolate(frame, [22, 80], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.ease) });
  const p0 = { x: 250, y: 210 }, p1 = { x: 500, y: 60 }, p2 = { x: 760, y: 200 };
  const px = qbez(t, p0.x, p1.x, p2.x), py = qbez(t, p0.y, p1.y, p2.y);
  const arc = interpolate(t, [0, 1], [1, 0]);
  const seal = spring({ frame: frame - 76, fps, config: { damping: 9, mass: 0.6 }, durationInFrames: 24 });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: envelope(frame, dur) }}>
      <div style={{ position: "absolute", top: 64 }}>
        <SceneTitle frame={frame} sub="Diskret, versichert, mit Zertifikat und Echtheitsgarantie.">Versichert verpackt. Sicher bei Ihnen.</SceneTitle>
      </div>
      <svg width="1000" height="320" viewBox="0 0 1000 320" style={{ marginTop: 60 }}>
        <path d={`M ${p0.x} ${p0.y} Q ${p1.x} ${p1.y} ${p2.x} ${p2.y}`} fill="none" stroke={GOLD} strokeWidth="2.5" strokeDasharray="3 9" opacity="0.6" pathLength={1} strokeDashoffset={arc} />
        {/* vault / origin */}
        <g opacity="0.9">
          <rect x={p0.x - 46} y={p0.y - 6} width="64" height="56" rx="6" fill="rgba(253,250,243,0.06)" stroke={GOLD} strokeWidth="1.5" />
          <circle cx={p0.x - 14} cy={p0.y + 22} r="11" fill="none" stroke={GOLD} strokeWidth="1.5" />
        </g>
        {/* home / destination */}
        <g opacity={0.5 + seal * 0.5}>
          <path d={`M ${p2.x - 6} ${p2.y + 8} l 34 -26 l 34 26`} fill="none" stroke={GOLD} strokeWidth="1.6" />
          <rect x={p2.x + 2} y={p2.y + 8} width="52" height="44" rx="3" fill="rgba(253,250,243,0.06)" stroke={GOLD} strokeWidth="1.5" />
          <rect x={p2.x + 22} y={p2.y + 28} width="14" height="24" fill="none" stroke={GOLD} strokeWidth="1.4" />
        </g>
        {/* travelling parcel */}
        <g transform={`translate(${px} ${py}) rotate(${Math.sin(frame / 6) * 4})`} opacity={t < 0.99 ? 1 : 1 - seal}>
          <rect x="-26" y="-22" width="52" height="44" rx="5" fill="#caa86a" stroke={GOLD_DEEP} strokeWidth="2" />
          <path d="M -26 -4 H 26 M 0 -22 V 22" stroke={GOLD_DEEP} strokeWidth="2" opacity="0.7" />
          <circle cx="0" cy="0" r="8" fill={WAX} opacity="0.95" />
        </g>
        {/* wax seal stamping at destination */}
        <g transform={`translate(${p2.x + 28} ${p2.y + 2}) scale(${seal})`} opacity={seal}>
          <circle r="18" fill={WAX} />
          <text x="0" y="1" textAnchor="middle" dominantBaseline="central" fontFamily={SERIF} fontWeight={700} fontSize="16" fill="#fbe9d0">14</text>
        </g>
      </svg>
    </AbsoluteFill>
  );
};

const Outro: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const grow = spring({ frame, fps, config: { damping: 18 }, durationInFrames: 36 });
  const sweep = interpolate(frame, [30, 70], [-40, 140], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: envelope(frame, dur, 14, 18) }}>
      <div style={{ transform: `scale(${0.8 + grow * 0.2})` }}>
        <Emblem size={140} progress={1} />
      </div>
      <div style={{ position: "relative", marginTop: 18, overflow: "hidden" }}>
        <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 52, color: PAPER, letterSpacing: "0.02em" }}>
          warehouse<span style={{ color: GOLD }}>14</span>.de
        </div>
        <div style={{ position: "absolute", top: 0, left: `${sweep}%`, width: "26%", height: "100%", background: "linear-gradient(100deg, transparent, rgba(255,255,255,0.45), transparent)" }} />
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 18, opacity: interpolate(frame, [24, 44], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
        {["GoBD konform", "GwG konform", "Echtheitsgarantie"].map((b) => (
          <span key={b} style={{ fontFamily: SANS, fontSize: 14, color: GOLD_SOFT, border: "1px solid rgba(191,148,48,0.4)", borderRadius: 999, padding: "6px 14px" }}>{b}</span>
        ))}
      </div>
      <div style={{ fontFamily: SANS, fontSize: 15, color: "rgba(231,212,155,0.7)", letterSpacing: "0.28em", marginTop: 18 }}>
        GOLD · MÜNZEN · ANTIQUITÄTEN · SCHORNDORF
      </div>
    </AbsoluteFill>
  );
};

// ── root composition ─────────────────────────────────────────────────────────

export const ExplainerVideo: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: `radial-gradient(1100px 560px at 72% -8%, ${GOLD}22, transparent 60%), radial-gradient(820px 460px at 8% 108%, ${VERDIGRIS}1f, transparent 58%), linear-gradient(180deg, ${INK} 0%, #1e1810 55%, #14110b 100%)` }}>
      <AbsoluteFill style={{ boxShadow: "inset 0 0 220px rgba(0,0,0,0.6)" }} />
      <GoldDust />
      <Sequence from={0} durationInFrames={96}><Intro dur={96} /></Sequence>
      <Sequence from={88} durationInFrames={108}><LivePrices dur={108} /></Sequence>
      <Sequence from={188} durationInFrames={130}><Pruefung dur={130} /></Sequence>
      <Sequence from={310} durationInFrames={126}><Vielfalt dur={126} /></Sequence>
      <Sequence from={428} durationInFrames={106}><Versand dur={106} /></Sequence>
      <Sequence from={526} durationInFrames={94}><Outro dur={94} /></Sequence>
    </AbsoluteFill>
  );
};

// ── Remotion root + licence acknowledgement ──────────────────────────────────
// Remotion v4 prints a one-time licence banner unless the embedder acknowledges
// it. The on-page film no longer uses <Player>, but any future <Player> embed or
// `npx remotion render` should register through THIS root so the banner stays
// silent. On <Player>, pass the matching prop:  acknowledgeRemotionLicense .
export const ACKNOWLEDGE_REMOTION_LICENSE = true;

export const RemotionRoot: React.FC = () => (
  <Composition
    id="ExplainerVideo"
    component={ExplainerVideo}
    durationInFrames={EXPLAINER.durationInFrames}
    fps={EXPLAINER.fps}
    width={EXPLAINER.width}
    height={EXPLAINER.height}
  />
);
