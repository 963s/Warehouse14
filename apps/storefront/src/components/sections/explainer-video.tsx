"use client";

import { useRef } from "react";
import dynamic from "next/dynamic";
import { motion, useInView, useReducedMotion } from "framer-motion";

// The Remotion Player is browser-only AND heavy — keep it out of the initial
// bundle and only resolve the import once the section nears the viewport.
const ExplainerPlayer = dynamic(
  () => import("./explainer-player").then((m) => m.ExplainerPlayer),
  {
    ssr: false,
    loading: () => <div className="aspect-video w-full bg-ink-deep" />,
  },
);

const EASE = [0.16, 1, 0.3, 1] as const; // --w14-ease-out
const DUR_SLOW = 0.65; // --w14-dur-slow

export function ExplainerVideoSection() {
  const reduce = useReducedMotion();
  const playerRef = useRef<HTMLDivElement>(null);
  // Gate the Remotion bundle on proximity: it mounts ~one viewport early so the
  // player is ready by the time it scrolls in, but never on first paint.
  const nearViewport = useInView(playerRef, { once: true, margin: "60% 0px" });

  return (
    <section className="bg-ink-deep grain relative overflow-hidden py-section text-white">
      {/* soft top + bottom blends so the section melts into its neighbours */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-surface to-transparent" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-surface to-transparent" aria-hidden="true" />

      <div className="relative mx-auto max-w-edge px-6">
        <motion.div
          className="mx-auto max-w-2xl text-center"
          initial={reduce ? false : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-12%" }}
          transition={{ duration: DUR_SLOW, ease: EASE }}
        >
          <p className="eyebrow text-gold/80">Der Film</p>
          <h2 className="mt-w14-2 font-display text-fluid-h2 tracking-tight text-[#f3ecdd]">
            Die Geschichte hinter jedem Stück
          </h2>
          <p className="mt-w14-3 text-fluid-lead text-white/80">
            In zwanzig Sekunden: von der Tagesnotierung über die Prüfung bis zur
            versicherten Lieferung. Ein Haus, eine Wahrheit, vom Kontor zu Ihnen.
          </p>
        </motion.div>

        <motion.div
          ref={playerRef}
          className="relative mx-auto mt-w14-5 max-w-5xl"
          initial={reduce ? false : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-12%" }}
          transition={{ duration: DUR_SLOW, ease: EASE }}
        >
          {nearViewport ? (
            <ExplainerPlayer />
          ) : (
            <div className="aspect-video w-full bg-ink-deep" aria-hidden="true" />
          )}
        </motion.div>
      </div>
    </section>
  );
}
