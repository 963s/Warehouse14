import { ArrowRight } from "lucide-react";
import { Reveal } from "@/components/ui/reveal";
import { ProductCard } from "@/components/product/product-card";
import { data } from "@/lib/storefront-data";

/** Home "Ausgewählte Stücke", now reads the data layer + the shared ProductCard. */
export async function FeaturedGrid() {
  const { items } = await data.listProducts({ limit: 6, sort: "published_desc" });

  return (
    <section id="kollektion" className="border-t border-rule bg-card py-section">
      <div className="mx-auto max-w-edge px-5">
        <Reveal className="mb-w14-4 flex flex-wrap items-end justify-between gap-w14-3">
          <div className="measure">
            <div className="eyebrow text-gold">Kollektion</div>
            <h2 className="mt-w14-2 font-display text-fluid-h2 font-medium">Ausgewählte Stücke</h2>
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
              className="h-4 w-4 transition-transform duration-base ease-hover group-hover/link:translate-x-0.5"
              aria-hidden="true"
            />
          </a>
        </Reveal>

        <div className="grid gap-w14-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p, i) => (
            <Reveal key={p.id} delay={(i % 3) * 0.07}>
              <ProductCard product={p} priority={i < 3} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
