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
 * lead → actions. Everything cascades once, then holds, except the living
 * light layers which breathe forever. */
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

  /* Scroll-parallax: the hero layers drift apart as the page scrolls past,
   * giving depth without any layout thrash (transform/opacity only). */
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });
  const copyYRaw = useTransform(scrollYProgress, [0, 1], [0, -64]);
  const objYRaw = useTransform(scrollYProgress, [0, 1], [0, 120]);
  const auroraYRaw = useTransform(scrollYProgress, [0, 1], [0, -90]);
  const fadeRaw = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  /* Spring-smooth the parallax so it tracks Lenis' inertia instead of jittering. */
  const spring = { stiffness: 120, damping: 30, mass: 0.4 };
  const copyY = useSpring(copyYRaw, spring);
  const objY = useSpring(objYRaw, spring);
  const auroraY = useSpring(auroraYRaw, spring);
  const fade = useSpring(fadeRaw, spring);

  /* Reduced motion: freeze every scroll-bound transform at rest. */
  const sCopyY = reduce ? 0 : copyY;
  const sObjY = reduce ? 0 : objY;
  const sAuroraY = reduce ? 0 : auroraY;
  const sFade = reduce ? 1 : fade;

  return (
    <section
      ref={sectionRef}
      className="bg-ink-deep grain relative overflow-hidden text-white"
    >
      {/* ── LIVING GOLD LIGHT ────────────────────────────────────────────────
       * Two slow aurora plumes + a drifting sheen sweep + faint gold motes.
       * All pure transform/opacity, inview by virtue of being in the first
       * viewport, parallaxed on scroll. This is what makes the poster breathe. */}
      {!reduce && (
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0"
          style={{ y: sAuroraY, opacity: sFade }}
        >
          {/* warm gold aurora — slow scale + drift breath */}
          <motion.div
            className="absolute -right-[10%] -top-[28%] h-[70vh] w-[70vh] rounded-full"
            style={{
              background:
                "radial-gradient(circle, rgba(221,196,134,0.30), rgba(191,148,48,0.10) 42%, transparent 68%)",
              filter: "blur(8px)",
            }}
            animate={{
              x: [0, 28, -14, 0],
              y: [0, -22, 18, 0],
              scale: [1, 1.12, 1.04, 1],
              opacity: [0.55, 0.85, 0.6, 0.55],
            }}
            transition={{ duration: 16, ease: "easeInOut", repeat: Infinity }}
          />
          {/* cool olive counter-plume — depth + a heritage green undertone */}
          <motion.div
            className="absolute -bottom-[26%] left-[-8%] h-[58vh] w-[58vh] rounded-full"
            style={{
              background:
                "radial-gradient(circle, rgba(70,88,63,0.34), transparent 64%)",
              filter: "blur(10px)",
            }}
            animate={{
              x: [0, -22, 16, 0],
              y: [0, 16, -14, 0],
              scale: [1, 1.08, 1.02, 1],
            }}
            transition={{ duration: 22, ease: "easeInOut", repeat: Infinity }}
          />
          {/* diagonal specular sheen that travels across the whole hero, slowly */}
          <motion.div
            className="absolute inset-y-0 -left-1/3 w-1/2 -skew-x-12"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(255,247,224,0.12), transparent)",
            }}
            animate={{ x: ["-20%", "320%"] }}
            transition={{
              duration: 9,
              ease: "easeInOut",
              repeat: Infinity,
              repeatDelay: 5,
            }}
          />
          {/* a few gold motes drifting up like dust in a vault light-shaft */}
          {MOTES.map((m, i) => (
            <motion.span
              key={i}
              className="absolute rounded-full"
              style={{
                left: m.left,
                top: m.top,
                width: m.size,
                height: m.size,
                background: "rgba(231,212,155,0.9)",
                boxShadow: "0 0 8px 1px rgba(221,196,134,0.6)",
              }}
              animate={{
                y: [0, -38, 0],
                x: [0, m.drift, 0],
                opacity: [0, 0.9, 0],
              }}
              transition={{
                duration: m.dur,
                ease: "easeInOut",
                repeat: Infinity,
                delay: m.delay,
              }}
            />
          ))}
        </motion.div>
      )}

      <motion.div
        className="relative z-10 mx-auto grid w-full max-w-edge items-center gap-w14-5 px-5 py-section md:grid-cols-[1.1fr_0.9fr]"
        style={{ y: sCopyY }}
      >
        <motion.div variants={stage} initial={initial} animate="show">
          {/* Eyebrow with a live, pulsing gold cue → "prices are alive". */}
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
                    style={{ paddingBottom: "0.08em" }}
                  >
                    <motion.span
                      variants={wordRise}
                      className={`inline-block ${isLast ? "relative" : ""}`}
                    >
                      {isLast ? (
                        <span className="relative inline-block">
                          <span className="text-gold-gradient">{w}</span>
                          {/* SIGNATURE WOW: a specular gleam travels across the
                           * accent word forever — like light raking gold leaf. */}
                          {!reduce && (
                            <motion.span
                              aria-hidden="true"
                              className="pointer-events-none absolute inset-0"
                              style={{
                                background:
                                  "linear-gradient(105deg, transparent 38%, rgba(255,252,240,0.85) 50%, transparent 62%)",
                                WebkitBackgroundClip: "text",
                                backgroundClip: "text",
                                WebkitTextFillColor: "transparent",
                                color: "transparent",
                                backgroundSize: "260% 100%",
                              }}
                              animate={{ backgroundPositionX: ["140%", "-40%"] }}
                              transition={{
                                duration: 4.2,
                                ease: "easeInOut",
                                repeat: Infinity,
                                repeatDelay: 3.4,
                              }}
                            >
                              {w}
                            </motion.span>
                          )}
                        </span>
                      ) : (
                        w
                      )}
                      {!isLast ? " " : null}
                    </motion.span>
                  </span>
                );
              })}
            </motion.span>
          </h1>

          {/* The gold hairline drawn left→right, then a soft shimmer settles. */}
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

          <motion.div
            variants={rise}
            className="mt-w14-4 flex flex-wrap items-center gap-w14-3"
          >
            <a
              href="#kollektion"
              className="group relative inline-flex items-center gap-2 overflow-hidden rounded-button bg-gold px-6 py-3.5 text-[0.98rem] font-medium text-[#2b210a] transition-[transform,background-color] duration-base ease-hover hover:-translate-y-0.5 hover:bg-gold-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-[#17130c]"
            >
              {/* an inviting sheen that keeps wiping across the primary CTA */}
              {!reduce && (
                <motion.span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 -skew-x-12"
                  style={{
                    background:
                      "linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)",
                  }}
                  animate={{ x: ["-130%", "230%"] }}
                  transition={{
                    duration: 2.6,
                    ease: "easeInOut",
                    repeat: Infinity,
                    repeatDelay: 3.2,
                  }}
                />
              )}
              <span className="relative">Kollektion entdecken</span>
              <ArrowRight
                className="relative h-[18px] w-[18px] transition-transform duration-base ease-hover group-hover:translate-x-1"
                aria-hidden="true"
              />
            </a>
            <a
              href="#ankauf"
              className="inline-flex items-center rounded-button border border-white/20 px-6 py-3.5 text-[0.98rem] font-medium text-white/85 transition-colors duration-base ease-hover hover:border-white/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-[#17130c]"
            >
              Ankauf &amp; Schätzung
            </a>
          </motion.div>
        </motion.div>

        {/* ── HERITAGE OBJECT ────────────────────────────────────────────────
         * A piece presented on velvet under the house loupe. The loupe drifts
         * with a slow float + faint sway; beneath it a magnified gold coin
         * gleams and turns — the "examine a real treasure" gesture. */}
        <motion.div
          aria-hidden="true"
          className="relative mx-auto hidden h-[380px] w-full max-w-[460px] place-items-center md:grid"
          style={{ y: sObjY }}
          initial={reduce ? false : { opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1, ease, delay: 0.45 }}
        >
          {/* velvet pool of light */}
          <motion.div
            className="absolute h-[320px] w-[320px] rounded-full"
            style={{
              background:
                "radial-gradient(circle, rgba(231,222,205,0.14), transparent 66%)",
            }}
            animate={reduce ? undefined : { scale: [1, 1.06, 1], opacity: [0.85, 1, 0.85] }}
            transition={{ duration: 7, ease: "easeInOut", repeat: Infinity }}
          />

          {/* the coin under glass — turns slowly, catches a moving highlight */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <GoldCoin reduce={!!reduce} />
          </div>

          {/* the loupe, floating with a refined sway over the coin */}
          <motion.div
            className="relative"
            animate={
              reduce
                ? undefined
                : { y: [0, -14, 0], rotate: [-2.5, 2.5, -2.5] }
            }
            transition={{ duration: 9, ease: "easeInOut", repeat: Infinity }}
          >
            <Loupe
              size={196}
              className="drop-shadow-[0_30px_60px_-30px_rgba(0,0,0,0.85)]"
            />
          </motion.div>
        </motion.div>
      </motion.div>

      {/* a single quiet rule where the espresso meets the cream surface */}
      <div className="absolute inset-x-0 bottom-0 z-10 h-px bg-gradient-to-r from-transparent via-gold/30 to-transparent" />

      {/* a whisper-soft scroll cue that fades as you leave the hero */}
      {!reduce && (
        <motion.div
          aria-hidden="true"
          style={{ opacity: sFade }}
          className="pointer-events-none absolute inset-x-0 bottom-5 z-10 flex justify-center"
        >
          <motion.span
            className="block h-9 w-px bg-gradient-to-b from-gold/0 via-gold/70 to-gold/0"
            animate={{ scaleY: [0.4, 1, 0.4], opacity: [0.3, 0.9, 0.3] }}
            transition={{ duration: 2.4, ease: "easeInOut", repeat: Infinity }}
            style={{ originY: 0 }}
          />
        </motion.div>
      )}
    </section>
  );
}

/* A live, breathing gold dot — signals that the kurse/prices are alive. */
function LiveDot({ reduce }: { reduce: boolean }) {
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0 items-center justify-center">
      {!reduce && (
        <motion.span
          className="absolute inset-0 rounded-full bg-gold"
          animate={{ scale: [1, 2.6], opacity: [0.5, 0] }}
          transition={{ duration: 1.8, ease: "easeOut", repeat: Infinity }}
        />
      )}
      <span className="relative h-1.5 w-1.5 rounded-full bg-gold" />
    </span>
  );
}

/* A minted gold coin that slowly rotates in place beneath the loupe and is
 * raked by a moving highlight — pure SVG, transform/opacity only. */
function GoldCoin({ reduce }: { reduce: boolean }) {
  return (
    <motion.svg
      width={148}
      height={148}
      viewBox="0 0 148 148"
      aria-hidden="true"
      className="drop-shadow-[0_18px_40px_-18px_rgba(0,0,0,0.7)]"
      animate={reduce ? undefined : { rotate: [0, 360] }}
      transition={{ duration: 36, ease: "linear", repeat: Infinity }}
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
      {/* moving specular highlight raking the face */}
      {!reduce && (
        <motion.ellipse
          cx="74"
          cy="74"
          rx="22"
          ry="58"
          fill="rgba(255,251,236,0.5)"
          animate={{ cx: [26, 122, 26], opacity: [0, 0.55, 0] }}
          transition={{ duration: 5, ease: "easeInOut", repeat: Infinity }}
        />
      )}
    </motion.svg>
  );
}

/* Deterministic mote field — no Math.random at module/render time so SSR and
 * client markup match (no hydration mismatch). */
const MOTES = [
  { left: "16%", top: "62%", size: 3, drift: 10, dur: 11, delay: 0 },
  { left: "32%", top: "40%", size: 2, drift: -8, dur: 13, delay: 1.6 },
  { left: "58%", top: "70%", size: 3, drift: 12, dur: 10, delay: 0.8 },
  { left: "70%", top: "30%", size: 2, drift: -6, dur: 14, delay: 2.4 },
  { left: "84%", top: "56%", size: 4, drift: 8, dur: 12, delay: 3.2 },
  { left: "46%", top: "20%", size: 2, drift: -10, dur: 15, delay: 1.1 },
] as const;
