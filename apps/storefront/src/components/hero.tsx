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
import { Kicker } from "@/components/brand/kicker";
import { HeroTableau } from "@/components/hero-tableau";

/* The curator entrance ease — long, premium settle, no spring/bounce.
 * Mirrors --w14-ease-out so the hero speaks the same motion language. */
const ease = [0.16, 1, 0.3, 1] as const;

/* ── Entrance choreography ──────────────────────────────────────────────────
 * Eyebrow → headline words (masked rise, cinematic stagger) → hairline →
 * lead → actions. Everything cascades once and then holds. The drama lives
 * in the reveal, not in decoration. */
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

  /* ONE tasteful parallax: the copy eases up and fades a touch as you leave
   * the hero — quiet depth, transform/opacity only. */
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });
  const copyYRaw = useTransform(scrollYProgress, [0, 1], [0, -48]);
  const fadeRaw = useTransform(scrollYProgress, [0, 0.85], [1, 0]);

  /* Spring-smooth the parallax so it tracks Lenis' inertia instead of jittering. */
  const spring = { stiffness: 120, damping: 30, mass: 0.4 };
  const copyY = useSpring(copyYRaw, spring);
  const fade = useSpring(fadeRaw, spring);

  /* Reduced motion: freeze every scroll-bound transform at rest. */
  const sCopyY = reduce ? 0 : copyY;
  const sFade = reduce ? 1 : fade;

  return (
    <section
      ref={sectionRef}
      /* 72svh on the phone so the copy reads composed and the next section
       * peeks above the fold edge — no stranded whitespace band. Desktop may
       * breathe wider. */
      className="grain relative flex min-h-[72svh] items-center overflow-hidden bg-surface text-ink md:min-h-[82svh]"
    >
      {/* The woven tableau: the house's world drifting behind the copy at
       * watermark strength — z-0 under the z-10 copy column. */}
      <HeroTableau />

      <motion.div
        className="relative z-10 mx-auto w-full max-w-edge px-5 py-w14-5 md:px-6 md:py-section"
        style={{ y: sCopyY }}
      >
        <motion.div variants={stage} initial={initial} animate="show" className="max-w-[52rem]">
          {/* The house kicker: gilt ◆ + the official trade line, straight off
           * the shop plaque. */}
          <motion.div variants={rise} className="mb-w14-3">
            <Kicker>Antiquitäten · Briefmarken · Münzen</Kicker>
          </motion.div>

          <h1 className="font-display text-fluid-hero font-semibold tracking-tight text-ink">
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
                      {/* The pivot word carries a quieter voice, not a louder one. */}
                      {isLast ? (
                        <span className="text-ink-aged">{w}</span>
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

          {/* The gilt thread: a single hairline draws once, left to right,
           * then rests — the first smart gold seasoning, gilt as an edge. */}
          <motion.span
            aria-hidden="true"
            className="mt-w14-3 block h-px w-28 origin-left bg-gilt/60"
            initial={reduce ? false : { scaleX: 0, opacity: 0 }}
            animate={{ scaleX: 1, opacity: 1 }}
            transition={{ duration: 0.85, ease, delay: 0.9 }}
          />

          <motion.p
            variants={rise}
            className="measure mt-w14-3 text-fluid-lead text-ink-aged md:mt-w14-4"
          >
            Münzen, Schmuck, Uhren, Briefmarken, Antiquitäten und Anlagegold.
            Geprüft, fair und versichert.
          </motion.p>

          {/* CTAs: stacked + full-width on phones (big, comfortable tap targets),
           * inline from sm up. A clean lift + arrow nudge only. */}
          <motion.div
            variants={rise}
            className="mt-w14-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center md:mt-w14-4"
          >
            <a
              href="#kollektion"
              className="group inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-button bg-ink px-6 text-[1rem] font-medium text-white transition-[transform,background-color] duration-base ease-hover hover:-translate-y-0.5 hover:bg-ink-aged focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-surface sm:w-auto sm:justify-start"
            >
              <span>Kollektion entdecken</span>
              <ArrowRight
                className="h-[18px] w-[18px] transition-transform duration-base ease-hover group-hover:translate-x-1"
                strokeWidth={1.8}
                aria-hidden="true"
              />
            </a>
            <a
              href="#ankauf"
              className="inline-flex min-h-[52px] w-full items-center justify-center rounded-button border border-[color:color-mix(in_srgb,var(--w14-ink)_20%,transparent)] px-6 text-[1rem] font-medium text-ink-aged transition-colors duration-base ease-hover hover:border-[color:color-mix(in_srgb,var(--w14-ink)_45%,transparent)] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-surface sm:w-auto"
            >
              Ankauf &amp; Schätzung
            </a>
          </motion.div>
        </motion.div>
      </motion.div>

      {/* a single quiet rule where the hero meets the next section — the
       * standard hairline token, one rule weight across the whole page */}
      <div className="absolute inset-x-0 bottom-0 z-10 h-px bg-rule" />

      {/* a whisper-soft scroll cue that fades as you leave the hero */}
      {!reduce && (
        <motion.div
          aria-hidden="true"
          style={{ opacity: sFade }}
          className="pointer-events-none absolute inset-x-0 bottom-5 z-10 flex justify-center"
        >
          <motion.span
            className="block h-9 w-px bg-[color:color-mix(in_srgb,var(--w14-ink)_35%,transparent)]"
            animate={{ y: [0, 8, 0], opacity: [0.45, 0.8, 0.45] }}
            transition={{ duration: 3.2, ease: "easeInOut", repeat: Infinity }}
          />
        </motion.div>
      )}
    </section>
  );
}
