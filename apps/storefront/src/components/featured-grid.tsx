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
    <section id="kollektion" className="border-t border-rule bg-card py-section">
      <div className="mx-auto max-w-edge px-5">
        <Reveal className="mb-w14-4 flex flex-wrap items-end justify-between gap-w14-3">
          <div className="measure">
            <div className="eyebrow text-gold">Kollektion</div>
            <h2 className="mt-w14-2 font-display text-fluid-h2 font-medium">Ausgewählte Stücke</h2>
            <span className="mt-w14-3 block h-px w-16 origin-left bg-gradient-to-r from-gold via-gold-soft to-transparent hairline-draw" aria-hidden="true" />
            <p className="mt-w14-2 text-ink-faded">
              Jedes Objekt ein Unikat, geprüft, fotografiert und zum fairen Tagespreis.
            </p>
          </div>
          <a
            href="/kollektion"
            className="group/link inline-flex items-center gap-w14-1 text-eyebrow font-medium text-gold-deep"
          >
            <span className="underline-draw">Ganze Kollektion</span>
            <ArrowRight
              className="h-4 w-4 transition-transform duration-base ease-hover group-hover/link:translate-x-1"
              aria-hidden="true"
            />
          </a>
        </Reveal>

        <RevealGroup className="grid gap-w14-3 sm:grid-cols-2 lg:grid-cols-3" stagger={0.09}>
          {items.map((p, i) => (
            <RevealChild key={p.id}>
              <ProductCard product={p} priority={i < 3} />
            </RevealChild>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}
