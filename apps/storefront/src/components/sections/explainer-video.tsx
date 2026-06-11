"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { motion, useInView, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { Kicker } from "@/components/brand/kicker";
import { BrandPlaque } from "@/components/brand/marks";

/* The composed still frame of the film: the registered plaque on the cream
 * stage with the closing line. It owns the EXACT same aspect box as the
 * player's stage, so the reserved height never shifts, and it stays visible
 * in every state where the film has not painted yet (chunk loading, JS
 * delayed, an observer that never fires). Never an empty cream band. */
function FilmPoster() {
  return (
    <div className="relative aspect-[4/5] w-full overflow-hidden sm:aspect-video" aria-hidden="true">
      <div className="absolute inset-0 grid place-items-center px-6">
        <div className="flex flex-col items-center">
          <BrandPlaque className="h-auto w-[clamp(190px,30vw,290px)] text-ink" />
          <p className="mt-4 text-center font-display text-xl font-semibold tracking-tight text-ink sm:text-2xl">
            Vom Nachlass in gute Hände.
          </p>
        </div>
      </div>
    </div>
  );
}

// The brand film is browser-only (rAF clock) — keep it out of the initial
// bundle and only resolve the import once the section nears the viewport.
// While the chunk loads, the poster holds the frame.
const ExplainerPlayer = dynamic(
  () => import("./explainer-player").then((m) => m.ExplainerPlayer),
  {
    ssr: false,
    loading: () => <FilmPoster />,
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
  // Safety net: some environments never fire the observer (snapshot renderers,
  // odd in-app webviews). Mount the player after a short idle regardless — it
  // pauses its own clock while off screen, so the only cost is the chunk.
  const [mountAnyway, setMountAnyway] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setMountAnyway(true), 2500);
    return () => window.clearTimeout(t);
  }, []);
  const showPlayer = nearViewport || mountAnyway;

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
      // bg-ink-deep is the deep CREAM panel now — everything inside reads in ink.
      // .full-bleed spans the viewport edge-to-edge with no horizontal scrollbar.
      className="bg-ink-deep grain full-bleed relative pt-section pb-w14-5 text-ink"
      aria-label="Markenfilm"
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
          <Kicker className="justify-center">Der Film</Kicker>
          <h2 className="mt-w14-2 font-display text-fluid-h2 tracking-tight text-ink">
            Vom Nachlass zum Schatz
          </h2>
          <p className="mt-w14-3 text-fluid-lead text-ink-aged">
            Wir kaufen ganze Nachlässe an. Jedes Stück wird geprüft, sortiert
            und fair bewertet. In zwanzig Sekunden zeigt der Film den Weg vom
            Karton in gute Hände.
          </p>
          {/* ink hairline draws in beneath the kicker */}
          <motion.div
            className="bg-ink mx-auto mt-w14-3 h-px w-16 opacity-60"
            style={{ transformOrigin: "center" }}
            initial={reduce ? false : { scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true, margin: "-12%" }}
            transition={{ delay: 0.25, duration: DUR_SLOW, ease: EASE }}
          />
        </motion.div>
      </div>

      {/* FULL-BLEED film band — the parent section is already 100vw edge-to-edge,
          so the film simply fills it: no frame, no rounding, woven into the page.
          Deliberately NO opacity entrance here: an observer that misses leaves a
          dead cream band, and the film already fades in from the paper itself.
          Before the player mounts, the poster still holds the identical box. */}
      <div ref={playerRef} className="relative mt-w14-5 w-full">
        {showPlayer ? <ExplainerPlayer /> : <FilmPoster />}
      </div>
    </section>
  );
}
