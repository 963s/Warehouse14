"use client";

import { useRef } from "react";
import dynamic from "next/dynamic";
import { motion, useInView, useReducedMotion, useScroll, useTransform } from "framer-motion";

// The brand film is browser-only (rAF clock) — keep it out of the initial
// bundle and only resolve the import once the section nears the viewport.
const ExplainerPlayer = dynamic(
  () => import("./explainer-player").then((m) => m.ExplainerPlayer),
  {
    ssr: false,
    loading: () => (
      <div className="aspect-[4/5] w-full animate-pulse bg-ink-deep sm:aspect-video" aria-hidden="true" />
    ),
  },
);

const EASE = [0.16, 1, 0.3, 1] as const; // --w14-ease-out
const DUR_SLOW = 0.65; // --w14-dur-slow

export function ExplainerVideoSection() {
  const reduce = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  // Gate the player import on proximity: mount ~one viewport early so the film
  // is ready by the time it scrolls in, but never on first paint.
  const nearViewport = useInView(playerRef, { once: true, margin: "60% 0px" });

  // Subtle scroll-parallax on the headline — transform/opacity only, 60fps.
  // Disabled for reduced motion.
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "end start"],
  });
  const headlineY = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [40, -40]);

  return (
    <section
      ref={sectionRef}
      className="bg-ink-deep grain relative pt-section pb-w14-5 text-white"
      aria-label="Markenfilm"
      style={{ width: "100vw", marginLeft: "calc(50% - 50vw)" }}
    >
      {/* soft top + bottom blends so the section melts into its neighbours.
          clipped to the band so they never spill past it. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-28 overflow-hidden bg-gradient-to-b from-surface to-transparent" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-24 overflow-hidden bg-gradient-to-t from-surface to-transparent" aria-hidden="true" />

      {/* constrained headline column — the only boxed element here */}
      <div className="relative mx-auto max-w-edge px-6">
        <motion.div
          className="mx-auto max-w-2xl text-center"
          style={reduce ? undefined : { y: headlineY }}
          initial={reduce ? false : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-12%" }}
          transition={{ duration: DUR_SLOW, ease: EASE }}
        >
          <motion.p
            className="eyebrow text-gold/80"
            initial={reduce ? false : { opacity: 0, letterSpacing: "0.04em" }}
            whileInView={{ opacity: 1, letterSpacing: "0.14em" }}
            viewport={{ once: true, margin: "-12%" }}
            transition={{ duration: DUR_SLOW, ease: EASE }}
          >
            Der Film
          </motion.p>
          <h2 className="mt-w14-2 font-display text-fluid-h2 tracking-tight text-[#f3ecdd]">
            Die Geschichte hinter jedem Stück
          </h2>
          <p className="mt-w14-3 text-fluid-lead text-white/80">
            In zwanzig Sekunden: von der Tagesnotierung über die Prüfung bis zur
            versicherten Lieferung. Ein Haus, eine Wahrheit, vom Kontor zu Ihnen.
          </p>
          {/* gilt hairline draws in beneath the kicker */}
          <motion.div
            className="bg-gold-gradient mx-auto mt-w14-3 h-px w-16 opacity-70"
            style={{ transformOrigin: "center" }}
            initial={reduce ? false : { scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true, margin: "-12%" }}
            transition={{ delay: 0.25, duration: DUR_SLOW, ease: EASE }}
          />
        </motion.div>
      </div>

      {/* FULL-BLEED film band — the parent section is already 100vw edge-to-edge,
          so the film simply fills it: no frame, no rounding, woven into the page. */}
      <motion.div
        ref={playerRef}
        className="relative mt-w14-5 w-full"
        initial={reduce ? false : { opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-10%" }}
        transition={{ duration: 0.85, ease: EASE }}
      >
        {nearViewport ? (
          <ExplainerPlayer />
        ) : (
          <div className="aspect-[4/5] w-full bg-ink-deep sm:aspect-video" aria-hidden="true" />
        )}
      </motion.div>
    </section>
  );
}
