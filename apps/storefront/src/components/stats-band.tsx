"use client";

import { motion, useReducedMotion } from "framer-motion";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { Reveal } from "@/components/ui/reveal";
import { stats } from "@/lib/placeholder-data";

/**
 * The shared `stats` data still carries a fabricated tenure entry
 * ("Jahre Erfahrung / seit 1987"). We do not know the real founding year, so
 * that cell is replaced at render with a defensible, non-numeric claim — the
 * data file is owned elsewhere and must not assert an invented number.
 */
type Stat = (typeof stats)[number] & { note?: string };

const TENURE_LABEL = "Jahre Erfahrung";
const heritageStat = {
  text: "Schorndorf",
  label: "Ihr Goldhaus vor Ort",
  note: "Ankauf · Verkauf · Bewertung",
} as const;

export function StatsBand() {
  const reduce = useReducedMotion();

  return (
    <section id="vertrauen" className="py-section">
      <div className="mx-auto max-w-edge px-5">
        <Reveal className="mx-auto mb-w14-5 max-w-measure text-center">
          <p className="eyebrow">Warum warehouse14</p>
          <h2 className="mt-w14-3 font-display text-fluid-h2 font-medium">
            Ein Haus, dem Sammler &amp; Anleger vertrauen
          </h2>
          <motion.span
            className="mx-auto mt-w14-3 block h-px w-16 origin-center bg-gradient-to-r from-transparent via-gold to-transparent"
            aria-hidden="true"
            initial={reduce ? false : { scaleX: 0, opacity: 0 }}
            whileInView={{ scaleX: 1, opacity: 1 }}
            viewport={{ once: true, margin: "-12%" }}
            transition={{ duration: 0.75, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          />
        </Reveal>

        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card bg-rule lg:grid-cols-4">
          {(stats as Stat[]).map((s, i) => {
            const isTenure = s.label === TENURE_LABEL;
            return (
              <Reveal key={i} index={i} className="group/stat bg-card">
                <div className="relative px-w14-3 py-w14-5 text-center">
                  {/* a quiet gold wash rises behind each figure on hover */}
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 opacity-0 transition-opacity duration-base ease-hover group-hover/stat:opacity-100"
                    style={{ background: "linear-gradient(0deg, rgba(191,148,48,.10), transparent)" }}
                  />
                  <div className="relative font-display text-fluid-h1 font-medium leading-none tracking-tight text-ink tabular-nums">
                    {isTenure ? (
                      <span className="text-gold-gradient">{heritageStat.text}</span>
                    ) : (
                      <AnimatedCounter
                        value={s.value}
                        decimals={s.decimals ?? 0}
                        prefix={s.prefix ?? ""}
                        suffix={s.suffix ?? ""}
                        duration={2}
                      />
                    )}
                  </div>
                  <motion.span
                    className="mx-auto mt-w14-2 block h-px w-8 origin-center bg-gold/50"
                    aria-hidden="true"
                    initial={reduce ? false : { scaleX: 0 }}
                    whileInView={{ scaleX: 1 }}
                    viewport={{ once: true, margin: "-12%" }}
                    transition={{ duration: 0.6, delay: 0.4 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                  />
                  <div className="relative mt-w14-2 text-fluid-body text-ink-aged">
                    {isTenure ? heritageStat.label : s.label}
                  </div>
                  {(isTenure ? heritageStat.note : s.note) && (
                    <div className="relative mt-w14-1 text-eyebrow text-ink-faded">
                      {isTenure ? heritageStat.note : s.note}
                    </div>
                  )}
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
