"use client";

import { useRef } from "react";
import {
  motion,
  useScroll,
  useTransform,
  useInView,
  useReducedMotion,
} from "framer-motion";

// ---------------------------------------------------------------------------
// Isometric helpers
// Isometric projection: rotate 45deg then skewY(-30deg) on each face.
// We hand-build the SVG polygons directly for full control.
// All coordinates in viewBox units, isometric style.
// ---------------------------------------------------------------------------

const GOLD = "#bf9430";
const DEEP_GOLD = "#8a6a1f";
const GOLD_LIGHT = "#e0b84a";
const PATINA = "#4a7c6f";
const INK = "#1a1510";
const INK_AGED = "#3d3020";
const IVORY = "#f5f0e8";
const SHADOW = "rgba(26,21,16,0.18)";

// Motion primitives — mirror globals.css so timings match the rest of the site.
const EASE = [0.16, 1, 0.3, 1] as const; // --w14-ease-out (curator entrance)
const DUR_SLOW = 0.65; // --w14-dur-slow
const STAGGER = 0.07; // --w14-stagger

// ---------------------------------------------------------------------------
// Stage 1 — Das Kontor (vault/shop building)
// ---------------------------------------------------------------------------
function StageKontor() {
  return (
    <g>
      {/* Long shadow */}
      <ellipse cx="84" cy="178" rx="52" ry="14" fill={SHADOW} />

      {/* Building left face */}
      <polygon
        points="20,110 20,160 84,196 84,146"
        fill="#3d3020"
      />
      {/* Building right face */}
      <polygon
        points="84,146 84,196 148,160 148,110"
        fill="#2a2010"
      />
      {/* Building top face */}
      <polygon
        points="20,110 84,74 148,110 84,146"
        fill="#4a3820"
      />

      {/* Roof ridge */}
      <polygon
        points="20,110 84,74 148,110 84,96"
        fill={DEEP_GOLD}
        opacity="0.7"
      />

      {/* Front door (left face) */}
      <polygon
        points="46,138 46,160 68,173 68,151"
        fill={DEEP_GOLD}
        opacity="0.6"
      />
      {/* Door handle */}
      <circle cx="64" cy="162" r="2.5" fill={GOLD_LIGHT} opacity="0.9" />

      {/* Window left face */}
      <polygon
        points="24,118 24,132 44,143 44,129"
        fill={PATINA}
        opacity="0.5"
      />
      <line x1="34" y1="118" x2="34" y2="143" stroke={INK_AGED} strokeWidth="0.8" opacity="0.6" />
      <line x1="24" y1="130" x2="44" y2="141" stroke={INK_AGED} strokeWidth="0.8" opacity="0.6" />

      {/* Window right face */}
      <polygon
        points="104,129 104,143 126,130 126,116"
        fill={PATINA}
        opacity="0.5"
      />
      <line x1="115" y1="116" x2="115" y2="130" stroke={INK_AGED} strokeWidth="0.8" opacity="0.6" />

      {/* Vault door on right face */}
      <polygon
        points="104,143 104,165 126,152 126,130"
        fill="#1a1008"
        opacity="0.8"
      />
      <circle cx="115" cy="148" r="9" fill="none" stroke={GOLD} strokeWidth="1.5" opacity="0.8" />
      <circle cx="115" cy="148" r="5" fill="none" stroke={GOLD_LIGHT} strokeWidth="1" opacity="0.6" />
      {/* Vault spokes */}
      {[0, 60, 120, 180, 240, 300].map((a) => {
        const rad = (a * Math.PI) / 180;
        // round so server and client emit identical attribute strings
        const r = (v: number) => Math.round(v * 1000) / 1000;
        return (
        <line
          key={a}
          x1={r(115 + 5 * Math.cos(rad))}
          y1={r(148 + 5 * Math.sin(rad))}
          x2={r(115 + 9 * Math.cos(rad))}
          y2={r(148 + 9 * Math.sin(rad))}
          stroke={GOLD}
          strokeWidth="1.2"
          opacity="0.7"
        />
        );
      })}

      {/* Emblem on top */}
      <text
        x="84"
        y="93"
        textAnchor="middle"
        fill={GOLD}
        fontSize="10"
        fontFamily="serif"
        opacity="0.9"
      >
        W14
      </text>

      {/* Lantern */}
      <rect x="80" y="60" width="8" height="12" rx="2" fill={GOLD_LIGHT} opacity="0.8" />
      <line x1="84" y1="60" x2="84" y2="56" stroke={GOLD} strokeWidth="1.2" />
      <polygon points="78,60 84,55 90,60" fill={GOLD} opacity="0.7" />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Stage 2 — Die Prüfung (loupe + coin + balance scale)
// ---------------------------------------------------------------------------
function StagePrüfung() {
  return (
    <g>
      {/* Shadow */}
      <ellipse cx="84" cy="178" rx="48" ry="12" fill={SHADOW} />

      {/* Table top face */}
      <polygon
        points="20,140 84,110 148,140 84,170"
        fill="#3a2e1a"
      />
      {/* Table left leg */}
      <polygon
        points="20,140 20,170 46,185 46,155"
        fill="#2a2010"
      />
      {/* Table right leg */}
      <polygon
        points="122,155 122,185 148,170 148,140"
        fill="#1e180c"
      />

      {/* Green felt on table */}
      <polygon
        points="28,138 84,112 140,138 84,164"
        fill={PATINA}
        opacity="0.35"
      />

      {/* Coin on table */}
      <ellipse cx="72" cy="138" rx="16" ry="9" fill={GOLD} opacity="0.9" />
      <ellipse cx="72" cy="136" rx="16" ry="9" fill={GOLD_LIGHT} />
      <ellipse cx="72" cy="136" rx="10" ry="6" fill={GOLD} opacity="0.6" />
      {/* Eagle relief on coin */}
      <text x="72" y="139" textAnchor="middle" fill={IVORY} fontSize="7" fontFamily="serif" opacity="0.8">
        &#x2658;
      </text>

      {/* Loupe over coin */}
      <circle cx="72" cy="127" r="14" fill="none" stroke={GOLD} strokeWidth="2.5" />
      <circle cx="72" cy="127" r="13" fill={PATINA} opacity="0.18" />
      {/* Loupe cross-hairs */}
      <line x1="58" y1="127" x2="86" y2="127" stroke={GOLD_LIGHT} strokeWidth="0.6" opacity="0.5" />
      <line x1="72" y1="113" x2="72" y2="141" stroke={GOLD_LIGHT} strokeWidth="0.6" opacity="0.5" />
      {/* Loupe handle */}
      <line x1="83" y1="138" x2="96" y2="151" stroke={INK_AGED} strokeWidth="3.5" strokeLinecap="round" />
      <line x1="83" y1="138" x2="96" y2="151" stroke={GOLD} strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />

      {/* Balance scale */}
      {/* Pole */}
      <line x1="112" y1="145" x2="112" y2="118" stroke={GOLD} strokeWidth="1.8" />
      {/* Arm */}
      <line x1="96" y1="120" x2="128" y2="120" stroke={GOLD} strokeWidth="1.5" />
      <circle cx="112" cy="118" r="3" fill={GOLD_LIGHT} />
      {/* Left pan string */}
      <line x1="96" y1="120" x2="96" y2="132" stroke={INK_AGED} strokeWidth="0.8" />
      {/* Right pan string */}
      <line x1="128" y1="120" x2="128" y2="130" stroke={INK_AGED} strokeWidth="0.8" />
      {/* Left pan (lower, heavier) */}
      <ellipse cx="96" cy="134" rx="10" ry="3.5" fill={GOLD} opacity="0.8" />
      {/* Right pan (higher, lighter) */}
      <ellipse cx="128" cy="131" rx="10" ry="3.5" fill={GOLD} opacity="0.5" />
      {/* Weight on left pan */}
      <rect x="90" y="130" width="12" height="5" rx="1" fill={DEEP_GOLD} opacity="0.9" />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Stage 3 — Versichert verpackt (sealed box with wax seal)
// ---------------------------------------------------------------------------
function StageVerpackt() {
  return (
    <g>
      {/* Shadow */}
      <ellipse cx="84" cy="182" rx="50" ry="13" fill={SHADOW} />

      {/* Box bottom left face */}
      <polygon
        points="24,148 24,176 84,208 84,180"
        fill="#3a2e1a"
      />
      {/* Box bottom right face */}
      <polygon
        points="84,180 84,208 144,176 144,148"
        fill="#2a2010"
      />
      {/* Box top */}
      <polygon
        points="24,148 84,116 144,148 84,180"
        fill="#4a3820"
      />

      {/* Lid left face (slightly raised) */}
      <polygon
        points="20,144 20,152 84,184 84,176"
        fill="#56422a"
      />
      {/* Lid right face */}
      <polygon
        points="84,176 84,184 148,152 148,144"
        fill="#3d2e18"
      />
      {/* Lid top */}
      <polygon
        points="20,144 84,112 148,144 84,176"
        fill="#6b5030"
      />

      {/* Ribbon vertical (left face) */}
      <polygon
        points="76,148 76,184 92,193 92,157"
        fill={GOLD}
        opacity="0.7"
      />
      {/* Ribbon horizontal (top) */}
      <polygon
        points="20,144 84,112 148,144 84,176"
        clipPath="url(#ribbonClip)"
      />
      <polygon
        points="76,112 92,112 92,176 76,176"
        fill={GOLD}
        opacity="0.5"
        transform="skewY(-30) rotate(30)"
      />

      {/* Wax seal — center of lid top */}
      <ellipse cx="84" cy="144" rx="14" ry="9" fill="#8b1a1a" opacity="0.9" />
      <ellipse cx="84" cy="143" rx="14" ry="9" fill="#a52020" />
      <ellipse cx="84" cy="142" rx="10" ry="6.5" fill="#8b1a1a" opacity="0.8" />
      {/* W14 on seal */}
      <text
        x="84"
        y="145"
        textAnchor="middle"
        fill={GOLD_LIGHT}
        fontSize="7"
        fontFamily="serif"
        fontWeight="bold"
      >
        W14
      </text>

      {/* Kraft paper texture lines */}
      {[0, 1, 2, 3].map((i) => (
        <line
          key={i}
          x1={24}
          y1={155 + i * 6}
          x2={76}
          y2={178 + i * 4}
          stroke={INK_AGED}
          strokeWidth="0.4"
          opacity="0.25"
        />
      ))}

      {/* Insurance badge (small label) */}
      <polygon
        points="96,166 96,178 118,168 118,156"
        fill={IVORY}
        opacity="0.85"
      />
      <text
        x="107"
        y="165"
        textAnchor="middle"
        fill={DEEP_GOLD}
        fontSize="4.5"
        fontFamily="serif"
        transform="rotate(-6, 107, 165)"
      >
        Vers.
      </text>
      <text
        x="107"
        y="171"
        textAnchor="middle"
        fill={INK_AGED}
        fontSize="4"
        fontFamily="sans-serif"
        transform="rotate(-6, 107, 171)"
      >
        100%
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Stage 4 — Bei Ihnen (parcel at a door)
// ---------------------------------------------------------------------------
function StageBeiIhnen() {
  return (
    <g>
      {/* Shadow */}
      <ellipse cx="84" cy="184" rx="54" ry="14" fill={SHADOW} />

      {/* House wall left face */}
      <polygon
        points="14,108 14,180 84,220 84,148"
        fill="#3d3020"
      />
      {/* House wall right face */}
      <polygon
        points="84,148 84,220 154,180 154,108"
        fill="#2a2010"
      />
      {/* Roof left */}
      <polygon
        points="14,108 84,68 84,80 14,120"
        fill={DEEP_GOLD}
        opacity="0.8"
      />
      {/* Roof right */}
      <polygon
        points="84,68 154,108 154,120 84,80"
        fill={GOLD}
        opacity="0.6"
      />
      {/* Roof top ridge */}
      <polygon
        points="14,108 84,68 154,108 84,96"
        fill={GOLD_LIGHT}
        opacity="0.5"
      />

      {/* Door frame left face */}
      <polygon
        points="36,148 36,192 68,210 68,166"
        fill="#1a1008"
      />
      {/* Door */}
      <polygon
        points="38,148 38,190 66,207 66,166"
        fill="#2e2010"
      />
      {/* Door arch */}
      <path
        d="M 38,148 Q 52,136 66,148"
        fill="none"
        stroke={GOLD}
        strokeWidth="1.5"
        opacity="0.8"
      />
      {/* Door knocker */}
      <circle cx="58" cy="178" r="3" fill="none" stroke={GOLD} strokeWidth="1.5" />
      <circle cx="58" cy="182" r="1.5" fill={GOLD} />

      {/* Window right face */}
      <polygon
        points="96,136 96,156 126,140 126,120"
        fill={PATINA}
        opacity="0.45"
      />
      <line x1="111" y1="120" x2="111" y2="140" stroke={INK} strokeWidth="0.8" opacity="0.5" />
      <line x1="96" y1="130" x2="126" y2="114" stroke={INK} strokeWidth="0.8" opacity="0.5" />
      {/* Warm light glow in window */}
      <polygon
        points="96,136 96,156 126,140 126,120"
        fill="#f5c040"
        opacity="0.12"
      />

      {/* Parcel on doorstep — smaller box */}
      {/* Parcel left face */}
      <polygon
        points="36,192 36,206 62,220 62,206"
        fill="#4a3820"
      />
      {/* Parcel right face */}
      <polygon
        points="62,206 62,220 84,208 84,194"
        fill="#3a2e18"
      />
      {/* Parcel top */}
      <polygon
        points="36,192 62,180 84,194 58,206"
        fill="#5a4428"
      />
      {/* Parcel ribbon */}
      <line x1="46" y1="190" x2="46" y2="206" stroke={GOLD} strokeWidth="1.5" opacity="0.8" />
      <line x1="36" y1="194" x2="58" y2="206" stroke={GOLD} strokeWidth="1" opacity="0.6" />
      {/* Wax seal on parcel */}
      <ellipse cx="52" cy="194" rx="7" ry="4.5" fill="#8b1a1a" opacity="0.9" />
      <text x="52" y="196" textAnchor="middle" fill={GOLD_LIGHT} fontSize="4" fontFamily="serif">W</text>

      {/* Step */}
      <polygon
        points="28,206 28,214 84,230 84,222"
        fill="#2a2010"
      />
      <polygon
        points="28,206 84,194 84,202 28,214"
        fill="#3a2e18"
      />

      {/* Welcoming light beam from door */}
      <polygon
        points="38,160 66,150 58,200 36,205"
        fill="#f5c040"
        opacity="0.06"
      />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Individual stage card with isometric scene
// ---------------------------------------------------------------------------
const stages = [
  {
    id: 1,
    label: "Das Kontor",
    sub: "Sorgfältige Auswahl in Schorndorf",
    Scene: StageKontor,
  },
  {
    id: 2,
    label: "Die Prüfung",
    sub: "Zertifizierte Echtheitsprüfung",
    Scene: StagePrüfung,
  },
  {
    id: 3,
    label: "Versichert verpackt",
    sub: "Vollkaskoversichert bis zu Ihrer Tür",
    Scene: StageVerpackt,
  },
  {
    id: 4,
    label: "Bei Ihnen",
    sub: "Sicherer Empfang, garantiert",
    Scene: StageBeiIhnen,
  },
];

// ---------------------------------------------------------------------------
// Animated stage reveal
// ---------------------------------------------------------------------------
function StageCard({
  stage,
  index,
}: {
  stage: (typeof stages)[number];
  index: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-12%" });
  const prefersReduced = useReducedMotion();

  const { Scene } = stage;

  return (
    <motion.div
      ref={ref}
      initial={prefersReduced ? false : { opacity: 0, y: 16 }}
      animate={
        isInView
          ? { opacity: 1, y: 0 }
          : prefersReduced
          ? { opacity: 1 }
          : { opacity: 0, y: 16 }
      }
      transition={{
        duration: DUR_SLOW,
        delay: index * STAGGER,
        ease: EASE,
      }}
      className="flex flex-col items-center gap-w14-2"
    >
      {/* Stage number chip */}
      <div className="mb-w14-1 flex items-center gap-2.5">
        <span
          className="tnum inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs"
          style={{
            borderColor: GOLD,
            color: GOLD,
            fontFamily: "var(--font-display, serif)",
          }}
        >
          {index + 1}
        </span>
        <div className="h-px w-8 opacity-30" style={{ backgroundColor: GOLD }} />
      </div>

      {/* Isometric illustration */}
      <div
        className="relative w-full rounded-card overflow-hidden"
        style={{
          background: `radial-gradient(ellipse at 40% 60%, rgba(191,148,48,0.07) 0%, rgba(74,124,111,0.05) 60%, transparent 100%)`,
          border: `1px solid rgba(191,148,48,0.18)`,
          boxShadow: "0 4px 32px rgba(26,21,16,0.18), 0 1px 0 rgba(191,148,48,0.12) inset",
          minHeight: "220px",
        }}
      >
        {/* Marble texture overlay */}
        <div
          className="absolute inset-0 opacity-[0.04] pointer-events-none"
          style={{
            backgroundImage: "url('/textures/marble_01.jpg')",
            backgroundSize: "cover",
            mixBlendMode: "overlay",
          }}
        />
        {/* Paper grain */}
        <div className="grain absolute inset-0 opacity-20 pointer-events-none" />

        <svg
          viewBox="0 0 168 230"
          className="w-full h-auto"
          style={{ display: "block" }}
          role="img"
          aria-label={stage.label}
        >
          {/* Ambient floor plane */}
          <ellipse cx="84" cy="195" rx="70" ry="22" fill={SHADOW} />

          {/* Patina floor grid lines (isometric) */}
          {[-2, -1, 0, 1, 2].map((i) => (
            <g key={i} opacity="0.06">
              <line
                x1={84 + i * 20}
                y1={195}
                x2={84 + i * 20 - 50}
                y2={215}
                stroke={GOLD}
                strokeWidth="0.6"
              />
              <line
                x1={84 + i * 20}
                y1={195}
                x2={84 + i * 20 + 50}
                y2={215}
                stroke={GOLD}
                strokeWidth="0.6"
              />
            </g>
          ))}

          <Scene />
        </svg>
      </div>

      {/* Label */}
      <div className="px-2 text-center">
        <h3
          className="mb-w14-1 font-display text-fluid-h3"
          style={{ color: IVORY }}
        >
          {stage.label}
        </h3>
        <p className="text-fluid-body" style={{ color: "rgba(255,255,255,0.75)" }}>
          {stage.sub}
        </p>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Animated connecting path in between columns
// ---------------------------------------------------------------------------
function AnimatedConnector({ index }: { index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-12%" });
  const prefersReduced = useReducedMotion();

  const dotCount = 7;

  return (
    <div
      ref={ref}
      className="hidden md:flex items-center justify-center flex-1 min-w-0 relative mt-0"
      style={{ paddingBottom: "80px" }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 80 40" className="w-full" style={{ overflow: "visible" }}>
        {Array.from({ length: dotCount }).map((_, i) => {
          const t = i / (dotCount - 1);
          const x = Math.round((4 + t * 72) * 1000) / 1000;
          const y = Math.round((20 + Math.sin(t * Math.PI) * -10) * 1000) / 1000;
          const delay = index * STAGGER + i * 0.05;
          return (
            <motion.circle
              key={i}
              cx={x}
              cy={y}
              r={i === 0 || i === dotCount - 1 ? 3 : i % 2 === 0 ? 2.5 : 1.8}
              fill={i % 2 === 0 ? GOLD : GOLD_LIGHT}
              initial={prefersReduced ? false : { opacity: 0 }}
              animate={
                isInView
                  ? { opacity: i % 2 === 0 ? 0.9 : 0.5 }
                  : { opacity: prefersReduced ? 0.9 : 0 }
              }
              transition={{ duration: 0.4, delay, ease: EASE }}
            />
          );
        })}
        {/* Arrowhead */}
        <motion.polygon
          points="76,20 68,16 68,24"
          fill={GOLD}
          initial={prefersReduced ? false : { opacity: 0 }}
          animate={isInView ? { opacity: 0.9 } : { opacity: 0 }}
          transition={{
            duration: 0.4,
            delay: index * STAGGER + dotCount * 0.05,
            ease: EASE,
          }}
        />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export function IsometricJourney() {
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLDivElement>(null);
  const headingInView = useInView(headingRef, { once: true, margin: "-40px" });
  const prefersReduced = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start 0.9", "center 0.5"],
  });

  // The single permitted deco hairline grows with scroll — but holds at full
  // width under reduced-motion so no transform is driven by the scroll position.
  const lineWidth = useTransform(
    scrollYProgress,
    [0, 1],
    prefersReduced ? ["100%", "100%"] : ["0%", "100%"],
  );

  return (
    <section
      ref={sectionRef}
      className="relative overflow-hidden py-section"
      style={{
        background:
          "linear-gradient(170deg, #0e0b06 0%, #1a1510 35%, #12100c 65%, #0e0b06 100%)",
      }}
    >
      {/* Marble texture — very subtle full-section wash */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: "url('/textures/marble_01.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          opacity: 0.028,
          mixBlendMode: "overlay",
        }}
      />

      {/* Paper grain overlay */}
      <div className="grain absolute inset-0 opacity-[0.35] pointer-events-none" />

      {/* Ambient gold glow top-center */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[260px] pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at 50% 0%, rgba(191,148,48,0.12) 0%, transparent 70%)",
        }}
      />

      {/* Verdigris glow bottom-right */}
      <div
        className="absolute bottom-0 right-0 w-[400px] h-[300px] pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at 100% 100%, rgba(74,124,111,0.09) 0%, transparent 65%)",
        }}
      />

      <div className="relative z-10 mx-auto max-w-edge px-6 lg:px-8">
        {/* ── Heading ── */}
        <div ref={headingRef} className="mb-w14-6 max-w-2xl">
          <motion.p
            initial={prefersReduced ? false : { opacity: 0, y: 12 }}
            animate={headingInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: DUR_SLOW, ease: EASE }}
            className="eyebrow mb-w14-3"
            style={{ color: GOLD, opacity: headingInView ? 1 : 0 }}
          >
            Unser Versprechen
          </motion.p>

          <motion.h2
            initial={prefersReduced ? false : { opacity: 0, y: 16 }}
            animate={headingInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: DUR_SLOW, delay: STAGGER, ease: EASE }}
            className="mb-w14-3 font-display text-fluid-h2 tracking-tight"
            style={{ color: IVORY }}
          >
            Vom Kontor{" "}
            <span style={{ color: GOLD_LIGHT }}>zu Ihnen.</span>
          </motion.h2>

          <motion.p
            initial={prefersReduced ? false : { opacity: 0, y: 16 }}
            animate={headingInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: DUR_SLOW, delay: STAGGER * 2, ease: EASE }}
            className="measure text-fluid-lead"
            style={{ color: "rgba(255,255,255,0.75)" }}
          >
            Jedes Stück, das unser Kontor verlässt, hat eine Geschichte und eine
            Garantie. Vier Stationen sichern, dass Ihr Erwerb unversehrt, geprüft und
            vollkaskoversichert zu Ihnen gelangt.
          </motion.p>

          {/* The single permitted deco hairline — grows with scroll */}
          <div className="mt-w14-4 h-px w-full max-w-xs overflow-hidden" style={{ background: "rgba(191,148,48,0.12)" }}>
            <motion.div
              className="h-full"
              style={{
                width: lineWidth,
                background: `linear-gradient(90deg, ${GOLD} 0%, ${GOLD_LIGHT} 60%, transparent 100%)`,
              }}
            />
          </div>
        </div>

        {/* ── Four stages + connecting path ── */}
        <div className="flex flex-col md:flex-row items-start md:items-end gap-8 md:gap-0">
          {stages.map((stage, i) => (
            <div key={stage.id} className="flex md:contents w-full md:w-auto">
              {/* Stage card — takes equal width */}
              <div className="flex-1 min-w-0 w-full md:w-auto">
                <StageCard stage={stage} index={i} />
              </div>

              {/* Connector (between stages, not after last) */}
              {i < stages.length - 1 && (
                <AnimatedConnector index={i} />
              )}
            </div>
          ))}
        </div>

        {/* ── Bottom trust bar ── */}
        <motion.div
          initial={prefersReduced ? false : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-12%" }}
          transition={{ duration: DUR_SLOW, ease: EASE }}
          className="mt-w14-6 flex flex-col items-center justify-between gap-w14-3 pt-w14-4 md:flex-row"
          style={{ borderTop: "1px solid rgba(191,148,48,0.14)" }}
        >
          {/* Emblem */}
          <div className="flex items-center gap-w14-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/emblem.svg"
              alt=""
              className="h-10 w-10 opacity-80"
            />
            <div>
              <p
                className="font-display text-fluid-body"
                style={{ color: IVORY }}
              >
                warehouse14
              </p>
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.75)" }}>
                Ihr Goldhaus in Schorndorf
              </p>
            </div>
          </div>

          {/* Trust chips */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            {[
              { icon: "◈", label: "GwG-konform" },
              { icon: "◉", label: "Vollkaskoversicherung" },
              { icon: "◆", label: "Zertifizierte Echtheit" },
              { icon: "◈", label: "Diskreter Versand" },
            ].map((chip) => (
              <div
                key={chip.label}
                className="inline-flex items-center gap-1.5 rounded-button px-3 py-1.5 text-xs"
                style={{
                  border: "1px solid rgba(191,148,48,0.22)",
                  color: "rgba(255,255,255,0.78)",
                  background: "rgba(191,148,48,0.05)",
                }}
              >
                <span style={{ color: GOLD, fontSize: "9px" }}>{chip.icon}</span>
                {chip.label}
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
