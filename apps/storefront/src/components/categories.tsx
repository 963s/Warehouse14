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

        <div className="grid gap-w14-3 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((c, i) => {
            const key = (KNOWN.has(c.slug) ? c.slug : FALLBACK) as SymbolKey;
            const tint = SYMBOL_TINTS[key].card;
            return (
              <Reveal key={c.slug} index={i % 3}>
                <motion.a
                  href="#kollektion"
                  className="group relative flex h-full flex-col overflow-hidden rounded-card border border-rule bg-card shadow-card"
                  style={{ ["--tint" as string]: tint, willChange: "transform" }}
                  initial={false}
                  whileHover={reduce ? undefined : { y: -8, scale: 1.012 }}
                  whileTap={reduce ? undefined : { scale: 0.99 }}
                  transition={{ type: "spring", stiffness: 320, damping: 26, mass: 0.6 }}
                >
                  {/* gold corona that blooms on hover — the vitrine spotlight */}
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute -inset-px z-0 rounded-card opacity-0 transition-opacity duration-base ease-hover group-hover:opacity-100"
                    style={{ boxShadow: `0 20px 50px -18px ${tint}9e, inset 0 0 0 1px ${tint}55` }}
                  />
                  <div
                    className="relative z-10 flex h-32 items-center justify-center overflow-hidden"
                    style={{ background: `linear-gradient(155deg, ${tint}3d, ${tint}12 72%)` }}
                  >
                    {/* light sweep across the plinth on hover */}
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 -translate-x-full transition-transform duration-700 ease-hover group-hover:translate-x-full"
                      style={{ background: `linear-gradient(105deg, transparent, ${tint}33 45%, rgba(255,255,255,.5) 50%, ${tint}33 55%, transparent)` }}
                    />
                    <motion.span
                      style={{ color: tint, willChange: "transform" }}
                      className="relative drop-shadow-sm"
                      initial={false}
                      whileHover={reduce ? undefined : { scale: 1.12, rotate: -4 }}
                      transition={{ type: "spring", stiffness: 260, damping: 18 }}
                    >
                      <CollectionSymbol name={key} size={68} strokeWidth={1.4} />
                    </motion.span>
                    <span className="absolute inset-x-0 bottom-0 h-px" style={{ background: `${tint}5c` }} />
                  </div>
                  <div className="relative z-10 flex flex-1 flex-col p-card">
                    <div className="flex items-start justify-between gap-w14-2">
                      <h3 className="font-display text-fluid-h3 font-medium">
                        <span className="underline-draw">{c.name}</span>
                      </h3>
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-rule text-ink-faded transition-all duration-base ease-hover group-hover:border-[color:var(--tint)] group-hover:[background:color-mix(in_srgb,var(--tint)_12%,transparent)]">
                        <ArrowUpRight
                          className="h-[18px] w-[18px] transition-all duration-base ease-hover group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:[color:var(--tint)]"
                          aria-hidden="true"
                        />
                      </span>
                    </div>
                    <p className="mt-w14-1 flex-1 text-[0.8125rem] text-ink-faded">{c.blurb}</p>
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
