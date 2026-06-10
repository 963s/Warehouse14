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
      <div className="aspect-video w-full animate-pulse rounded-[18px] bg-ink-deep" aria-hidden="true" />
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

  // Subtle scroll-parallax on the dark mount + a drifting gilt aura behind the
  // film — transform/opacity only, so it stays 60fps. Disabled for reduced motion.
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "end start"],
  });
  const auraY = useTransform(scrollYProgress, [0, 1], ["-8%", "8%"]);
  const auraScale = useTransform(scrollYProgress, [0, 0.5, 1], [0.92, 1.04, 0.96]);
  const headlineY = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [40, -40]);

  return (
    <section
      ref={sectionRef}
      className="bg-ink-deep grain relative overflow-hidden py-section text-white"
      aria-label="Markenfilm"
    >
      {/* soft top + bottom blends so the section melts into its neighbours */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-surface to-transparent" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-surface to-transparent" aria-hidden="true" />

      {/* drifting gilt aura behind the film */}
      {!reduce && (
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 h-[120%] w-[80%] -translate-x-1/2 -translate-y-1/2"
          style={{
            y: auraY,
            scale: auraScale,
            background:
              "radial-gradient(closest-side, rgba(191,148,48,0.18), rgba(191,148,48,0.05) 55%, transparent 72%)",
          }}
        />
      )}

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

        <motion.div
          ref={playerRef}
          className="relative mx-auto mt-w14-5 max-w-5xl"
          initial={reduce ? false : { opacity: 0, y: 24, scale: 0.985 }}
          whileInView={{ opacity: 1, y: 0, scale: 1 }}
          viewport={{ once: true, margin: "-10%" }}
          transition={{ duration: 0.85, ease: EASE }}
        >
          {nearViewport ? (
            <ExplainerPlayer />
          ) : (
            <div className="aspect-video w-full rounded-[18px] bg-ink-deep" aria-hidden="true" />
          )}
        </motion.div>
      </div>
    </section>
  );
}
