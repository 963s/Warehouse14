"use client";

/* warehouse14 — der Markenfilm.
 *
 * A self-contained, buttery looping "brand film" built from framer-motion +
 * SVG, NOT the Remotion <Player> (which renders no <video> and warns about its
 * licence in the standalone production build). This piece is guaranteed to show
 * living motion in any build: one rAF timeline drives every scene, inview-gated
 * so the loop only spins while on screen, with a graceful prefers-reduced-motion
 * still frame. Same antique-gold scene DNA as src/remotion/explainer.tsx, made
 * native to the page so it always plays. German copy only.
 */
import { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";

// ── palette (mirrors the storefront tokens) ──────────────────────────────────
const GOLD = "#bf9430";
const GOLD_SOFT = "#e7d49b";
const GOLD_DEEP = "#8a6a1f";
const PAPER = "#f3ecdd";
const VERDIGRIS = "#6fae86";
const EASE = [0.16, 1, 0.3, 1] as const;

// ── timeline ──────────────────────────────────────────────────────────────────
// One looping clock in SECONDS. Each scene owns a window [start,end). The active
// scene gets a 0..1 local progress; we cross-fade between them. Total ≈ 19.5 s,
// echoing the "in zwanzig Sekunden" promise in the copy.
const SCENES = [
  { id: "intro", at: 0.0, len: 3.4 },
  { id: "prices", at: 3.4, len: 3.6 },
  { id: "pruefung", at: 7.0, len: 4.2 },
  { id: "vielfalt", at: 11.2, len: 3.6 },
  { id: "versand", at: 14.8, len: 3.6 },
  { id: "outro", at: 18.4, len: 1.6 },
] as const;
const LOOP = SCENES.reduce((m, s) => Math.max(m, s.at + s.len), 0);

type SceneId = (typeof SCENES)[number]["id"];

// smootherstep — soft in/out without a library
const ss = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// deterministic pseudo-random for the dust field
const rnd = (i: number, s: number) => {
  const x = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

// ── drifting gold dust (CSS-driven, infinite, GPU-only) ──────────────────────
function GoldDust({ active }: { active: boolean }) {
  const motes = Array.from({ length: 22 });
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {motes.map((_, i) => {
        const left = rnd(i, 1) * 100;
        const size = 1.5 + rnd(i, 5) * 4;
        const dur = 9 + rnd(i, 3) * 9;
        const delay = -rnd(i, 4) * dur;
        const drift = (rnd(i, 2) - 0.5) * 60;
        return (
          <span
            key={i}
            style={{
              position: "absolute",
              left: `${left}%`,
              bottom: "-6%",
              width: size,
              height: size,
              borderRadius: "50%",
              background: GOLD_SOFT,
              opacity: 0,
              boxShadow: `0 0 ${size * 3}px ${GOLD}`,
              // animation paused when off-screen so the loop costs nothing idle
              animation: active ? `w14mote ${dur}s linear ${delay}s infinite` : "none",
              ["--w14-drift" as string]: `${drift}px`,
            }}
          />
        );
      })}
      <style>{`
        @keyframes w14mote {
          0%   { opacity: 0; transform: translate(0, 0) scale(0.7); }
          12%  { opacity: 0.55; }
          88%  { opacity: 0.45; }
          100% { opacity: 0; transform: translate(var(--w14-drift), -560px) scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes w14mote { 0%,100% { opacity: 0.3; transform: none; } }
        }
      `}</style>
    </div>
  );
}

// ── reusable atoms ────────────────────────────────────────────────────────────

// The maison emblem: two rings draw in, ticks fade up, "14" settles.
function Emblem({ size, p }: { size: number; p: number }) {
  const ring = 1 - ss(Math.min(1, p / 0.7));
  const num = ss(Math.min(1, Math.max(0, (p - 0.45) / 0.55)));
  const ticks = Array.from({ length: 48 });
  return (
    <svg width={size} height={size} viewBox="0 0 200 200">
      <defs>
        <linearGradient id="filmEmblem" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={GOLD_SOFT} />
          <stop offset="0.5" stopColor={GOLD} />
          <stop offset="1" stopColor={GOLD_DEEP} />
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="92" fill="none" stroke="url(#filmEmblem)" strokeWidth="2.5" pathLength={1} strokeDasharray={1} strokeDashoffset={ring} />
      <circle cx="100" cy="100" r="78" fill="none" stroke="url(#filmEmblem)" strokeWidth="1" opacity={0.55} pathLength={1} strokeDasharray={1} strokeDashoffset={ring} />
      <g opacity={ss(Math.min(1, p / 0.6)) * 0.9}>
        {ticks.map((_, i) => {
          const a = (i / ticks.length) * Math.PI * 2;
          const big = i % 4 === 0;
          const r1 = big ? 70 : 73;
          return (
            <line key={i} x1={100 + Math.cos(a) * r1} y1={100 + Math.sin(a) * r1} x2={100 + Math.cos(a) * 76} y2={100 + Math.sin(a) * 76} stroke={GOLD} strokeWidth={big ? 1.6 : 0.8} opacity={big ? 0.9 : 0.5} />
          );
        })}
      </g>
      <g transform={`translate(100 100) scale(${lerp(0.7, 1, num)})`} opacity={num}>
        <text x="0" y="0" textAnchor="middle" dominantBaseline="central" fontFamily="var(--font-cormorant), Georgia, serif" fontWeight={600} fontSize="74" fill="url(#filmEmblem)" letterSpacing="-3">14</text>
      </g>
    </svg>
  );
}

// A struck gold coin with a travelling specular glint.
function Coin({ size, shimmer = 0 }: { size: number; shimmer?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200">
      <defs>
        <radialGradient id="filmCoin" cx="0.38" cy="0.34" r="0.9">
          <stop offset="0" stopColor="#fbeec2" />
          <stop offset="0.4" stopColor={GOLD_SOFT} />
          <stop offset="0.75" stopColor={GOLD} />
          <stop offset="1" stopColor={GOLD_DEEP} />
        </radialGradient>
      </defs>
      <circle cx="100" cy="100" r="94" fill="url(#filmCoin)" stroke={GOLD_DEEP} strokeWidth="3" />
      <circle cx="100" cy="100" r="80" fill="none" stroke={GOLD_DEEP} strokeWidth="1.5" opacity="0.5" />
      {Array.from({ length: 60 }).map((_, i) => {
        const a = (i / 60) * Math.PI * 2;
        return <line key={i} x1={100 + Math.cos(a) * 84} y1={100 + Math.sin(a) * 84} x2={100 + Math.cos(a) * 92} y2={100 + Math.sin(a) * 92} stroke={GOLD_DEEP} strokeWidth="1" opacity="0.4" />;
      })}
      <text x="100" y="104" textAnchor="middle" dominantBaseline="central" fontFamily="var(--font-cormorant), Georgia, serif" fontWeight={600} fontSize="86" fill={GOLD_DEEP} letterSpacing="-4">14</text>
      <ellipse cx={40 + shimmer * 120} cy={62} rx="26" ry="54" fill="#fff" opacity={0.2} transform={`rotate(20 ${40 + shimmer * 120} 62)`} />
    </svg>
  );
}

function Loupe({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120">
      <defs>
        <radialGradient id="filmLens" cx="0.4" cy="0.35" r="0.8">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="0.6" stopColor="#ffffff" stopOpacity="0.08" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <line x1="78" y1="78" x2="112" y2="112" stroke={GOLD_DEEP} strokeWidth="11" strokeLinecap="round" />
      <line x1="78" y1="78" x2="112" y2="112" stroke={GOLD} strokeWidth="6" strokeLinecap="round" />
      <circle cx="50" cy="50" r="46" fill="url(#filmLens)" stroke={GOLD} strokeWidth="6" />
      <circle cx="50" cy="50" r="46" fill="none" stroke={GOLD_SOFT} strokeWidth="1.5" opacity="0.8" />
    </svg>
  );
}

function Check({ p }: { p: number }) {
  const ring = 1 - ss(p);
  const tick = 1 - ss(Math.max(0, (p - 0.4) / 0.6));
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="11" fill="none" stroke={VERDIGRIS} strokeWidth="2" pathLength={1} strokeDasharray={1} strokeDashoffset={ring} />
      <path d="M7 12.5 L10.5 16 L17 8.5" fill="none" stroke={VERDIGRIS} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={tick} />
    </svg>
  );
}

const SERIF = { fontFamily: "var(--font-cormorant), Georgia, serif" } as const;
const SANS = { fontFamily: "var(--font-inter), system-ui, sans-serif" } as const;

function Title({ children, sub, p }: { children: React.ReactNode; sub?: string; p: number }) {
  const o = ss(Math.min(1, p / 0.25));
  const y = lerp(20, 0, o);
  return (
    <div style={{ textAlign: "center", transform: `translateY(${y}px)`, opacity: o }}>
      <div style={{ ...SERIF, fontWeight: 600, fontSize: "clamp(26px, 4.4vw, 46px)", color: PAPER, letterSpacing: "-0.01em", lineHeight: 1.05 }}>{children}</div>
      {sub ? <div style={{ ...SANS, fontSize: "clamp(13px, 1.5vw, 18px)", color: GOLD_SOFT, marginTop: 12, letterSpacing: "0.02em", maxWidth: 560, marginInline: "auto" }}>{sub}</div> : null}
    </div>
  );
}

// ── scenes ───────────────────────────────────────────────────────────────────
// Each receives local progress p∈[0,1]. They are absolutely positioned and
// cross-faded by the stage; inside, every transform is driven by p.

function SceneIntro({ p }: { p: number }) {
  const grow = ss(Math.min(1, p / 0.55));
  const word = ss(Math.max(0, (p - 0.4) / 0.5));
  return (
    <div className="grid h-full w-full place-items-center">
      <div className="flex flex-col items-center">
        <div style={{ transform: `scale(${lerp(0.6, 1, grow)})` }}>
          <Emblem size={184} p={Math.min(1, p / 0.55)} />
        </div>
        <div style={{ opacity: word, transform: `translateY(${lerp(18, 0, word)}px)`, textAlign: "center", marginTop: 14 }}>
          <div style={{ ...SERIF, fontWeight: 600, fontSize: "clamp(34px, 6vw, 56px)", color: PAPER, letterSpacing: "0.04em" }}>
            WAREHOUSE<span style={{ color: GOLD }}>14</span>
          </div>
          <div style={{ ...SANS, fontSize: "clamp(10px, 1.4vw, 16px)", color: GOLD_SOFT, letterSpacing: "0.3em", marginTop: 10 }}>
            GOLD · MÜNZEN · ANTIQUITÄTEN · SCHORNDORF
          </div>
        </div>
      </div>
    </div>
  );
}

const PRICES = [
  { m: "Gold", v: "76,42", c: "+0,84", up: true },
  { m: "Silber", v: "0,92", c: "+1,21", up: true },
  { m: "Platin", v: "31,78", c: "−0,36", up: false },
  { m: "Palladium", v: "28,14", c: "+0,42", up: true },
];

function ScenePrices({ p }: { p: number }) {
  const pts = [38, 34, 40, 30, 33, 26, 24, 18, 22, 14, 12, 8];
  const dPath = pts.map((y, i) => `${i === 0 ? "M" : "L"} ${i * (520 / (pts.length - 1))} ${y}`).join(" ");
  const draw = 1 - ss(Math.max(0, (p - 0.12) / 0.5));
  const fill = ss(Math.max(0, (p - 0.4) / 0.3));
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-5 px-6">
      <Title p={p} sub="Tagespreise direkt aus dem Markt — automatisch im Laden und online.">
        Preise. Live. Jeden Tag.
      </Title>
      <div className="flex flex-wrap items-stretch justify-center gap-3">
        {PRICES.map((pr, i) => {
          const s = ss(Math.max(0, (p - 0.18 - i * 0.06) / 0.3));
          return (
            <div
              key={pr.m}
              style={{
                transform: `translateY(${lerp(26, 0, s)}px)`,
                opacity: s,
                background: "rgba(243,236,221,0.05)",
                border: "1px solid rgba(191,148,48,0.35)",
                borderRadius: 14,
                padding: "12px 18px",
                minWidth: 124,
                backdropFilter: "blur(4px)",
              }}
            >
              <div style={{ ...SANS, fontSize: 12, color: GOLD_SOFT, letterSpacing: "0.12em", textTransform: "uppercase" }}>{pr.m}</div>
              <div style={{ ...SERIF, fontWeight: 600, fontSize: 26, color: PAPER, fontVariantNumeric: "tabular-nums" }}>
                {pr.v}<span style={{ fontSize: 13, color: GOLD_SOFT }}> €/g</span>
              </div>
              <div style={{ ...SANS, fontSize: 13, color: pr.up ? VERDIGRIS : "#c0492f", fontVariantNumeric: "tabular-nums" }}>{pr.up ? "▲" : "▼"} {pr.c}%</div>
            </div>
          );
        })}
      </div>
      <svg width="520" height="52" viewBox="0 -4 520 50" style={{ maxWidth: "90%", overflow: "visible" }}>
        <defs>
          <linearGradient id="filmSpark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={GOLD} stopOpacity="0.4" />
            <stop offset="1" stopColor={GOLD} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${dPath} L 520 44 L 0 44 Z`} fill="url(#filmSpark)" opacity={fill} />
        <path d={dPath} fill="none" stroke={GOLD} strokeWidth="2.5" strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={draw} />
      </svg>
    </div>
  );
}

const FACTS = ["Material spektral geprüft", "Gewicht bestätigt · 31,1035 g", "Feingehalt 999,9", "Echtheit zertifiziert"];

function ScenePruefung({ p }: { p: number }) {
  // loupe sweeps across the coin once, then the facts tick in
  const sweep = lerp(-130, 130, ss(Math.min(1, p / 0.7)));
  const shimmer = ss(Math.min(1, p / 0.7));
  const breathe = 1 + Math.sin(p * Math.PI * 4) * 0.012;
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 px-6">
      <Title p={p}>Jedes Stück wird geprüft.</Title>
      <div className="flex flex-col items-center gap-8 md:flex-row md:gap-14">
        <div style={{ position: "relative", transform: `scale(${breathe})` }}>
          <div style={{ position: "absolute", inset: -30, borderRadius: "50%", background: `radial-gradient(circle, ${GOLD}33, transparent 70%)` }} />
          <Coin size={196} shimmer={shimmer} />
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: `translate(calc(-50% + ${sweep}px), -58%)` }}>
            <Loupe size={108} />
          </div>
        </div>
        <div className="flex flex-col gap-3">
          {FACTS.map((f, i) => {
            const fp = ss(Math.max(0, (p - 0.32 - i * 0.13) / 0.2));
            return (
              <div key={f} style={{ display: "flex", alignItems: "center", gap: 12, opacity: fp, transform: `translateX(${lerp(16, 0, fp)}px)` }}>
                <Check p={fp} />
                <span style={{ ...SANS, fontSize: "clamp(15px, 1.9vw, 20px)", color: PAPER }}>{f}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const WORLDS: { label: string; tint: string; path: React.ReactNode }[] = [
  { label: "Münzen", tint: GOLD, path: <><circle cx="24" cy="24" r="15" /><circle cx="24" cy="24" r="9" /></> },
  { label: "Edelmetalle", tint: GOLD_SOFT, path: <><path d="M12 30 L24 12 L36 30 Z" /><path d="M16 30 H32" /></> },
  { label: "Schmuck", tint: "#c98fb0", path: <><circle cx="24" cy="27" r="9" /><path d="M18 19 L24 11 L30 19 Z" /></> },
  { label: "Uhren", tint: VERDIGRIS, path: <><circle cx="24" cy="25" r="13" /><path d="M24 25 V18 M24 25 L30 28 M24 8 V12 M24 38 V42" /></> },
  { label: "Briefmarken", tint: "#a4633c", path: <><rect x="11" y="13" width="26" height="22" rx="2" /><circle cx="24" cy="24" r="6" /></> },
  { label: "Antiquitäten", tint: "#9b8cc4", path: <><path d="M16 36 V20 Q24 12 32 20 V36" /><path d="M13 36 H35 M18 20 H30" /></> },
];

function SceneVielfalt({ p }: { p: number }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-7 px-6">
      <Title p={p} sub="Münzen, Schmuck, Uhren, Briefmarken, Antiquitäten und Anlagegold.">Viele Welten, ein Haus.</Title>
      <div className="flex flex-wrap items-center justify-center gap-3 md:gap-4">
        {WORLDS.map((w, i) => {
          const s = ss(Math.max(0, (p - 0.2 - i * 0.07) / 0.3));
          return (
            <div key={w.label} style={{ transform: `translateY(${lerp(28, 0, s)}px) scale(${lerp(0.72, 1, s)})`, opacity: s }}>
              <div
                className="relative grid place-items-center overflow-hidden"
                style={{
                  width: 88,
                  height: 88,
                  borderRadius: 18,
                  background: "rgba(243,236,221,0.05)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  boxShadow: "0 18px 44px -22px rgba(0,0,0,0.7)",
                }}
              >
                <div style={{ position: "absolute", inset: 0, background: `radial-gradient(circle at 50% 42%, ${w.tint}26, transparent 70%)` }} />
                <svg viewBox="0 0 48 48" width="56" height="56" fill="none" stroke={w.tint} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">{w.path}</svg>
              </div>
              <div style={{ ...SANS, fontSize: 11, color: GOLD_SOFT, textAlign: "center", marginTop: 8, letterSpacing: "0.04em", opacity: s }}>{w.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const qbez = (t: number, a: number, b: number, c: number) => {
  const u = 1 - t;
  return u * u * a + 2 * u * t * b + t * t * c;
};

function SceneVersand({ p }: { p: number }) {
  const t = ss(Math.min(1, Math.max(0, (p - 0.1) / 0.7)));
  const a = { x: 250, y: 200 }, b = { x: 500, y: 64 }, c = { x: 760, y: 200 };
  const px = qbez(t, a.x, b.x, c.x), py = qbez(t, a.y, b.y, c.y);
  const arc = 1 - t;
  const seal = ss(Math.max(0, (p - 0.78) / 0.22));
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-6">
      <Title p={p} sub="Diskret, versichert, mit Zertifikat und Echtheitsgarantie.">Versichert verpackt. Sicher bei Ihnen.</Title>
      <svg width="1000" height="300" viewBox="0 0 1000 300" style={{ maxWidth: "100%", marginTop: 8 }}>
        <path d={`M ${a.x} ${a.y} Q ${b.x} ${b.y} ${c.x} ${c.y}`} fill="none" stroke={GOLD} strokeWidth="2.5" strokeDasharray="3 9" opacity="0.6" pathLength={1} strokeDashoffset={arc} />
        <g opacity="0.9">
          <rect x={a.x - 46} y={a.y - 6} width="64" height="56" rx="6" fill="rgba(243,236,221,0.06)" stroke={GOLD} strokeWidth="1.5" />
          <circle cx={a.x - 14} cy={a.y + 22} r="11" fill="none" stroke={GOLD} strokeWidth="1.5" />
        </g>
        <g opacity={0.5 + seal * 0.5}>
          <path d={`M ${c.x - 6} ${c.y + 8} l 34 -26 l 34 26`} fill="none" stroke={GOLD} strokeWidth="1.6" />
          <rect x={c.x + 2} y={c.y + 8} width="52" height="44" rx="3" fill="rgba(243,236,221,0.06)" stroke={GOLD} strokeWidth="1.5" />
          <rect x={c.x + 22} y={c.y + 28} width="14" height="24" fill="none" stroke={GOLD} strokeWidth="1.4" />
        </g>
        <g transform={`translate(${px} ${py}) rotate(${Math.sin(p * Math.PI * 8) * 4})`} opacity={t < 0.99 ? 1 : 1 - seal}>
          <rect x="-26" y="-22" width="52" height="44" rx="5" fill="#caa86a" stroke={GOLD_DEEP} strokeWidth="2" />
          <path d="M -26 -4 H 26 M 0 -22 V 22" stroke={GOLD_DEEP} strokeWidth="2" opacity="0.7" />
          <circle cx="0" cy="0" r="8" fill="#c0492f" opacity="0.95" />
        </g>
        <g transform={`translate(${c.x + 28} ${c.y + 2}) scale(${seal})`} opacity={seal}>
          <circle r="18" fill="#c0492f" />
          <text x="0" y="1" textAnchor="middle" dominantBaseline="central" style={SERIF} fontWeight={700} fontSize="16" fill="#fbe9d0">14</text>
        </g>
      </svg>
    </div>
  );
}

const BADGES = ["GoBD konform", "GwG konform", "Echtheitsgarantie"];

function SceneOutro({ p }: { p: number }) {
  const grow = ss(Math.min(1, p / 0.5));
  const sweep = lerp(-40, 150, ss(Math.min(1, p / 0.9)));
  const badges = ss(Math.max(0, (p - 0.3) / 0.4));
  return (
    <div className="grid h-full w-full place-items-center">
      <div className="flex flex-col items-center">
        <div style={{ transform: `scale(${lerp(0.8, 1, grow)})` }}>
          <Emblem size={120} p={1} />
        </div>
        <div style={{ position: "relative", marginTop: 16, overflow: "hidden" }}>
          <div style={{ ...SERIF, fontWeight: 600, fontSize: "clamp(30px, 5vw, 50px)", color: PAPER, letterSpacing: "0.02em" }}>
            warehouse<span style={{ color: GOLD }}>14</span>.de
          </div>
          <div style={{ position: "absolute", top: 0, left: `${sweep}%`, width: "26%", height: "100%", background: "linear-gradient(100deg, transparent, rgba(255,255,255,0.45), transparent)" }} />
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 16, opacity: badges, flexWrap: "wrap", justifyContent: "center" }}>
          {BADGES.map((b) => (
            <span key={b} style={{ ...SANS, fontSize: 13, color: GOLD_SOFT, border: "1px solid rgba(191,148,48,0.4)", borderRadius: 999, padding: "5px 13px" }}>{b}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

const SCENE_CMP: Record<SceneId, (props: { p: number }) => React.JSX.Element> = {
  intro: SceneIntro,
  prices: ScenePrices,
  pruefung: ScenePruefung,
  vielfalt: SceneVielfalt,
  versand: SceneVersand,
  outro: SceneOutro,
};

// A short German caption per scene, shown bottom-left like a film lower-third.
const CAPTIONS: Record<SceneId, string> = {
  intro: "Ihr Haus für Gold & Raritäten",
  prices: "Schritt 1 — Tagesnotierung",
  pruefung: "Schritt 2 — Prüfung & Echtheit",
  vielfalt: "Schritt 3 — die ganze Sammlung",
  versand: "Schritt 4 — versicherte Lieferung",
  outro: "warehouse14 — vom Kontor zu Ihnen",
};

// ── the looping stage ─────────────────────────────────────────────────────────

export function ExplainerPlayer() {
  const wrap = useRef<HTMLElement>(null);
  const inView = useInView(wrap, { amount: 0.4 });
  const reduce = useReducedMotion();
  const [clock, setClock] = useState(0); // seconds within LOOP

  // One rAF clock. Pauses entirely when off-screen or under reduced motion, so
  // the loop is free when idle and never fights the user's preference.
  useEffect(() => {
    if (reduce) {
      // park on the "pruefung" beat — the most legible, brand-rich still frame
      setClock(SCENES[2].at + SCENES[2].len * 0.55);
      return;
    }
    if (!inView) return;
    let raf = 0;
    let start = 0;
    const tick = (ts: number) => {
      if (!start) start = ts;
      setClock(((ts - start) / 1000) % LOOP);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, reduce]);

  // resolve which scene(s) are visible + their local progress
  const active = SCENES.find((s) => clock >= s.at && clock < s.at + s.len) ?? SCENES[0];
  const local = Math.min(1, Math.max(0, (clock - active.at) / active.len));
  // cross-fade: fade the previous out in the first 0.5 s of each scene
  const fadeIn = ss(Math.min(1, local / 0.12));
  const fadeOut = ss(Math.min(1, (1 - local) / 0.1));
  const sceneOpacity = reduce ? 1 : Math.min(fadeIn, fadeOut);

  // progress dots across the bottom — the film's "chapters"
  const overallProgress = clock / LOOP;

  // gentle parallax on the whole stage as it rides into view (transform-only)
  const enterY = useMotionValue(28);
  const enterYSpring = useSpring(enterY, { stiffness: 90, damping: 22 });
  useEffect(() => {
    enterY.set(inView ? 0 : 28);
  }, [inView, enterY]);
  const enterOpacity = useTransform(enterYSpring, [28, 0], [0, 1]);

  const ActiveScene = SCENE_CMP[active.id];

  return (
    <motion.figure
      ref={wrap}
      aria-label="Markenfilm: die Geschichte hinter jedem Stück — Tagespreis, Prüfung, Sammlung und versicherte Lieferung."
      className="group relative m-0"
      style={reduce ? undefined : { y: enterYSpring, opacity: enterOpacity }}
    >
      {/* Elegant frame: gilt hairline, deep ink mount, soft lift shadow. */}
      <div
        className="relative aspect-video w-full overflow-hidden rounded-[18px]"
        style={{
          background:
            "radial-gradient(1100px 560px at 72% -8%, rgba(191,148,48,0.20), transparent 60%), radial-gradient(820px 460px at 8% 108%, rgba(70,88,63,0.18), transparent 58%), linear-gradient(180deg, #17130c 0%, #1e1810 55%, #14110b 100%)",
          boxShadow: "0 40px 90px -40px rgba(0,0,0,0.75), inset 0 0 0 1px rgba(191,148,48,0.28), inset 0 0 160px rgba(0,0,0,0.55)",
        }}
      >
        {/* dust ambience (paused when off-screen) */}
        <GoldDust active={!!inView && !reduce} />

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

        {/* vignette + faint film grain */}
        <div className="grain pointer-events-none absolute inset-0 opacity-[0.10]" aria-hidden="true" />
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden="true"
          style={{ boxShadow: "inset 0 0 180px rgba(0,0,0,0.55)", borderRadius: 18 }}
        />

        {/* lower-third caption */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-4 md:p-5">
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
                color: GOLD_SOFT,
                letterSpacing: "0.04em",
                background: "rgba(23,19,12,0.45)",
                border: "1px solid rgba(191,148,48,0.3)",
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
                    background: on ? GOLD : "rgba(231,212,155,0.35)",
                    transition: "width 0.4s cubic-bezier(0.16,1,0.3,1), background 0.4s",
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* top progress hairline — the film's timeline */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px]" aria-hidden="true">
          <div
            className="bg-gold-gradient h-full origin-left"
            style={{ transform: `scaleX(${reduce ? 1 : overallProgress})` }}
          />
        </div>
      </div>
    </motion.figure>
  );
}
