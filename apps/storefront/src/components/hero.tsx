"use client";

import { useRef } from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Loupe } from "@/components/loupe";

/* The curator entrance ease — long, premium settle, no spring/bounce.
 * Mirrors --w14-ease-out so the hero speaks the same motion language. */
const ease = [0.16, 1, 0.3, 1] as const;

/* ── Entrance choreography ──────────────────────────────────────────────────
 * Eyebrow → headline words (masked rise, cinematic stagger) → hairline →
 * lead → actions. Everything cascades once and then holds. No infinite
 * shine, no shimmer — the drama lives in the reveal, not in decoration. */
const stage = {
  hidden: {},
  show: { transition: { staggerChildren: 0.1, delayChildren: 0.15 } },
};
const rise = {
  hidden: { opacity: 0, y: 22 },
  show: { opacity: 1, y: 0, transition: { duration: 0.9, ease } },
};
const wordGroup = {
  hidden: {},
  show: { transition: { staggerChildren: 0.11, delayChildren: 0.28 } },
};
/* Each word rides up from behind a clip mask — the maison "type settles in" feel. */
const wordRise = {
  hidden: { y: "115%", opacity: 0 },
  show: {
    y: "0%",
    opacity: 1,
    transition: { duration: 1.05, ease },
  },
};

const headline = ["Werte", "mit", "Geschichte."];

export function Hero() {
  const reduce = useReducedMotion();
  const initial = reduce ? false : "hidden";
  const sectionRef = useRef<HTMLElement>(null);

  /* ONE tasteful parallax: as the page scrolls past, the heritage object drifts
   * a touch slower than the copy — quiet depth, no layout thrash (transform/
   * opacity only). The copy itself eases up and fades as you leave the hero. */
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });
  const copyYRaw = useTransform(scrollYProgress, [0, 1], [0, -48]);
  const objYRaw = useTransform(scrollYProgress, [0, 1], [0, 96]);
  const fadeRaw = useTransform(scrollYProgress, [0, 0.85], [1, 0]);

  /* Spring-smooth the parallax so it tracks Lenis' inertia instead of jittering. */
  const spring = { stiffness: 120, damping: 30, mass: 0.4 };
  const copyY = useSpring(copyYRaw, spring);
  const objY = useSpring(objYRaw, spring);
  const fade = useSpring(fadeRaw, spring);

  /* Reduced motion: freeze every scroll-bound transform at rest. */
  const sCopyY = reduce ? 0 : copyY;
  const sObjY = reduce ? 0 : objY;
  const sFade = reduce ? 1 : fade;

  return (
    <section
      ref={sectionRef}
      className="bg-ink-deep grain relative flex min-h-[92svh] items-center overflow-hidden text-white"
    >
      {/* ── STILL GOLD LIGHT ─────────────────────────────────────────────────
       * Two soft, STATIC gold/olive pools establish depth and the heritage
       * mood. No drift, no breathing, no sheen sweep, no dust motes — the
       * gradient is part of the set, not an effect performing for attention.
       * It rides the single hero parallax and fades as you scroll away. */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0"
        style={{ opacity: sFade }}
      >
        <div
          className="absolute -right-[12%] -top-[26%] h-[70vh] w-[70vh] rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(221,196,134,0.22), rgba(191,148,48,0.08) 44%, transparent 68%)",
            filter: "blur(10px)",
          }}
        />
        <div
          className="absolute -bottom-[24%] left-[-10%] h-[56vh] w-[56vh] rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(70,88,63,0.26), transparent 64%)",
            filter: "blur(12px)",
          }}
        />
      </motion.div>

      <motion.div
        className="relative z-10 mx-auto grid w-full max-w-edge items-center gap-w14-4 px-5 py-w14-6 md:gap-w14-5 md:px-6 md:py-section md:grid-cols-[1.1fr_0.9fr]"
        style={{ y: sCopyY }}
      >
        <motion.div variants={stage} initial={initial} animate="show">
          {/* Eyebrow with a live gold cue → "prices are alive". */}
          <motion.p
            variants={rise}
            className="eyebrow mb-w14-3 flex items-center gap-2 text-gold/90"
          >
            <LiveDot reduce={!!reduce} />
            Edelmetalle &amp; Raritäten · Schorndorf
          </motion.p>

          <h1 className="font-display text-fluid-hero font-medium tracking-tight text-[#f4eede]">
            <motion.span
              variants={wordGroup}
              initial={initial}
              animate="show"
              className="block"
            >
              {headline.map((w, i) => {
                const isLast = i === headline.length - 1;
                return (
                  /* clip-mask per word so the rise reads as type settling */
                  <span
                    key={w}
                    className="relative inline-block overflow-hidden align-bottom"
                    /* real right-margin between words — a trailing " " inside an
                       overflow-hidden inline-block gets clipped, which collapsed
                       "Werte mit" into "Wertemit". */
                    style={{ paddingBottom: "0.08em", marginRight: isLast ? undefined : "0.26em" }}
                  >
                    <motion.span
                      variants={wordRise}
                      className="inline-block"
                    >
                      {/* The accent word is simply rendered in the gold gradient —
                       * rich material, no gleam raking across it. */}
                      {isLast ? (
                        <span className="text-gold-gradient">{w}</span>
                      ) : (
                        w
                      )}
                      {!isLast ? " " : null}
                    </motion.span>
                  </span>
                );
              })}
            </motion.span>
          </h1>

          {/* The gold hairline draws once, left→right, and then simply rests. */}
          <motion.span
            aria-hidden="true"
            className="bg-gold-gradient mt-w14-3 block h-px w-28 origin-left"
            initial={reduce ? false : { scaleX: 0, opacity: 0 }}
            animate={{ scaleX: 1, opacity: 1 }}
            transition={{ duration: 0.85, ease, delay: 0.9 }}
          />

          <motion.p
            variants={rise}
            className="measure mt-w14-4 text-fluid-lead text-white/80"
          >
            Münzen, Schmuck, Uhren, Briefmarken, Antiquitäten und Anlagegold —
            geprüft, fair und versichert.
          </motion.p>

          {/* CTAs: stacked + full-width on phones (big, comfortable tap targets),
           * inline from sm up. No shine-wipe — a clean lift + arrow nudge only. */}
          <motion.div
            variants={rise}
            className="mt-w14-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center"
          >
            <a
              href="#kollektion"
              className="group inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-button bg-gold px-6 text-[1rem] font-medium text-[#2b210a] transition-[transform,background-color] duration-base ease-hover hover:-translate-y-0.5 hover:bg-gold-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-[#17130c] sm:w-auto sm:justify-start"
            >
              <span>Kollektion entdecken</span>
              <ArrowRight
                className="h-[18px] w-[18px] transition-transform duration-base ease-hover group-hover:translate-x-1"
                aria-hidden="true"
              />
            </a>
            <a
              href="#ankauf"
              className="inline-flex min-h-[52px] w-full items-center justify-center rounded-button border border-white/20 px-6 text-[1rem] font-medium text-white/85 transition-colors duration-base ease-hover hover:border-white/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-[#17130c] sm:w-auto"
            >
              Ankauf &amp; Schätzung
            </a>
          </motion.div>
        </motion.div>

        {/* ── HERITAGE OBJECT ────────────────────────────────────────────────
         * A piece presented on velvet under the house loupe. The loupe holds
         * still; the whole tableau rides the single slow hero parallax. No
         * float-bob, no glow pulse, no specular rake — a still, lit object. */}
        <motion.div
          aria-hidden="true"
          className="relative mx-auto hidden h-[380px] w-full max-w-[460px] place-items-center md:grid"
          style={{ y: sObjY }}
          initial={reduce ? false : { opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1, ease, delay: 0.45 }}
        >
          {/* a still velvet pool of light beneath the object */}
          <div
            className="absolute h-[320px] w-[320px] rounded-full"
            style={{
              background:
                "radial-gradient(circle, rgba(231,222,205,0.12), transparent 66%)",
            }}
          />

          {/* the coin under glass — minted, still, simply lit */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <GoldCoin />
          </div>

          {/* the loupe, resting over the coin */}
          <div className="relative">
            <Loupe
              size={196}
              className="drop-shadow-[0_30px_60px_-30px_rgba(0,0,0,0.85)]"
            />
          </div>
        </motion.div>
      </motion.div>

      {/* a single quiet rule where the espresso meets the cream surface */}
      <div className="absolute inset-x-0 bottom-0 z-10 h-px bg-gradient-to-r from-transparent via-gold/30 to-transparent" />

      {/* a whisper-soft scroll cue that fades as you leave the hero — a quiet
       * descent, not a pulsing beacon */}
      {!reduce && (
        <motion.div
          aria-hidden="true"
          style={{ opacity: sFade }}
          className="pointer-events-none absolute inset-x-0 bottom-5 z-10 flex justify-center"
        >
          <motion.span
            className="block h-9 w-px bg-gradient-to-b from-gold/0 via-gold/55 to-gold/0"
            animate={{ y: [0, 8, 0], opacity: [0.45, 0.8, 0.45] }}
            transition={{ duration: 3.2, ease: "easeInOut", repeat: Infinity }}
          />
        </motion.div>
      )}
    </section>
  );
}

/* A live gold dot — signals the kurse/prices are alive. A single calm ping,
 * not a strobing halo. */
function LiveDot({ reduce }: { reduce: boolean }) {
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0 items-center justify-center">
      {!reduce && (
        <motion.span
          className="absolute inset-0 rounded-full bg-gold"
          animate={{ scale: [1, 2.4], opacity: [0.4, 0] }}
          transition={{ duration: 2.2, ease: "easeOut", repeat: Infinity }}
        />
      )}
      <span className="relative h-1.5 w-1.5 rounded-full bg-gold" />
    </span>
  );
}

/* A minted gold coin presented beneath the loupe — pure SVG, fully still.
 * No rotation, no moving highlight; it reads as a real object at rest. */
function GoldCoin() {
  return (
    <svg
      width={148}
      height={148}
      viewBox="0 0 148 148"
      aria-hidden="true"
      className="drop-shadow-[0_18px_40px_-18px_rgba(0,0,0,0.7)]"
    >
      <defs>
        <radialGradient id="coin-face" cx="40%" cy="34%" r="78%">
          <stop offset="0%" stopColor="#f6e6ad" />
          <stop offset="46%" stopColor="#d6b35a" />
          <stop offset="82%" stopColor="#a87e26" />
          <stop offset="100%" stopColor="#7c5d1c" />
        </radialGradient>
        <linearGradient id="coin-edge" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#e7d49b" />
          <stop offset="50%" stopColor="#9a7726" />
          <stop offset="100%" stopColor="#e7d49b" />
        </linearGradient>
      </defs>
      <circle cx="74" cy="74" r="68" fill="url(#coin-edge)" />
      <circle cx="74" cy="74" r="62" fill="url(#coin-face)" />
      <circle
        cx="74"
        cy="74"
        r="54"
        fill="none"
        stroke="rgba(124,93,28,0.55)"
        strokeWidth="1.5"
      />
      {/* a simple minted glyph — the house mark, abstract */}
      <text
        x="74"
        y="92"
        textAnchor="middle"
        fontFamily="Georgia, serif"
        fontSize="52"
        fontWeight="600"
        fill="rgba(124,93,28,0.6)"
      >
        14
      </text>
    </svg>
  );
}
