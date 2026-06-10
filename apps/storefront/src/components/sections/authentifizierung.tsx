"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform, useReducedMotion, type MotionValue } from "framer-motion";
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
  y,
}: {
  icon: typeof ScanLine;
  label: string;
  sub: string;
  opacity: MotionValue<number>;
  y: MotionValue<number>;
}) {
  return (
    <motion.div
      style={{ opacity, y }}
      className="flex items-start gap-w14-2 border-b border-rule py-w14-1 last:border-0"
    >
      <span className="bg-gold-gradient mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full">
        <Icon size={14} className="text-black" strokeWidth={2.5} aria-hidden="true" />
      </span>
      <div>
        <p className="font-display text-fluid-body smallcaps tracking-wide text-white">
          {label}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-white/75">{sub}</p>
      </div>
      <span className="ml-auto mt-0.5 flex-shrink-0">
        <CheckCircle2 size={16} className="text-gold opacity-80" strokeWidth={1.5} aria-hidden="true" />
      </span>
    </motion.div>
  );
}

/* Gilded disc with engraved "14" and ring ticks, ~360px — held perfectly still */
function GoldCoin() {
  const ticks = Array.from({ length: 60 }, (_, i) => i);
  const r = 158;

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
        </defs>

        {/* Outer edge ring */}
        <circle cx="180" cy="180" r="176" fill="#2a1e00" stroke="#6b4f10" strokeWidth="1.5" />
        <circle cx="180" cy="180" r="170" fill="#1a1200" />

        {/* Rim ticks */}
        {ticks.map((i) => {
          const angle = (i / 60) * 2 * Math.PI - Math.PI / 2;
          const isLong = i % 5 === 0;
          const inner = isLong ? r - 4 : r - 1.5;
          const outer = r + 6;
          // round to a fixed precision so server and client emit identical
          // strings (avoids an SVG hydration mismatch on the last float digit)
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

        {/* Coin face */}
        <circle cx="180" cy="180" r={r} fill="url(#coinFace)" />
        <circle cx="180" cy="180" r={r} fill="url(#sheen)" />

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

        {/* Arch text top */}
        <path
          id="arcTop"
          d="M 60,180 A 120,120 0 0 1 300,180"
          fill="none"
        />
        <text fontSize="9.5" letterSpacing="3.5" fill="#c9960e" opacity="0.75">
          <textPath href="#arcTop" startOffset="50%" textAnchor="middle">
            WAREHOUSE XIV . GOLDHAUS . SCHORNDORF
          </textPath>
        </text>

        {/* Arch text bottom */}
        <path
          id="arcBottom"
          d="M 60,180 A 120,120 0 0 0 300,180"
          fill="none"
        />
        <text fontSize="9.5" letterSpacing="3.5" fill="#c9960e" opacity="0.75">
          <textPath href="#arcBottom" startOffset="50%" textAnchor="middle">
            FEINGOLD . 999,9 . FEINSILBER . 999,0
          </textPath>
        </text>

        {/* Specular highlight */}
        <ellipse cx="148" cy="148" rx="48" ry="30" fill="white" opacity="0.06" transform="rotate(-25 148 148)" />
      </svg>
    </div>
  );
}

export function Authentifizierung() {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });

  /* The single calm gesture: each fact band fades in sequentially.
     Hooks are named explicitly (fixed-length array) so they are never
     called inside .map() — keeps the Rules of Hooks satisfied. */
  const fact0Opacity = useTransform(scrollYProgress, [0.12, 0.2, 0.26, 0.34], [0, 1, 1, 1]);
  const fact0Y = useTransform(scrollYProgress, [0.12, 0.22], reduced ? [0, 0] : [28, 0]);

  const fact1Opacity = useTransform(scrollYProgress, [0.32, 0.4, 0.46, 0.54], [0, 1, 1, 1]);
  const fact1Y = useTransform(scrollYProgress, [0.32, 0.42], reduced ? [0, 0] : [28, 0]);

  const fact2Opacity = useTransform(scrollYProgress, [0.52, 0.6, 0.66, 0.74], [0, 1, 1, 1]);
  const fact2Y = useTransform(scrollYProgress, [0.52, 0.62], reduced ? [0, 0] : [28, 0]);

  const fact3Opacity = useTransform(scrollYProgress, [0.72, 0.8, 0.86, 0.94], [0, 1, 1, 1]);
  const fact3Y = useTransform(scrollYProgress, [0.72, 0.82], reduced ? [0, 0] : [28, 0]);

  const factMotions = [
    { opacity: fact0Opacity, y: fact0Y },
    { opacity: fact1Opacity, y: fact1Y },
    { opacity: fact2Opacity, y: fact2Y },
    { opacity: fact3Opacity, y: fact3Y },
  ];

  return (
    <section
      ref={ref}
      className="relative bg-ink-deep grain"
      style={{ minHeight: "280vh" }}
      aria-label="Echtheitsprüfung"
    >
      {/* Sticky stage */}
      <div className="sticky top-0 flex items-center justify-center overflow-hidden" style={{ height: "100vh" }}>

        {/* Marble texture background, very subtle */}
        <div
          className="absolute inset-0 opacity-[0.04] bg-center bg-cover mix-blend-luminosity"
          style={{ backgroundImage: "url('/textures/marble_01.jpg')" }}
          aria-hidden="true"
        />

        {/* Main layout */}
        <div className="relative z-10 mx-auto flex w-full max-w-edge flex-col items-center gap-w14-5 px-6 md:px-12 lg:flex-row lg:gap-20">

          {/* LEFT: heading block + facts */}
          <div className="flex min-w-0 flex-1 flex-col gap-w14-4">

            {/* Heading */}
            <div className="flex flex-col gap-w14-2">
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
            </div>

            {/* Facts list — presented in sequence, like a certificate */}
            <ul className="max-w-sm list-none border-t border-rule pt-w14-1">
              {FACTS.map((fact, i) => (
                <li key={fact.label}>
                  <FactRow
                    icon={fact.icon}
                    label={fact.label}
                    sub={fact.sub}
                    opacity={factMotions[i].opacity}
                    y={factMotions[i].y}
                  />
                </li>
              ))}
            </ul>

          </div>

          {/* RIGHT: coin — held still */}
          <div className="relative flex flex-shrink-0 items-center justify-center"
            style={{ width: 380, height: 380 }}>

            {/* Soft ambient halo behind the coin — kept faint, no gold bloom */}
            <div
              className="absolute inset-0 rounded-full opacity-[0.12] blur-[80px]"
              style={{ background: "radial-gradient(circle, #bf9430 0%, transparent 70%)" }}
              aria-hidden="true"
            />

            <GoldCoin />

          </div>
        </div>

        {/* Bottom caption */}
        <p className="absolute bottom-w14-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] smallcaps tracking-[0.3em] text-white/75">
          Geprüft . Garantiert . Warehouse XIV
        </p>

      </div>
    </section>
  );
}
