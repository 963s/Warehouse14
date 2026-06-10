"use client";

import { useRef } from "react";
import {
  motion,
  useScroll,
  useTransform,
  useReducedMotion,
  useInView,
  type MotionValue,
} from "framer-motion";
import { ScanLine, CheckCircle2, Scale, Gem, Award } from "lucide-react";

const FACTS = [
  {
    icon: ScanLine,
    label: "Material spektral geprüft",
    sub: "Röntgenfluoreszenzanalyse nach ISO 11427",
  },
  {
    icon: Scale,
    label: "Gewicht bestätigt, 31,1035 g",
    sub: "Feinunze, kalibriert auf 0,001 mg Genauigkeit",
  },
  {
    icon: Gem,
    label: "Feingehalt 999,9",
    sub: "Vier Neunen, höchste Reinheitsklasse",
  },
  {
    icon: Award,
    label: "Echtheit garantiert, mit Zertifikat",
    sub: "Zertifikat nach DIN 8238, seriennummeriert",
  },
];

function FactRow({
  icon: Icon,
  label,
  sub,
  opacity,
  x,
  glow,
}: {
  icon: typeof ScanLine;
  label: string;
  sub: string;
  opacity: MotionValue<number>;
  x: MotionValue<number>;
  glow: MotionValue<number>;
}) {
  // Derived motion for the "commit" of each row — declared at the top of the
  // component (never inside JSX/loops) to respect the Rules of Hooks.
  const ruleOpacity = useTransform(glow, [0, 1], [0, 0.6]);
  const corona = useTransform(
    glow,
    [0, 1],
    ["0 0 0 0 rgba(191,148,48,0)", "0 0 16px 1px rgba(191,148,48,0.55)"],
  );
  const checkScale = useTransform(glow, [0, 1], [0.6, 1]);

  return (
    <motion.div
      style={{ opacity, x }}
      className="group relative flex items-start gap-w14-2 border-b border-rule py-w14-1 last:border-0"
    >
      {/* A gold rule that wipes in beneath each fact as it locks — the
          "stamp" feeling of a line on a certificate being filled. */}
      <motion.span
        aria-hidden="true"
        className="bg-gold-gradient absolute bottom-0 left-0 h-px w-full origin-left"
        style={{ scaleX: glow, opacity: ruleOpacity }}
      />
      <motion.span
        className="bg-gold-gradient mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full"
        style={{ boxShadow: corona }}
      >
        <Icon size={14} className="text-black" strokeWidth={2.5} aria-hidden="true" />
      </motion.span>
      <div>
        <p className="font-display text-fluid-body smallcaps tracking-wide text-white">
          {label}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-white/75">{sub}</p>
      </div>
      <motion.span
        className="ml-auto mt-0.5 flex-shrink-0"
        style={{ opacity: glow, scale: useTransform(glow, [0, 1], [0.6, 1]) }}
      >
        <CheckCircle2 size={16} className="text-gold opacity-90" strokeWidth={1.5} aria-hidden="true" />
      </motion.span>
    </motion.div>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * GoldCoin — a living, minted disc.
 *   · slow continuous mint-turn (the disc breathes, never frozen)
 *   · a travelling specular band that rakes across the face (the "shine")
 *   · a spectral authentication scan-bar that sweeps top→bottom under a clip
 *   · rim ticks that catch the light in a rotating arc
 * All heavy work is transform/opacity + SMIL on inview-gated SVG, 60fps.
 * Reduced-motion: everything still renders, just held still.
 * ────────────────────────────────────────────────────────────────────────── */
function GoldCoin({ active, reduced }: { active: boolean; reduced: boolean | null }) {
  const ticks = Array.from({ length: 60 }, (_, i) => i);
  const r = 158;
  const animate = active && !reduced;

  return (
    <div className="relative select-none" aria-hidden="true">
      <svg
        width="360"
        height="360"
        viewBox="0 0 360 360"
        className="drop-shadow-[0_24px_48px_rgba(0,0,0,0.5)]"
      >
        <defs>
          <radialGradient id="coinFace" cx="42%" cy="38%" r="70%">
            <stop offset="0%" stopColor="#f0d060" />
            <stop offset="30%" stopColor="#c9960e" />
            <stop offset="65%" stopColor="#8a6a1f" />
            <stop offset="100%" stopColor="#3d2c00" />
          </radialGradient>
          <radialGradient id="coinEdge" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#f5d060" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#3d2c00" stopOpacity="0" />
          </radialGradient>
          <filter id="emboss">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.5" result="blur" />
            <feOffset dx="1" dy="2" in="blur" result="shadow" />
            <feComposite in="SourceGraphic" in2="shadow" operator="over" />
          </filter>
          <clipPath id="coinClip">
            <circle cx="180" cy="180" r="160" />
          </clipPath>
          <linearGradient id="sheen" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="white" stopOpacity="0.14" />
            <stop offset="50%" stopColor="white" stopOpacity="0.0" />
            <stop offset="100%" stopColor="white" stopOpacity="0.06" />
          </linearGradient>

          {/* A narrow, bright specular band that rakes across the coin. */}
          <linearGradient id="specBand" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#fff7df" stopOpacity="0" />
            <stop offset="44%" stopColor="#fff7df" stopOpacity="0" />
            <stop offset="50%" stopColor="#fffdf4" stopOpacity="0.85" />
            <stop offset="56%" stopColor="#fff7df" stopOpacity="0" />
            <stop offset="100%" stopColor="#fff7df" stopOpacity="0" />
          </linearGradient>

          {/* Spectral scan — a faint prismatic bar for the "authentication" read. */}
          <linearGradient id="spectral" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#5ad1ff" stopOpacity="0" />
            <stop offset="40%" stopColor="#7af0c8" stopOpacity="0.5" />
            <stop offset="50%" stopColor="#eafff4" stopOpacity="0.85" />
            <stop offset="60%" stopColor="#b88aff" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#b88aff" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Outer edge ring */}
        <circle cx="180" cy="180" r="176" fill="#2a1e00" stroke="#6b4f10" strokeWidth="1.5" />
        <circle cx="180" cy="180" r="170" fill="#1a1200" />

        {/* Rim ticks — held in a group we slowly counter-rotate for a milled glint. */}
        <g>
          {animate && (
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 180 180"
              to="360 180 180"
              dur="90s"
              repeatCount="indefinite"
            />
          )}
          {ticks.map((i) => {
            const angle = (i / 60) * 2 * Math.PI - Math.PI / 2;
            const isLong = i % 5 === 0;
            const inner = isLong ? r - 4 : r - 1.5;
            const outer = r + 6;
            const x1 = Math.round((180 + inner * Math.cos(angle)) * 1000) / 1000;
            const y1 = Math.round((180 + inner * Math.sin(angle)) * 1000) / 1000;
            const x2 = Math.round((180 + outer * Math.cos(angle)) * 1000) / 1000;
            const y2 = Math.round((180 + outer * Math.sin(angle)) * 1000) / 1000;
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={isLong ? "#c9960e" : "#6b4f10"}
                strokeWidth={isLong ? 1.8 : 0.9}
                opacity={isLong ? 0.9 : 0.5}
              />
            );
          })}
        </g>

        {/* Everything on the face is clipped to the disc. */}
        <g clipPath="url(#coinClip)">
          {/* Coin face */}
          <circle cx="180" cy="180" r={r} fill="url(#coinFace)" />
          <circle cx="180" cy="180" r={r} fill="url(#sheen)" />

          {/* A slowly drifting warm aura on the face — gives it depth/turn. */}
          <ellipse cx="150" cy="140" rx="150" ry="150" fill="url(#coinEdge)">
            {animate && (
              <animateTransform
                attributeName="transform"
                type="rotate"
                from="0 180 180"
                to="360 180 180"
                dur="22s"
                repeatCount="indefinite"
              />
            )}
          </ellipse>

          {/* Inner engraved ring */}
          <circle cx="180" cy="180" r="120" fill="none" stroke="#6b4f10" strokeWidth="1.2" opacity="0.7" />
          <circle cx="180" cy="180" r="122" fill="none" stroke="#f5d060" strokeWidth="0.4" opacity="0.4" />

          {/* "14" engraved numeral */}
          <text
            x="180"
            y="192"
            textAnchor="middle"
            fontFamily="Georgia, serif"
            fontSize="88"
            fontWeight="700"
            fill="none"
            stroke="#3d2c00"
            strokeWidth="3"
            opacity="0.6"
            filter="url(#emboss)"
          >
            14
          </text>
          <text
            x="180"
            y="192"
            textAnchor="middle"
            fontFamily="Georgia, serif"
            fontSize="88"
            fontWeight="700"
            fill="#f5d060"
            opacity="0.9"
          >
            14
          </text>

          {/* Arch text top — slowly counter-drifts so legend "turns" with the mint. */}
          <g>
            {animate && (
              <animateTransform
                attributeName="transform"
                type="rotate"
                from="0 180 180"
                to="2.2 180 180"
                dur="9s"
                values="-2.2 180 180; 2.2 180 180; -2.2 180 180"
                repeatCount="indefinite"
              />
            )}
            <path id="arcTop" d="M 60,180 A 120,120 0 0 1 300,180" fill="none" />
            <text fontSize="9.5" letterSpacing="3.5" fill="#c9960e" opacity="0.75">
              <textPath href="#arcTop" startOffset="50%" textAnchor="middle">
                WAREHOUSE XIV . GOLDHAUS . SCHORNDORF
              </textPath>
            </text>
            <path id="arcBottom" d="M 60,180 A 120,120 0 0 0 300,180" fill="none" />
            <text fontSize="9.5" letterSpacing="3.5" fill="#c9960e" opacity="0.75">
              <textPath href="#arcBottom" startOffset="50%" textAnchor="middle">
                FEINGOLD . 999,9 . FEINSILBER . 999,0
              </textPath>
            </text>
          </g>

          {/* ── The travelling specular band — the live "shine". ───────────── */}
          <rect x="-180" y="0" width="180" height="360" fill="url(#specBand)" opacity="0.9">
            {animate && (
              <animateTransform
                attributeName="transform"
                type="translate"
                from="-40 0"
                to="540 0"
                dur="4.6s"
                repeatCount="indefinite"
              />
            )}
          </rect>

          {/* ── Spectral authentication scan — sweeps top→bottom, fades, repeats ── */}
          <rect x="0" y="-90" width="360" height="90" fill="url(#spectral)" opacity="0.55">
            {animate && (
              <>
                <animateTransform
                  attributeName="transform"
                  type="translate"
                  from="0 -90"
                  to="0 360"
                  dur="3.4s"
                  begin="0s;scan.end+2.2s"
                  id="scan"
                />
                <animate
                  attributeName="opacity"
                  values="0; 0.55; 0.55; 0"
                  keyTimes="0; 0.1; 0.85; 1"
                  dur="3.4s"
                  begin="0s;scan.end+2.2s"
                />
              </>
            )}
          </rect>

          {/* The thin bright leading edge of the scan, for a crisper read. */}
          {animate && (
            <line x1="0" y1="0" x2="360" y2="0" stroke="#f4fffb" strokeWidth="1.2" opacity="0.9">
              <animateTransform
                attributeName="transform"
                type="translate"
                from="0 -6"
                to="0 360"
                dur="3.4s"
                begin="0s;scan.end+2.2s"
              />
              <animate
                attributeName="opacity"
                values="0; 0.9; 0.9; 0"
                keyTimes="0; 0.08; 0.85; 1"
                dur="3.4s"
                begin="0s;scan.end+2.2s"
              />
            </line>
          )}

          {/* Specular highlight (static base, the band rakes over it) */}
          <ellipse cx="148" cy="148" rx="48" ry="30" fill="white" opacity="0.06" transform="rotate(-25 148 148)" />
        </g>
      </svg>
    </div>
  );
}

export function Authentifizierung() {
  const ref = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  // inview-gate the expensive coin SMIL: only run it while the sticky stage
  // is actually on screen.
  const inView = useInView(stageRef, { margin: "-10% 0px -10% 0px" });

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });

  // The coin makes a slow, luxurious entrance as the section pins, then holds.
  const coinScale = useTransform(scrollYProgress, [0, 0.18], reduced ? [1, 1] : [0.82, 1]);
  const coinRotate = useTransform(scrollYProgress, [0, 0.18], reduced ? [0, 0] : [-14, 0]);
  const coinEnter = useTransform(scrollYProgress, [0, 0.12], [0, 1]);
  // A subtle parallax lift across the whole pin — keeps the coin "floating".
  const coinFloat = useTransform(scrollYProgress, [0.18, 1], reduced ? [0, 0] : [0, -26]);
  // The halo breathes brighter as the facts complete.
  const haloOpacity = useTransform(scrollYProgress, [0.1, 0.9], [0.12, 0.3]);
  const haloScale = useTransform(scrollYProgress, [0.1, 0.9], reduced ? [1, 1] : [0.9, 1.12]);

  // Heading reveal, scroll-driven so it stays in lockstep with the pin.
  const headOpacity = useTransform(scrollYProgress, [0, 0.1], [0, 1]);
  const headY = useTransform(scrollYProgress, [0, 0.1], reduced ? [0, 0] : [24, 0]);

  /* Each fact band reveals + slides in from the left in sequence, with a
     companion `glow` value (0→1) that fires the check, rule-wipe and corona.
     Hooks are named explicitly (fixed-length) to respect the Rules of Hooks. */
  const f0o = useTransform(scrollYProgress, [0.14, 0.22], [0, 1]);
  const f0x = useTransform(scrollYProgress, [0.14, 0.24], reduced ? [0, 0] : [-36, 0]);
  const f0g = useTransform(scrollYProgress, [0.2, 0.28], [0, 1]);

  const f1o = useTransform(scrollYProgress, [0.32, 0.4], [0, 1]);
  const f1x = useTransform(scrollYProgress, [0.32, 0.42], reduced ? [0, 0] : [-36, 0]);
  const f1g = useTransform(scrollYProgress, [0.38, 0.46], [0, 1]);

  const f2o = useTransform(scrollYProgress, [0.5, 0.58], [0, 1]);
  const f2x = useTransform(scrollYProgress, [0.5, 0.6], reduced ? [0, 0] : [-36, 0]);
  const f2g = useTransform(scrollYProgress, [0.56, 0.64], [0, 1]);

  const f3o = useTransform(scrollYProgress, [0.68, 0.76], [0, 1]);
  const f3x = useTransform(scrollYProgress, [0.68, 0.78], reduced ? [0, 0] : [-36, 0]);
  const f3g = useTransform(scrollYProgress, [0.74, 0.82], [0, 1]);

  const factMotions = [
    { opacity: f0o, x: f0x, glow: f0g },
    { opacity: f1o, x: f1x, glow: f1g },
    { opacity: f2o, x: f2x, glow: f2g },
    { opacity: f3o, x: f3x, glow: f3g },
  ];

  // The certificate seal at the foot of the list strikes once all four lock.
  const sealScale = useTransform(scrollYProgress, [0.82, 0.92], reduced ? [1, 1] : [0.4, 1]);
  const sealOpacity = useTransform(scrollYProgress, [0.82, 0.9], [0, 1]);
  const sealRotate = useTransform(scrollYProgress, [0.82, 0.92], reduced ? [0, 0] : [-22, 0]);

  return (
    <section
      ref={ref}
      className="relative bg-ink-deep grain"
      style={{ minHeight: "320vh" }}
      aria-label="Echtheitsprüfung"
    >
      {/* Sticky stage */}
      <div
        ref={stageRef}
        className="sticky top-0 flex items-center justify-center overflow-hidden"
        style={{ height: "100vh" }}
      >
        {/* Marble texture background, very subtle */}
        <div
          className="absolute inset-0 opacity-[0.04] bg-center bg-cover mix-blend-luminosity"
          style={{ backgroundImage: "url('/textures/marble_01.jpg')" }}
          aria-hidden="true"
        />

        {/* A faint conic gold sweep behind everything, very slowly turning, that
            reads as light raking the room. Pure transform → cheap. */}
        {!reduced && (
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 h-[140vmax] w-[140vmax] -translate-x-1/2 -translate-y-1/2 opacity-[0.06]"
            style={{
              background:
                "conic-gradient(from 0deg, transparent 0deg, rgba(191,148,48,0.5) 30deg, transparent 70deg, transparent 180deg, rgba(191,148,48,0.35) 220deg, transparent 260deg)",
            }}
            animate={inView ? { rotate: 360 } : { rotate: 0 }}
            transition={{ duration: 120, ease: "linear", repeat: Infinity }}
          />
        )}

        {/* Main layout */}
        <div className="relative z-10 mx-auto flex w-full max-w-edge flex-col items-center gap-w14-5 px-6 md:px-12 lg:flex-row lg:gap-20">
          {/* LEFT: heading block + facts */}
          <div className="flex min-w-0 flex-1 flex-col gap-w14-4">
            {/* Heading */}
            <motion.div
              style={{ opacity: headOpacity, y: headY }}
              className="flex flex-col gap-w14-2"
            >
              <p className="eyebrow text-gold">Echtheitsprüfung</p>
              <h2 className="font-display text-fluid-h2 tracking-tight text-white">
                Jedes Stück
                <br />
                <span className="text-gold">wird geprüft.</span>
              </h2>
              <p className="measure text-fluid-body text-white/75">
                Unser mehrstufiges Prüfverfahren sichert die Echtheit jedes
                Edelmetalls, jeder Münze und jedes Antiquitäten-Stückes, das
                unser Haus passiert.
              </p>
            </motion.div>

            {/* Facts list — revealed one band at a time, like a certificate
                being filled in line by line. */}
            <ul className="max-w-sm list-none border-t border-rule pt-w14-1">
              {FACTS.map((fact, i) => (
                <li key={fact.label}>
                  <FactRow
                    icon={fact.icon}
                    label={fact.label}
                    sub={fact.sub}
                    opacity={factMotions[i].opacity}
                    x={factMotions[i].x}
                    glow={factMotions[i].glow}
                  />
                </li>
              ))}
            </ul>

            {/* The certificate seal — strikes once all four facts lock. */}
            <motion.div
              style={{ opacity: sealOpacity }}
              className="flex items-center gap-w14-2"
            >
              <motion.span
                style={{ scale: sealScale, rotate: sealRotate }}
                className="relative flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full"
              >
                <span
                  className="absolute inset-0 rounded-full"
                  style={{
                    background:
                      "radial-gradient(circle at 38% 32%, #e9c25a 0%, #bf9430 48%, #7a5c18 100%)",
                    boxShadow:
                      "0 0 18px rgba(191,148,48,0.6), inset 0 1px 2px rgba(255,255,255,0.4)",
                  }}
                />
                <CheckCircle2
                  size={22}
                  className="relative text-black/80"
                  strokeWidth={2.5}
                  aria-hidden="true"
                />
              </motion.span>
              <div>
                <p className="font-display smallcaps tracking-wide text-white">
                  Geprüft &amp; zertifiziert
                </p>
                <p className="text-xs text-white/70">
                  Vier Stufen bestätigt — versiegelt im Hause Warehouse XIV
                </p>
              </div>
            </motion.div>
          </div>

          {/* RIGHT: the living coin */}
          <motion.div
            style={{ y: coinFloat }}
            className="relative flex flex-shrink-0 items-center justify-center"
          >
            <div
              className="relative flex items-center justify-center"
              style={{ width: 380, height: 380 }}
            >
              {/* Breathing gold halo behind the coin. */}
              <motion.div
                className="absolute inset-0 rounded-full blur-[80px]"
                style={{
                  opacity: haloOpacity,
                  scale: haloScale,
                  background:
                    "radial-gradient(circle, #d9a93c 0%, #bf9430 35%, transparent 70%)",
                }}
                aria-hidden="true"
              />

              {/* A second, tighter cyan/violet ring that pulses with the scan —
                  the "authentication" cue. Pure opacity/scale. */}
              {!reduced && (
                <motion.div
                  className="absolute rounded-full"
                  style={{
                    width: 360,
                    height: 360,
                    border: "1px solid rgba(122,240,200,0.35)",
                    boxShadow: "0 0 30px rgba(122,240,200,0.18)",
                  }}
                  aria-hidden="true"
                  animate={
                    inView
                      ? { scale: [1, 1.06, 1], opacity: [0.0, 0.55, 0.0] }
                      : { opacity: 0 }
                  }
                  transition={{ duration: 3.4, ease: "easeInOut", repeat: Infinity }}
                />
              )}

              {/* The coin itself — entrance scale/rotate then a perpetual mint-turn. */}
              <motion.div
                style={{ scale: coinScale, rotate: coinRotate, opacity: coinEnter }}
                className="relative"
              >
                <GoldCoin active={inView} reduced={reduced} />
              </motion.div>
            </div>
          </motion.div>
        </div>

        {/* Bottom caption */}
        <p className="absolute bottom-w14-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] smallcaps tracking-[0.3em] text-white/75">
          Geprüft . Garantiert . Warehouse XIV
        </p>
      </div>
    </section>
  );
}
