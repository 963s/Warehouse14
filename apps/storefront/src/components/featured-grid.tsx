import { ArrowRight } from "lucide-react";
import { Reveal, RevealGroup, RevealChild } from "@/components/ui/reveal";
import { ProductCard } from "@/components/product/product-card";
import { data } from "@/lib/storefront-data";

/** Home "Ausgewählte Stücke", reads the data layer + the shared ProductCard.
 * Server component (awaits the data layer); the entrance choreography rides on
 * the client RevealGroup/RevealChild primitives, which happily wrap server
 * children. The grid cascades in like a row of vitrine cases lighting up. */
export async function FeaturedGrid() {
  const { items } = await data.listProducts({ limit: 6, sort: "published_desc" });

  return (
    <section id="kollektion" className="border-t border-rule bg-raised py-section">
      <div className="mx-auto max-w-edge px-5">
        <Reveal className="mb-w14-4 flex flex-wrap items-end justify-between gap-w14-3">
          <div className="measure">
            <div className="eyebrow">Kollektion</div>
            <h2 className="mt-w14-2 font-display text-fluid-h2 font-medium">Ausgewählte Stücke</h2>
            {/* static hairline — .hairline-draw depended on a .reveal-in toggle
             * that nothing ever sets, so it sat at scaleX(0) and never showed.
             * The header's Reveal already carries the entrance. */}
            <span className="mt-w14-3 block h-px w-16 bg-[color:color-mix(in_srgb,var(--w14-ink)_35%,transparent)]" aria-hidden="true" />
            <p className="mt-w14-2 text-ink-faded">
              Jedes Objekt ein Unikat, geprüft, fotografiert und zum fairen Tagespreis.
            </p>
          </div>
          {/* min-h keeps the link a comfortable >=44px thumb target */}
          <a
            href="/kollektion"
            className="group/link inline-flex min-h-[44px] items-center gap-w14-1 text-eyebrow font-medium text-ink"
          >
            <span className="underline-draw">Ganze Kollektion</span>
            <ArrowRight
              className="h-[18px] w-[18px] transition-transform duration-base ease-hover group-hover/link:translate-x-1"
              strokeWidth={1.8}
              aria-hidden="true"
            />
          </a>
        </Reveal>

        {/* 2-up already on the phone — the same scanning rhythm as the
            kollektion grid; six full-width mega cards were ~4 screens of
            scrolling. h-full on each child keeps the price/CTA feet on one
            shared baseline per row. Desktop stays 3-up. */}
        <RevealGroup className="grid grid-cols-2 gap-w14-2 sm:gap-w14-3 lg:grid-cols-3" stagger={0.09}>
          {items.map((p, i) => (
            <RevealChild key={p.id} className="h-full">
              <ProductCard product={p} priority={i < 2} />
            </RevealChild>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}
