"use client";

import { ArrowUpRight } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { Reveal } from "@/components/ui/reveal";
import { categories } from "@/lib/placeholder-data";
import { Kicker } from "@/components/brand/kicker";
import { engravedIconForSlug } from "@/components/brand/engraved-icons";

/* The plaque's cut-corner geometry, whispered: an octagonal clip with small
 * 45° corner cuts. Borders cannot follow a clip-path, so the frame is built
 * from two clipped layers — a bg-rule sheet with 1px padding (the hairline)
 * around the bg-card body. Depth comes from a drop-shadow FILTER on the
 * wrapper, which traces the clipped silhouette instead of the box. */
const CUT = "polygon(10px 0, calc(100% - 10px) 0, 100% 10px, 100% calc(100% - 10px), calc(100% - 10px) 100%, 10px 100%, 0 calc(100% - 10px), 0 10px)";

export function Categories() {
  const reduce = useReducedMotion();

  return (
    <section id="kategorien" className="py-section">
      <div className="mx-auto max-w-edge px-5">
        <Reveal className="mb-w14-4 measure">
          <Kicker>Sortiment</Kicker>
          <h2 className="mt-w14-2 font-display text-fluid-h2 font-medium">Durchstöbern Sie das Kontor</h2>
          <p className="mt-w14-2 text-ink-faded">
            Von alten Münzen über Schmuck, Uhren und Briefmarken bis zu ganzen Nachlässen. Viele Welten, ein geprüfter Bestand.
          </p>
        </Reveal>

        {/* Phone: a horizontal snap rail — six stacked cards would cost ~2000px
         * of thumb travel before the products. The next card peeks ~70px past
         * the edge (the scroll affordance), snap-start keeps cards uncut.
         * From sm up it settles into the familiar grid. */}
        <div className="-mx-5 flex snap-x snap-mandatory gap-w14-2 overflow-x-auto overscroll-x-contain scroll-px-5 px-5 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:grid sm:snap-none sm:grid-cols-2 sm:gap-w14-3 sm:overflow-visible sm:p-0 lg:grid-cols-3">
          {categories.map((c, i) => {
            const Icon = engravedIconForSlug(c.slug);
            return (
              <Reveal
                key={c.slug}
                index={i % 2}
                className="w-[76vw] max-w-[320px] shrink-0 snap-start sm:w-auto sm:max-w-none sm:shrink"
              >
                <motion.a
                  href="#kollektion"
                  className="group block h-full [filter:drop-shadow(0_1px_2px_rgba(16,24,40,0.05))_drop-shadow(0_2px_5px_rgba(16,24,40,0.07))]"
                  style={{ willChange: "transform" }}
                  initial={false}
                  whileHover={reduce ? undefined : { y: -6 }}
                  whileTap={reduce ? undefined : { scale: 0.99 }}
                  transition={{ type: "spring", stiffness: 320, damping: 26, mass: 0.6 }}
                >
                  {/* hairline sheet — the cut-corner frame */}
                  <div
                    className="h-full bg-rule p-px transition-colors duration-base ease-hover group-hover:bg-ink/30"
                    style={{ clipPath: CUT }}
                  >
                    <div className="flex h-full flex-col bg-card" style={{ clipPath: CUT }}>
                      {/* calm raised plinth — quiet cream wash, the engraved miniature in ink;
                       * on hover only its accent strokes warm to gilt (wired in the icon set) */}
                      <div className="flex h-28 items-center justify-center border-b border-rule bg-gradient-to-br from-raised to-card sm:h-32">
                        <Icon className="h-14 w-14 text-ink sm:h-16 sm:w-16" />
                      </div>
                      <div className="flex flex-1 flex-col p-card">
                        <div className="flex items-start justify-between gap-w14-2">
                          <h3 className="font-display text-fluid-h3 font-medium">
                            <span className="underline-draw">{c.name}</span>
                          </h3>
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-rule text-ink-faded transition-colors duration-base ease-hover group-hover:border-ink group-hover:text-ink">
                            <ArrowUpRight
                              className="h-[18px] w-[18px] transition-transform duration-base ease-hover group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                              strokeWidth={1.8}
                              aria-hidden="true"
                            />
                          </span>
                        </div>
                        {/* no object counts here — the placeholder numbers read as
                         * inventory claims the real catalog cannot back. The blurb
                         * carries the card; the side menu dropped its counts too. */}
                        <p className="mt-w14-1 flex-1 text-[0.8125rem] leading-relaxed text-ink-faded">{c.blurb}</p>
                      </div>
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
