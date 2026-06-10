"use client";

import React, { useRef, useState } from "react";
import { motion, useInView, useReducedMotion, AnimatePresence } from "framer-motion";

// ─── Easing + tokens ────────────────────────────────────────────────────────
// Mirror the globals.css motion primitives so timings stop being hand-rolled.
const EASE = [0.16, 1, 0.3, 1] as const; // --w14-ease-out (curator entrance)
const DUR_BASE = 0.42; // --w14-dur-base
const DUR_SLOW = 0.65; // --w14-dur-slow
const STAGGER = 0.07; // --w14-stagger

const GOLD = "#bf9430";
const GOLD_DEEP = "#8a6a1f";
const INK = "#1a1209";

// ─── Types ────────────────────────────────────────────────────────────────────
type Track = "kaufen" | "verkaufen";

// ─── Motion-graphics vignettes ────────────────────────────────────────────────
// Each line-draws in on reveal, THEN holds a slow, purposeful idle — a gentle
// float, a quiet weighing, a settling lid. No glitter: the motion is the
// choreography (draw + rise + settle), never decorative shine. prefers-reduced-
// motion users get the calm settled engraving (the `reduced` gate stills it).

// One shared, unhurried float for the idle life of each focal piece.
const FLOAT = { duration: 6, repeat: Infinity, ease: "easeInOut" } as const;

type VProps = { reduced: boolean };

function VignetteCoinCart({ reduced }: VProps) {
  return (
    <svg viewBox="0 0 120 80" className="w-full h-full" aria-hidden="true">
      {/* Cart body */}
      <motion.rect
        x="55" y="30" width="44" height="28" rx="4"
        fill="none" stroke={GOLD} strokeWidth="2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2, duration: DUR_BASE }}
      />
      {/* Cart handle */}
      <motion.path
        d="M55 35 L46 35 L40 20"
        fill="none" stroke={GOLD} strokeWidth="2" strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ delay: 0.3, duration: DUR_SLOW, ease: EASE }}
      />
      {/* Cart wheels — keep a barely-there roll */}
      <motion.circle cx="62" cy="62" r="4" fill={GOLD}
        initial={{ opacity: 0 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, x: [0, 1.5, 0] }}
        transition={reduced ? { delay: 0.5, duration: DUR_BASE } : { x: FLOAT, opacity: { delay: 0.5, duration: DUR_BASE } }}
      />
      <motion.circle cx="90" cy="62" r="4" fill={GOLD}
        initial={{ opacity: 0 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, x: [0, 1.5, 0] }}
        transition={reduced ? { delay: 0.55, duration: DUR_BASE } : { x: FLOAT, opacity: { delay: 0.55, duration: DUR_BASE } }}
      />
      {/* Coin floats into the cart mouth, then bobs gently forever */}
      <motion.g
        initial={{ opacity: 0, x: -14 }}
        animate={reduced ? { opacity: 1, x: 0 } : { opacity: 1, x: 0, y: [0, -2.5, 0] }}
        transition={reduced
          ? { delay: 0.45, duration: DUR_SLOW, ease: EASE }
          : { x: { delay: 0.45, duration: DUR_SLOW, ease: EASE }, opacity: { delay: 0.45, duration: DUR_SLOW }, y: FLOAT }}
      >
        <circle cx="34" cy="40" r="12" fill={GOLD} opacity="0.95" />
        <circle cx="34" cy="40" r="9" fill="none" stroke={GOLD_DEEP} strokeWidth="1.5" />
        <text x="34" y="44" textAnchor="middle" fontSize="8" fontWeight="bold" fill="#fff" fontFamily="serif">W</text>
      </motion.g>
      {/* Cart content dots (items already in cart) — fade in and hold. */}
      {[0, 1, 2].map((i) => (
        <motion.circle
          key={i}
          cx={66 + i * 12} cy={47} r={4}
          fill={GOLD_DEEP}
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.6 }}
          transition={{ delay: 0.7 + i * STAGGER, duration: DUR_BASE, ease: EASE }}
        />
      ))}
    </svg>
  );
}

function VignetteCardPulse({ reduced }: VProps) {
  return (
    <svg viewBox="0 0 120 80" className="w-full h-full" aria-hidden="true">
      {/* Card body — settles, then breathes with a feather-light tilt */}
      <motion.g
        initial={{ y: 12, opacity: 0 }}
        animate={reduced ? { y: 0, opacity: 1 } : { y: [0, -1.5, 0], opacity: 1, rotate: [-0.6, 0.6, -0.6] }}
        transition={reduced ? { duration: DUR_SLOW, ease: EASE } : { y: FLOAT, rotate: FLOAT, opacity: { duration: DUR_SLOW } }}
        style={{ transformOrigin: "60px 44px" }}
      >
        <rect x="25" y="22" width="70" height="44" rx="6" fill={INK} stroke={GOLD} strokeWidth="1.5" />
        {/* Card stripe */}
        <motion.rect x="25" y="34" width="70" height="10" fill={GOLD} opacity="0.18"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: 0.3, duration: DUR_BASE, ease: EASE }}
          style={{ transformOrigin: "25px 39px" }}
        />
        {/* Chip */}
        <rect x="38" y="44" width="16" height="12" rx="3" fill={GOLD} opacity="0.9" />
        {/* Card number dots */}
        {[0, 1, 2, 3].map((g) => (
          <g key={g}>
            {[0, 1, 2, 3].map((d) => (
              <circle key={d} cx={64 + g * 9 + d * 2} cy={51} r={1.2} fill={GOLD} opacity="0.55" />
            ))}
          </g>
        ))}
      </motion.g>
      {/* Lock badge — draws in and settles (no radiating pulse). */}
      <motion.g
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.85, duration: DUR_BASE, ease: EASE }}
      >
        <circle cx="95" cy="40" r="11" fill={INK} stroke={GOLD} strokeWidth="1.3" />
        <path d="M91 40 L91 36 Q91 32 95 32 Q99 32 99 36 L99 40" fill="none" stroke={GOLD} strokeWidth="1.4" strokeLinecap="round" />
        <rect x="90" y="40" width="10" height="8" rx="1.5" fill={GOLD} opacity="0.85" />
      </motion.g>
    </svg>
  );
}

function VignetteParcel({ reduced }: VProps) {
  return (
    <svg viewBox="0 0 120 80" className="w-full h-full" aria-hidden="true">
      {/* Box body — gently floats once sealed */}
      <motion.rect
        x="30" y="30" width="52" height="38" rx="3"
        fill={INK} stroke={GOLD} strokeWidth="1.8"
        initial={{ y: 14, opacity: 0 }}
        animate={reduced ? { y: 0, opacity: 1 } : { y: [0, -2, 0], opacity: 1 }}
        transition={reduced ? { duration: DUR_SLOW, ease: EASE } : { y: FLOAT, opacity: { duration: DUR_SLOW } }}
      />
      {/* Box lid */}
      <motion.rect
        x="30" y="22" width="52" height="12" rx="3"
        fill="#0e0b04" stroke={GOLD} strokeWidth="1.8"
        initial={{ y: -10, opacity: 0 }}
        animate={reduced ? { y: 0, opacity: 1 } : { y: [0, -2, 0], opacity: 1 }}
        transition={reduced ? { duration: DUR_SLOW, ease: EASE } : { y: FLOAT, opacity: { duration: DUR_SLOW } }}
      />
      {/* Ribbon horizontal */}
      <motion.rect x="30" y="44" width="52" height="4" fill={GOLD} opacity="0.35"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ delay: 0.45, duration: DUR_BASE, ease: EASE }}
        style={{ transformOrigin: "30px 46px" }}
      />
      {/* Ribbon vertical */}
      <motion.rect x="52" y="22" width="8" height="46" fill={GOLD} opacity="0.35"
        initial={{ scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={{ delay: 0.5, duration: DUR_BASE, ease: EASE }}
        style={{ transformOrigin: "56px 22px" }}
      />
      {/* Bow */}
      <motion.path d="M52 22 Q48 14 42 16 Q46 22 52 22" fill={GOLD} opacity="0.8"
        initial={{ opacity: 0 }} animate={{ opacity: 0.8 }} transition={{ delay: 0.65, duration: DUR_BASE, ease: EASE }}
      />
      <motion.path d="M60 22 Q64 14 70 16 Q66 22 60 22" fill={GOLD} opacity="0.8"
        initial={{ opacity: 0 }} animate={{ opacity: 0.8 }} transition={{ delay: 0.68, duration: DUR_BASE, ease: EASE }}
      />
      {/* Checkmark seal — draws in once and settles (no approving glow loop). */}
      <motion.g
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8, duration: DUR_BASE, ease: EASE }}
      >
        <circle cx="88" cy="22" r="11" fill={INK} stroke={GOLD} strokeWidth="1.5" />
        <motion.path
          d="M82 22 L86 27 L94 17"
          fill="none" stroke={GOLD} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ delay: 0.9, duration: DUR_SLOW, ease: EASE }}
        />
      </motion.g>
      {/* Insurance shield */}
      <motion.g
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1, duration: DUR_BASE, ease: EASE }}
      >
        <path d="M30 68 Q30 74 36 76 Q42 74 42 68 L42 64 L30 64 Z" fill={GOLD} opacity="0.25" stroke={GOLD} strokeWidth="1.2" />
        <path d="M33 71 L35 73 L39 68" fill="none" stroke={GOLD} strokeWidth="1.5" strokeLinecap="round" />
      </motion.g>
    </svg>
  );
}

function VignetteLoupe({ reduced }: VProps) {
  return (
    <svg viewBox="0 0 120 80" className="w-full h-full" aria-hidden="true">
      {/* Coin subject */}
      <motion.g
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: DUR_BASE }}
      >
        <circle cx="52" cy="40" r="22" fill={INK} stroke={GOLD_DEEP} strokeWidth="1.2" />
        <circle cx="52" cy="40" r="17" fill="none" stroke={GOLD} strokeWidth="0.8" opacity="0.5" />
        <text x="52" y="44" textAnchor="middle" fontSize="11" fontWeight="bold" fill={GOLD} fontFamily="serif" opacity="0.7">W14</text>
      </motion.g>
      {/* Loupe glides in, then keeps inspecting — drifting slowly across the coin */}
      <motion.g
        initial={{ opacity: 0, x: -16 }}
        animate={reduced ? { opacity: 1, x: 0 } : { opacity: 1, x: [-8, 8, -8], y: [0, -2, 0] }}
        transition={reduced
          ? { delay: 0.3, duration: DUR_SLOW, ease: EASE }
          : { x: { duration: 6, repeat: Infinity, ease: "easeInOut" }, y: { duration: 4, repeat: Infinity, ease: "easeInOut" }, opacity: { delay: 0.3, duration: DUR_SLOW } }}
      >
        <circle cx="52" cy="38" r="15" fill="none" stroke={GOLD} strokeWidth="2.2" />
        <circle cx="52" cy="38" r="15" fill="rgba(191,148,48,0.06)" />
        <line x1="63" y1="50" x2="76" y2="64" stroke={GOLD} strokeWidth="3" strokeLinecap="round" />
      </motion.g>
    </svg>
  );
}

function VignetteScale({ reduced }: VProps) {
  return (
    <svg viewBox="0 0 120 80" className="w-full h-full" aria-hidden="true">
      {/* Scale pole */}
      <motion.line x1="60" y1="15" x2="60" y2="68"
        stroke={GOLD} strokeWidth="2" strokeLinecap="round"
        initial={{ scaleY: 0 }} animate={{ scaleY: 1 }}
        transition={{ duration: DUR_BASE, ease: EASE }}
        style={{ transformOrigin: "60px 15px" }}
      />
      {/* Scale base */}
      <motion.rect x="48" y="68" width="24" height="5" rx="2.5"
        fill={GOLD} opacity="0.7"
        initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
        transition={{ delay: 0.3, duration: DUR_BASE, ease: EASE }}
        style={{ transformOrigin: "60px 70px" }}
      />
      {/* Balanced arm + pans — draws in, then weighs: tips and settles forever */}
      <motion.g
        initial={{ opacity: 0, y: 6 }}
        animate={reduced ? { opacity: 1, y: 0 } : { opacity: 1, y: 0, rotate: [0, 2.2, -1.4, 0.8, 0] }}
        transition={reduced
          ? { delay: 0.4, duration: DUR_SLOW, ease: EASE }
          : { opacity: { delay: 0.4, duration: DUR_SLOW }, y: { delay: 0.4, duration: DUR_SLOW }, rotate: { duration: 6.5, repeat: Infinity, ease: "easeInOut", delay: 0.9 } }}
        style={{ transformOrigin: "60px 30px" }}
      >
        <line x1="28" y1="30" x2="92" y2="30" stroke={GOLD} strokeWidth="2" strokeLinecap="round" />
        {/* Left pan + gold */}
        <line x1="28" y1="30" x2="28" y2="46" stroke={GOLD} strokeWidth="1.2" strokeLinecap="round" />
        <ellipse cx="28" cy="47" rx="12" ry="4" fill={INK} stroke={GOLD} strokeWidth="1.4" />
        <circle cx="25" cy="45" r="5" fill={GOLD} opacity="0.9" />
        <circle cx="31" cy="44" r="3.5" fill={GOLD_DEEP} opacity="0.8" />
        {/* Right pan + weight */}
        <line x1="92" y1="30" x2="92" y2="46" stroke={GOLD} strokeWidth="1.2" strokeLinecap="round" />
        <ellipse cx="92" cy="47" rx="12" ry="4" fill={INK} stroke={GOLD} strokeWidth="1.4" />
        <rect x="84" y="40" width="16" height="8" rx="2" fill={GOLD} opacity="0.6" />
        <text x="92" y="47" textAnchor="middle" fontSize="5" fill={INK} fontFamily="monospace">500g</text>
        <circle cx="60" cy="30" r="4" fill={GOLD} />
      </motion.g>
      {/* Value badge */}
      <motion.g
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.85, duration: DUR_BASE, ease: EASE }}
      >
        <rect x="44" y="4" width="32" height="12" rx="6" fill={GOLD} opacity="0.9" />
        <text x="60" y="13" textAnchor="middle" fontSize="6.5" fill="#0e0b04" fontFamily="monospace" fontWeight="bold">1.240 EUR</text>
      </motion.g>
    </svg>
  );
}

function VignetteBanknotes({ reduced }: VProps) {
  const bills = [0, 1, 2, 3];
  return (
    <svg viewBox="0 0 120 80" className="w-full h-full" aria-hidden="true">
      {/* Stack of bills fanning out — settles, then each leaf breathes on its phase */}
      {bills.map((i) => (
        <motion.g
          key={i}
          initial={{ y: 18, opacity: 0 }}
          animate={reduced
            ? { y: 0, opacity: 1, rotate: (i - 1.5) * 4 }
            : { y: [0, -2 - i, 0], opacity: 1, rotate: (i - 1.5) * 4 }}
          transition={reduced
            ? { delay: 0.2 + i * STAGGER, duration: DUR_SLOW, ease: EASE }
            : { y: { duration: 4.5 + i * 0.4, repeat: Infinity, ease: "easeInOut", delay: 0.2 + i * STAGGER }, opacity: { delay: 0.2 + i * STAGGER, duration: DUR_SLOW }, rotate: { delay: 0.2 + i * STAGGER, duration: DUR_SLOW } }}
          style={{ transformOrigin: "60px 60px" }}
        >
          <rect
            x="22" y="32"
            width="76" height="40"
            rx="4"
            fill={INK}
            stroke={GOLD}
            strokeWidth="1.4"
            opacity={0.6 + i * 0.1}
          />
          <rect x="28" y="38" width="64" height="10" rx="2" fill={GOLD} opacity="0.12" />
          <circle cx="60" cy="52" r="8" fill="none" stroke={GOLD} strokeWidth="1" opacity="0.4" />
          <text x="60" y="55" textAnchor="middle" fontSize="6" fill={GOLD} fontFamily="monospace" opacity="0.7">EUR</text>
        </motion.g>
      ))}
      {/* Payout total — settles, then floats with the bills (no sheen drift). */}
      <motion.g
        initial={{ opacity: 0, y: 6 }}
        animate={reduced ? { opacity: 1, y: 0 } : { opacity: 1, y: [0, -1.5, 0] }}
        transition={reduced ? { delay: 0.75, duration: DUR_BASE, ease: EASE } : { y: FLOAT, opacity: { delay: 0.75, duration: DUR_BASE } }}
      >
        <rect x="36" y="8" width="48" height="18" rx="9" fill="#0e0b04" stroke={GOLD} strokeWidth="1.3" />
        <text
          x="60" y="21"
          textAnchor="middle"
          fontSize="8"
          fill={GOLD}
          fontFamily="monospace"
          fontWeight="bold"
          letterSpacing="1"
        >
          2.480 EUR
        </text>
      </motion.g>
    </svg>
  );
}

// ─── Step definitions ─────────────────────────────────────────────────────────

const KAUFEN_STEPS = [
  {
    number: "01",
    title: "Aussuchen",
    body: "Stöbern Sie durch unsere kuratierte Auswahl an Edelmetallen, Raritäten und Antiquitäten.",
    Vignette: VignetteCoinCart,
  },
  {
    number: "02",
    title: "Sicher bezahlen",
    body: "Sichere Zahlung per Überweisung, Kreditkarte oder Barzahlung im Ladengeschäft in Schorndorf.",
    Vignette: VignetteCardPulse,
  },
  {
    number: "03",
    title: "Versichert erhalten",
    body: "Ihr Kaufstück wird professionell verpackt, versichert verschickt oder zur Abholung bereitgelegt.",
    Vignette: VignetteParcel,
  },
];

const VERKAUFEN_STEPS = [
  {
    number: "01",
    title: "Bewerten lassen",
    body: "Unsere Experten prüfen Ihr Gold, Ihre Münzen oder Antiquitäten kostenlos und diskret.",
    Vignette: VignetteLoupe,
  },
  {
    number: "02",
    title: "Angebot prüfen",
    body: "Sie erhalten ein faires, marktkonformes Angebot auf Basis aktueller Goldkurse.",
    Vignette: VignetteScale,
  },
  {
    number: "03",
    title: "Sofort-Auszahlung",
    body: "Nach Annahme zahlen wir sofort aus. Bar, Überweisung oder Depot, ganz nach Wunsch.",
    Vignette: VignetteBanknotes,
  },
];

// ─── StepCard ─────────────────────────────────────────────────────────────────

function StepCard({
  step,
  index,
  inView,
  reduced,
}: {
  step: (typeof KAUFEN_STEPS)[0];
  index: number;
  inView: boolean;
  reduced: boolean;
}) {
  const { Vignette } = step;
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
      transition={{ delay: index * STAGGER, duration: DUR_SLOW, ease: EASE }}
      whileHover={reduced ? undefined : { y: -6 }}
      className="group/card relative flex flex-col overflow-hidden rounded-card border border-rule bg-card shadow-card transition-shadow duration-base ease-hover hover:shadow-lift"
    >
      {/* Vignette area */}
      <div className="bg-ink-deep relative flex aspect-[3/2] w-full items-center justify-center overflow-hidden">
        {/* A single, still gilt wash for depth — no breathing, no scale loop. */}
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden="true"
          style={{ background: "radial-gradient(circle at 50% 55%, rgba(191,148,48,0.12), transparent 64%)" }}
        />
        {/* Subtle grain overlay */}
        <div className="grain pointer-events-none absolute inset-0 z-10 opacity-30" />
        {/* Gold hairline at the foot of the vignette — grows on hover only. */}
        <div className="bg-gold-gradient absolute inset-x-8 bottom-0 h-px opacity-30 transition-all duration-base ease-hover group-hover/card:inset-x-4 group-hover/card:opacity-60" />
        <div className="relative z-[15] h-full w-full p-4 sm:p-5">
          <Vignette reduced={reduced} />
        </div>
      </div>
      {/* Text area */}
      <div className="flex flex-col gap-w14-1 p-card">
        <div className="flex items-baseline gap-w14-1">
          <span className="eyebrow tnum text-gold/60">{step.number}</span>
          <h3 className="font-display text-fluid-h3 text-ink">{step.title}</h3>
        </div>
        <p className="measure text-fluid-body text-ink-faded">{step.body}</p>
      </div>
    </motion.div>
  );
}

// ─── Tab toggle ───────────────────────────────────────────────────────────────

const TRACKS = ["kaufen", "verkaufen"] as const;

function TrackToggle({
  active,
  onChange,
  reduced,
}: {
  active: Track;
  onChange: (t: Track) => void;
  reduced: boolean;
}) {
  const tabRefs = useRef<Record<Track, HTMLButtonElement | null>>({
    kaufen: null,
    verkaufen: null,
  });

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = TRACKS.indexOf(active);
    const next =
      e.key === "ArrowRight"
        ? TRACKS[(i + 1) % TRACKS.length]
        : TRACKS[(i - 1 + TRACKS.length) % TRACKS.length];
    onChange(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <div role="tablist" aria-label="Transaktionsart" className="relative inline-flex items-center gap-1 rounded-button border border-rule bg-card p-1 shadow-card">
      {TRACKS.map((t) => {
        const isActive = active === t;
        return (
          <button
            key={t}
            ref={(el) => {
              tabRefs.current[t] = el;
            }}
            type="button"
            role="tab"
            id={`track-tab-${t}`}
            aria-selected={isActive}
            aria-controls={`track-panel-${t}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(t)}
            onKeyDown={onKeyDown}
            className="relative min-h-[44px] rounded-button px-6 py-2.5 text-fluid-body font-medium ring-gold-soft transition-colors duration-base focus:outline-none focus-visible:ring-2"
            style={{ color: isActive ? "#0e0b04" : "var(--w14-ink-faded)" }}
          >
            {isActive && (
              <motion.span
                // Under reduced motion: drop the shared-layout slide entirely
                // (no layoutId) so the pill snaps to the active tab instead of
                // animating across the track.
                {...(reduced ? {} : { layoutId: "track-pill" })}
                className="bg-gold-gradient absolute inset-0 rounded-button"
                transition={reduced ? { duration: 0 } : { duration: DUR_BASE, ease: EASE }}
              />
            )}
            <span className="relative z-10">
              {t === "kaufen" ? "Kaufen" : "Verkaufen"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Decorative connector line between steps ─────────────────────────────────

function StepConnector({ inView }: { inView: boolean }) {
  return (
    <div className="relative hidden items-center justify-center px-2 md:flex">
      {/* The rule simply draws itself left→right as the step commits. No spark. */}
      <motion.div
        className="bg-gold-gradient h-px flex-1"
        initial={{ scaleX: 0, opacity: 0 }}
        animate={inView ? { scaleX: 1, opacity: 0.4 } : { scaleX: 0, opacity: 0 }}
        transition={{ delay: 0.5, duration: DUR_SLOW, ease: EASE }}
        style={{ transformOrigin: "0% 50%" }}
      />
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function MotionExplainer() {
  const [activeTrack, setActiveTrack] = useState<Track>("kaufen");
  const reduced = useReducedMotion() ?? false;
  const sectionRef = useRef<HTMLDivElement>(null);
  const inView = useInView(sectionRef, { once: true, margin: "-12%" });

  const steps = activeTrack === "kaufen" ? KAUFEN_STEPS : VERKAUFEN_STEPS;

  return (
    <section
      ref={sectionRef}
      className="bg-surface relative w-full overflow-hidden py-section"
      aria-label="Einfach kaufen und verkaufen"
    >
      {/* Background marble texture — subtle, luxury */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "url('/textures/marble_01.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          opacity: 0.03,
          mixBlendMode: "luminosity",
        }}
      />

      <div className="mx-auto flex max-w-edge flex-col items-center gap-w14-5 px-6 md:px-10">

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: DUR_SLOW, ease: EASE }}
          className="flex max-w-xl flex-col items-center gap-w14-3 text-center"
        >
          {/* Emblem — floats gently. The pulsing gilt halo is gone. */}
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <motion.img
              src="/emblem.svg"
              alt=""
              aria-hidden="true"
              className="relative h-10 w-10 opacity-60"
              animate={reduced ? undefined : { y: [0, -5, 0] }}
              transition={reduced ? undefined : FLOAT}
            />
          </div>

          {/* Overline */}
          <span className="eyebrow text-gold/70">Ihr Vertrauenspartner</span>

          <h2 className="font-display text-fluid-h2 text-ink">
            So einfach, kaufen und verkaufen
          </h2>

          <p className="measure text-fluid-body text-ink-faded">
            Transparente Prozesse, faire Preise, persönlicher Service. Bei warehouse14 ist jeder Schritt klar.
          </p>

          {/* Gold hairline — simply draws itself in once. No travelling sheen. */}
          <motion.div
            className="h-px w-16 opacity-70"
            style={{ transformOrigin: "left center", background: "linear-gradient(90deg, transparent, var(--w14-gold), transparent)" }}
            initial={{ scaleX: 0 }}
            animate={inView ? { scaleX: 1 } : {}}
            transition={{ delay: 0.3, duration: DUR_SLOW, ease: EASE }}
          />
        </motion.div>

        {/* Track toggle */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.2, duration: DUR_SLOW, ease: EASE }}
        >
          <TrackToggle active={activeTrack} onChange={setActiveTrack} reduced={reduced} />
        </motion.div>

        {/* Steps panel */}
        <div
          id={`track-panel-${activeTrack}`}
          role="tabpanel"
          aria-labelledby={`track-tab-${activeTrack}`}
          tabIndex={0}
          className="w-full focus:outline-none"
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTrack}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: DUR_BASE, ease: EASE }}
              className="grid grid-cols-1 items-start gap-w14-2 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:gap-0"
            >
              {steps.map((step, i) => (
                <React.Fragment key={step.number}>
                  <StepCard step={step} index={i} inView={inView} reduced={reduced} />
                  {i < steps.length - 1 && <StepConnector inView={inView} />}
                </React.Fragment>
              ))}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* CTA strip */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.4, duration: DUR_SLOW, ease: EASE }}
          className="flex w-full max-w-sm flex-col items-stretch gap-w14-2 sm:w-auto sm:max-w-none sm:flex-row sm:items-center"
        >
          <a
            href="/termin"
            className="bg-gold-gradient inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-button px-8 py-3.5 text-fluid-body font-semibold text-[#0e0b04] shadow-card ring-gold-soft transition-shadow duration-base ease-hover hover:shadow-gold focus:outline-none focus-visible:ring-2 sm:w-auto"
          >
            Jetzt Termin vereinbaren
          </a>
          <a
            href="#sortiment"
            className="text-ink-aged inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-button border border-rule px-8 py-3.5 text-fluid-body font-medium ring-gold-soft transition-colors duration-base ease-hover hover:border-gold hover:text-gold focus:outline-none focus-visible:ring-2 sm:w-auto"
          >
            Sortiment entdecken
          </a>
        </motion.div>

      </div>
    </section>
  );
}
