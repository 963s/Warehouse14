"use client";

import { ArrowUpRight } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { Reveal } from "@/components/ui/reveal";
import { categories } from "@/lib/placeholder-data";
import { CollectionSymbol, SYMBOL_TINTS, type SymbolKey } from "@/components/collection-symbols";

const FALLBACK: SymbolKey = "sammlerobjekte";
const KNOWN = new Set<string>(["muenzen", "edelmetalle", "antiquitaeten", "schmuck", "briefmarken", "sammlerobjekte"]);

export function Categories() {
  const reduce = useReducedMotion();

  return (
    <section id="kategorien" className="py-section">
      <div className="mx-auto max-w-edge px-5">
        <Reveal className="mb-w14-4 measure">
          <div className="eyebrow">Sortiment</div>
          <h2 className="mt-w14-2 font-display text-fluid-h2 font-medium">Durchstöbern Sie das Kontor</h2>
          <p className="mt-w14-2 text-ink-faded">
            Von alten Münzen über Schmuck, Uhren und Briefmarken bis zu ganzen Nachlässen. Viele Welten, ein geprüfter Bestand.
          </p>
        </Reveal>

        <div className="grid grid-cols-1 gap-w14-3 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((c, i) => {
            const key = (KNOWN.has(c.slug) ? c.slug : FALLBACK) as SymbolKey;
            const tint = SYMBOL_TINTS[key].card;
            return (
              <Reveal key={c.slug} index={i % 2}>
                <motion.a
                  href="#kollektion"
                  className="group relative flex h-full flex-col overflow-hidden rounded-card border border-rule bg-card shadow-card transition-[border-color,box-shadow] duration-base ease-hover hover:border-[color:color-mix(in_srgb,var(--tint)_40%,var(--w14-rule))] hover:shadow-lift"
                  style={{ ["--tint" as string]: tint, willChange: "transform" }}
                  initial={false}
                  whileHover={reduce ? undefined : { y: -6 }}
                  whileTap={reduce ? undefined : { scale: 0.99 }}
                  transition={{ type: "spring", stiffness: 320, damping: 26, mass: 0.6 }}
                >
                  {/* calm tinted plinth — a quiet wash, no sweep, no gleam */}
                  <div
                    className="relative z-10 flex h-28 items-center justify-center overflow-hidden border-b border-rule sm:h-32"
                    style={{ background: `linear-gradient(155deg, ${tint}26, ${tint}0d 78%)` }}
                  >
                    <motion.span
                      style={{ color: tint, willChange: "transform" }}
                      className="relative"
                      initial={false}
                      whileHover={reduce ? undefined : { scale: 1.08 }}
                      transition={{ type: "spring", stiffness: 260, damping: 20 }}
                    >
                      <CollectionSymbol name={key} size={64} strokeWidth={1.4} />
                    </motion.span>
                  </div>
                  <div className="relative z-10 flex flex-1 flex-col p-card">
                    <div className="flex items-start justify-between gap-w14-2">
                      <h3 className="font-display text-fluid-h3 font-medium">
                        <span className="underline-draw">{c.name}</span>
                      </h3>
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-rule text-ink-faded transition-colors duration-base ease-hover group-hover:border-[color:var(--tint)] group-hover:[color:var(--tint)]">
                        <ArrowUpRight
                          className="h-[18px] w-[18px] transition-transform duration-base ease-hover group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                          aria-hidden="true"
                        />
                      </span>
                    </div>
                    <p className="mt-w14-1 flex-1 text-[0.8125rem] leading-relaxed text-ink-faded">{c.blurb}</p>
                    <div className="tnum mt-w14-3 text-[0.8125rem] font-medium text-ink-aged">
                      {c.count.toLocaleString("de-DE")} <span className="font-normal text-ink-faded">Objekte</span>
                    </div>
                  </div>
                </motion.a>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
