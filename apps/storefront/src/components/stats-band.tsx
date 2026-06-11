"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Reveal } from "@/components/ui/reveal";

/**
 * Trust band. Every cell is a claim the rest of the site already makes
 * (vollständig versicherter Versand, Ankauf zum Tagespreis, das Haus in
 * Schorndorf, persönliche Beratung) — no invented counts, ratings or years.
 * The old placeholder stats ("12.480+ Objekte", "4,9 ★ aus 2.347
 * Bewertungen", "seit 1987") are gone, and so is the count-up: a counter
 * rolling through "83 % versichert" on its way to 100 % reads as a false
 * claim in any mid-scroll glance or screenshot, so the one number renders
 * still, in the tnum voice. Word claims ride the display face.
 */
type BandCell = {
  /** Display value — words in the display face, numbers in tnum. */
  text: string;
  numeric?: boolean;
  label: string;
  note?: string;
};

const cells: BandCell[] = [
  {
    text: "100 %",
    numeric: true,
    label: "Versicherter Versand",
    note: "Sorgfältig verpackt, diskret",
  },
  {
    text: "Tagespreis",
    label: "Transparente Preise",
    note: "Goldankauf zum Live-Kurs",
  },
  {
    text: "Schorndorf",
    /* "Goldhaus" framed the whole trade as gold only — the Kontor holds
     * Antiquitäten, Briefmarken und Münzen, Gold ist ein Teil davon. */
    label: "Ihr Kontor vor Ort",
    note: "Ankauf · Verkauf · Bewertung",
  },
  {
    text: "Persönlich",
    label: "Beratung nach Termin",
    note: "Wir nehmen uns Zeit",
  },
];

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
            className="mx-auto mt-w14-3 block h-px w-16 origin-center bg-ink/35"
            aria-hidden="true"
            initial={reduce ? false : { scaleX: 0, opacity: 0 }}
            whileInView={{ scaleX: 1, opacity: 1 }}
            viewport={{ once: true, margin: "-12%" }}
            transition={{ duration: 0.75, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          />
        </Reveal>

        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card bg-rule lg:grid-cols-4">
          {cells.map((c, i) => (
            <Reveal key={c.label} index={i} className="bg-card">
              <div className="relative min-w-0 px-w14-2 py-w14-4 text-center sm:px-w14-3 sm:py-w14-5">
                {/* one shared fluid-h2 voice for all four cells — fluid-h1
                    clipped the word claims against their half-width cells at
                    390px, and a row of mixed sizes reads restless. min-w-0 +
                    break-words keep long words inside the cell border. */}
                <div className="relative min-w-0 break-words text-fluid-h2 font-medium leading-none tracking-tight text-ink">
                  {c.numeric ? (
                    <span className="tnum">{c.text}</span>
                  ) : (
                    <span className="font-display">{c.text}</span>
                  )}
                </div>
                <motion.span
                  className="mx-auto mt-w14-2 block h-px w-8 origin-center bg-ink/30"
                  aria-hidden="true"
                  initial={reduce ? false : { scaleX: 0 }}
                  whileInView={{ scaleX: 1 }}
                  viewport={{ once: true, margin: "-12%" }}
                  transition={{ duration: 0.6, delay: 0.4 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                />
                <div className="relative mt-w14-2 text-fluid-body text-ink-aged">{c.label}</div>
                {c.note && (
                  <div className="relative mt-w14-1 text-eyebrow text-ink-faded">{c.note}</div>
                )}
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
