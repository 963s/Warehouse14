import { ArrowUpRight } from "lucide-react";
import { Reveal } from "@/components/ui/reveal";
import { categories } from "@/lib/placeholder-data";
import { CollectionSymbol, SYMBOL_TINTS, type SymbolKey } from "@/components/collection-symbols";

const FALLBACK: SymbolKey = "sammlerobjekte";
const KNOWN = new Set<string>(["muenzen", "edelmetalle", "antiquitaeten", "schmuck", "briefmarken", "sammlerobjekte"]);

export function Categories() {
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
              <Reveal key={c.slug} delay={(i % 3) * 0.07}>
                <a
                  href="#kollektion"
                  className="group relative flex h-full flex-col overflow-hidden rounded-card border border-rule bg-card shadow-card hover-lift hover:shadow-lift"
                  style={{ ["--tint" as string]: tint }}
                >
                  <div
                    className="relative flex h-32 items-center justify-center"
                    style={{ background: `linear-gradient(155deg, ${tint}3d, ${tint}12 72%)` }}
                  >
                    <span style={{ color: tint }} className="img-zoom drop-shadow-sm">
                      <CollectionSymbol name={key} size={68} strokeWidth={1.4} />
                    </span>
                    <span className="absolute inset-x-0 bottom-0 h-px" style={{ background: `${tint}5c` }} />
                  </div>
                  <div className="flex flex-1 flex-col p-card">
                    <div className="flex items-start justify-between gap-w14-2">
                      <h3 className="font-display text-fluid-h3 font-medium">
                        <span className="underline-draw">{c.name}</span>
                      </h3>
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-rule text-ink-faded">
                        <ArrowUpRight
                          className="h-[18px] w-[18px] transition-colors duration-base ease-hover group-hover:[color:var(--tint)]"
                          aria-hidden="true"
                        />
                      </span>
                    </div>
                    <p className="mt-w14-1 flex-1 text-[0.8125rem] text-ink-faded">{c.blurb}</p>
                    <div className="tnum mt-w14-3 text-[0.8125rem] font-medium text-ink-aged">
                      {c.count.toLocaleString("de-DE")} <span className="font-normal text-ink-faded">Objekte</span>
                    </div>
                  </div>
                </a>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
