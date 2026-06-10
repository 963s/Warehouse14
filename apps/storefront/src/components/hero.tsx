"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Loupe } from "@/components/loupe";

const ease = [0.16, 1, 0.3, 1] as const;

/* One vocabulary, taken from the motion tokens: a calm word-by-word reveal,
 * then everything holds still. No loops, no parallax on type, no spring. */
const group = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.08 } },
};
const rise = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.65, ease } },
};
const word = {
  hidden: { opacity: 0, y: "0.32em" },
  show: { opacity: 1, y: "0em", transition: { duration: 0.65, ease } },
};
const headline = ["Werte", "mit", "Geschichte."];

export function Hero() {
  const reduce = useReducedMotion();
  const initial = reduce ? false : "hidden";

  return (
    <section className="bg-ink-deep grain relative overflow-hidden text-white">
      <div className="mx-auto grid w-full max-w-edge items-center gap-w14-5 px-5 py-section md:grid-cols-[1.1fr_0.9fr]">
        <motion.div variants={group} initial={initial} animate="show">
          <motion.p
            variants={rise}
            className="eyebrow mb-w14-3 text-gold/90"
          >
            Edelmetalle &amp; Raritäten · Schorndorf
          </motion.p>

          <h1 className="font-display text-fluid-h1 font-medium tracking-tight text-[#f4eede]">
            <motion.span
              variants={group}
              initial={initial}
              animate="show"
              className="block"
            >
              {headline.map((w, i) => (
                <motion.span
                  key={w}
                  variants={word}
                  className="inline-block"
                >
                  {w}
                  {i < headline.length - 1 ? " " : null}
                </motion.span>
              ))}
            </motion.span>
          </h1>

          {/* The single signature motion: one gold hairline drawn left→right. */}
          <motion.span
            aria-hidden="true"
            className="mt-w14-3 block h-px w-24 origin-left bg-gold/70"
            initial={reduce ? false : { scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.65, ease, delay: 0.5 }}
          />

          <motion.p
            variants={rise}
            className="measure mt-w14-4 text-fluid-lead text-white/80"
          >
            Münzen, Schmuck, Uhren, Briefmarken, Antiquitäten und Anlagegold —
            geprüft, fair und versichert.
          </motion.p>

          <motion.div variants={rise} className="mt-w14-4 flex flex-wrap items-center gap-w14-3">
            <a
              href="#kollektion"
              className="group inline-flex items-center gap-2 rounded-button bg-gold px-6 py-3.5 text-[0.98rem] font-medium text-[#2b210a] transition-[transform,background-color] duration-base ease-hover hover:-translate-y-0.5 hover:bg-gold-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-[#17130c]"
            >
              Kollektion entdecken
              <ArrowRight
                className="h-[18px] w-[18px] transition-transform duration-base ease-hover group-hover:translate-x-1"
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

        {/* The heritage cue: a single object under the house loupe, settled and
         * still. One element, presented like a piece on velvet. */}
        <motion.div
          aria-hidden="true"
          className="relative mx-auto hidden h-[360px] w-full max-w-[440px] place-items-center md:grid"
          initial={reduce ? false : { opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.65, ease, delay: 0.3 }}
        >
          <div
            className="absolute h-[300px] w-[300px] rounded-full"
            style={{ background: "radial-gradient(circle, rgba(231,222,205,0.12), transparent 66%)" }}
          />
          <Loupe size={188} className="relative drop-shadow-[0_30px_60px_-30px_rgba(0,0,0,0.85)]" />
        </motion.div>
      </div>

      {/* a single quiet rule where the espresso meets the cream surface */}
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-gold/30 to-transparent" />
    </section>
  );
}
