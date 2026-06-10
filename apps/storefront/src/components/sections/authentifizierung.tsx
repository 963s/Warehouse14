"use client";

import { useEffect, useRef, useState } from "react";
import {
  motion,
  useScroll,
  useTransform,
  useReducedMotion,
  useInView,
  type MotionValue,
} from "framer-motion";
import { ScanLine, CheckCircle2, Scale, Gem, Award } from "lucide-react";

// useIsDesktop — true at/above `lg` (1024px), the breakpoint where the coin and
// the fact-list sit side-by-side. Below it (phones/tablets) the section FLOWS
// in one column and reveals on scroll instead of pinning, so a 320vh pin can
// never trap an overflowing stack on a 390px screen. SSR-safe.
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isDesktop;
}

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
  pinned,
  index,
  reduced,
}: {
  icon: typeof ScanLine;
  label: string;
  sub: string;
  opacity: MotionValue<number>;
  x: MotionValue<number>;
  glow: MotionValue<number>;
  pinned: boolean;
  index: number;
  reduced: boolean | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const selfInView = useInView(ref, { once: true, margin: "-10%" });

  // The only "commit" cue is the check striking in — a small fade + settle.
  // No gold rule-wipe, no corona glow: the certificate fills, it doesn't sparkle.
  const checkScale = useTransform(glow, [0, 1], [0.6, 1]);

  // Pinned (desktop): the row rides the scroll timeline (slide-in + check).
  // Flowing (mobile): the same fade+rise, self-triggered as it enters view.
  const rowMotion = pinned
    ? { style: { opacity, x } }
    : {
        initial: reduced ? false : ({ opacity: 0, x: -20 } as const),
        animate: selfInView ? { opacity: 1, x: 0 } : {},
        transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] as const },
      };
  const checkMotion = pinned
    ? { style: { opacity: glow, scale: checkScale } }
    : {
        initial: reduced ? false : ({ opacity: 0, scale: 0.6 } as const),
        animate: selfInView ? { opacity: 1, scale: 1 } : {},
        transition: { duration: 0.45, delay: 0.25 + index * 0.05, ease: [0.16, 1, 0.3, 1] as const },
      };

  return (
    <motion.div
      ref={ref}
      {...rowMotion}
      className="group relative flex items-start gap-w14-2 border-b border-rule py-w14-2 last:border-0"
    >
      <span className="bg-gold-gradient mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full">
        <Icon size={14} className="text-black" strokeWidth={2.5} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="font-display text-fluid-body smallcaps tracking-wide text-white">
          {label}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-white/75">{sub}</p>
      </div>
      <motion.span
        className="ml-auto mt-0.5 flex-shrink-0"
        {...checkMotion}
      >
        <CheckCircle2 size={16} className="text-gold opacity-90" strokeWidth={1.5} aria-hidden="true" />
      </motion.span>
    </motion.div>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * GoldCoin — a struck, minted disc. Still and dignified.
 *   · a single, very slow mint-turn of the milled rim (its quiet character)
 *   · embossed "14", arched legends and an engraved ring
 * No specular band, no spectral scan, no leading-edge glint — the bling is
 * gone; what remains is the object, well lit. SVG, transform-only, 60fps.
 * Reduced-motion: the rim holds still too.
 * ────────────────────────────────────────────────────────────────────────── */
function GoldCoin({ active, reduced }: { active: boolean; reduced: boolean | null }) {
  const ticks = Array.from({ length: 60 }, (_, i) => i);
  const r = 158;
  const animate = active && !reduced;

  return (
    <div className="relative h-full w-full select-none" aria-hidden="true">
      <svg
        viewBox="0 0 360 360"
        className="h-full w-full drop-shadow-[0_24px_48px_rgba(0,0,0,0.5)]"
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
        </defs>

        {/* Outer edge ring */}
        <circle cx="180" cy="180" r="176" fill="#2a1e00" stroke="#6b4f10" strokeWidth="1.5" />
        <circle cx="180" cy="180" r="170" fill="#1a1200" />

        {/* Rim ticks — one very slow, dignified mint-turn (not a glint loop). */}
        <g>
          {animate && (
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 180 180"
              to="360 180 180"
              dur="140s"
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

          {/* A still warm aura on the face — depth, not a drifting gleam. */}
          <ellipse cx="150" cy="140" rx="150" ry="150" fill="url(#coinEdge)" />

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

          {/* Arched legends — struck into the coin, held still. */}
          <g>
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

          {/* A single, soft static highlight — the catch-light of good lighting,
              not a travelling shine. (Specular band + spectral scan removed.) */}
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
  const isDesktop = useIsDesktop();

  // PIN only with room (lg+) and motion welcome. On a phone the section flows:
  // heading → coin → facts → seal stack and reveal on scroll.
  const pinned = isDesktop && !reduced;

  // inview-gate the expensive coin SMIL: only run it while the stage is on
  // screen.
  const inView = useInView(stageRef, { margin: "-10% 0px -10% 0px" });
  // Mobile (un-pinned) reveals: each block fades+rises as it enters the column.
  const headInView = useInView(stageRef, { once: true, margin: "-15%" });

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

  // Heading / coin / seal motion: pin-driven on desktop, self-revealing on mobile.
  const headMotion = pinned
    ? { style: { opacity: headOpacity, y: headY } }
    : {
        initial: reduced ? false : ({ opacity: 0, y: 24 } as const),
        animate: headInView ? { opacity: 1, y: 0 } : {},
        transition: { duration: 0.65, ease: [0.16, 1, 0.3, 1] as const },
      };
  const sealMotion = pinned
    ? { style: { opacity: sealOpacity } }
    : {
        initial: reduced ? false : ({ opacity: 0, y: 16 } as const),
        animate: headInView ? { opacity: 1, y: 0 } : {},
        transition: { duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] as const },
      };

  return (
    <section
      ref={ref}
      className="relative bg-ink-deep grain"
      style={{ minHeight: pinned ? "320vh" : "auto" }}
      aria-label="Echtheitsprüfung"
    >
      {/* Stage — pinned + scroll-choreographed on desktop, flowing on mobile. */}
      <div
        ref={stageRef}
        className={
          pinned
            ? "sticky top-0 flex items-center justify-center overflow-hidden"
            : "relative flex flex-col items-center justify-center overflow-hidden py-section"
        }
        style={pinned ? { height: "100vh" } : undefined}
      >
        {/* Marble texture background, very subtle */}
        <div
          className="absolute inset-0 opacity-[0.04] bg-center bg-cover mix-blend-luminosity"
          style={{ backgroundImage: "url('/textures/marble_01.jpg')" }}
          aria-hidden="true"
        />

        {/* A single, still warm wash grounds the stage — no turning conic sweep. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(60% 50% at 50% 42%, rgba(191,148,48,0.10) 0%, transparent 70%)",
          }}
        />

        {/* Main layout. On mobile the coin sits between the heading and the
            facts so it reads as the hero of a single, calm column. */}
        <div className="relative z-10 mx-auto flex w-full max-w-edge flex-col items-center gap-w14-4 px-6 md:px-12 lg:flex-row lg:items-center lg:gap-20">
          {/* Heading — first in the column on mobile, top-left on desktop. */}
          <div className="order-1 flex min-w-0 flex-1 flex-col gap-w14-4 lg:order-none">
            <motion.div {...headMotion} className="flex flex-col gap-w14-2">
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

            {/* Facts list — each band reveals like a line on a certificate. */}
            <ul className="w-full max-w-md list-none border-t border-rule pt-w14-1 lg:max-w-sm">
              {FACTS.map((fact, i) => (
                <li key={fact.label}>
                  <FactRow
                    icon={fact.icon}
                    label={fact.label}
                    sub={fact.sub}
                    opacity={factMotions[i].opacity}
                    x={factMotions[i].x}
                    glow={factMotions[i].glow}
                    pinned={pinned}
                    index={i}
                    reduced={reduced}
                  />
                </li>
              ))}
            </ul>

            {/* The certificate seal — struck, not glowing. */}
            <motion.div {...sealMotion} className="flex items-center gap-w14-2">
              <motion.span
                style={pinned ? { scale: sealScale, rotate: sealRotate } : undefined}
                className="relative flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full"
              >
                <span
                  className="absolute inset-0 rounded-full"
                  style={{
                    background:
                      "radial-gradient(circle at 38% 32%, #e9c25a 0%, #bf9430 48%, #7a5c18 100%)",
                    boxShadow: "inset 0 1px 2px rgba(255,255,255,0.4)",
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

          {/* The coin — hero between heading and facts on mobile (order-0),
              right column on desktop. Sized fluidly so it never overflows a
              390px screen. */}
          <motion.div
            style={pinned ? { y: coinFloat } : undefined}
            className="relative order-0 flex flex-shrink-0 items-center justify-center lg:order-none"
          >
            <div className="relative flex aspect-square w-[min(78vw,340px)] items-center justify-center sm:w-[360px] lg:w-[380px]">
              {/* A still gold halo behind the coin — no breathing, no pulse. */}
              <motion.div
                className="absolute inset-0 rounded-full blur-[80px]"
                style={{
                  opacity: pinned ? haloOpacity : 0.2,
                  scale: pinned ? haloScale : 1,
                  background:
                    "radial-gradient(circle, #d9a93c 0%, #bf9430 35%, transparent 70%)",
                }}
                aria-hidden="true"
              />

              {/* The coin itself — entrance scale/rotate on desktop, a quiet
                  fade-in on mobile. (The pulsing auth-ring is removed.) */}
              <motion.div
                style={pinned ? { scale: coinScale, rotate: coinRotate, opacity: coinEnter } : undefined}
                initial={pinned || reduced ? false : { opacity: 0, scale: 0.92 }}
                animate={pinned ? undefined : headInView ? { opacity: 1, scale: 1 } : {}}
                transition={pinned ? undefined : { duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                className="relative h-full w-full"
              >
                <GoldCoin active={inView} reduced={reduced} />
              </motion.div>
            </div>
          </motion.div>
        </div>

        {/* Bottom caption — pinned to the foot on desktop, in-flow on mobile. */}
        <p
          className={
            pinned
              ? "absolute bottom-w14-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] smallcaps tracking-[0.3em] text-white/75"
              : "mt-w14-5 text-center text-[10px] smallcaps tracking-[0.3em] text-white/75"
          }
        >
          Geprüft . Garantiert . Warehouse XIV
        </p>
      </div>
    </section>
  );
}
