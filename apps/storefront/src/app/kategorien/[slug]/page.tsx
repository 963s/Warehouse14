import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { ProductGrid } from "@/components/catalog/product-grid";
import { FacetSidebar } from "@/components/catalog/facet-sidebar";
import { PaginationBar } from "@/components/catalog/pagination-bar";
import { Kicker } from "@/components/brand/kicker";
import { engravedIconBySlug } from "@/components/brand/engraved-icons";
import { data } from "@/lib/storefront-data";
import type { ProductQuery } from "@/lib/storefront-data";

const LIMIT = 12;

/**
 * The curator's opening line per world — honest, generic voice in the tone
 * of the house (the loupe, the Nachlass, the daily changing stock). No
 * inventory counts, no invented facts; categories without a curated line
 * simply show the seam description alone.
 */
const EDITORIAL_INTRO: Record<string, string> = {
  briefmarken:
    "Für Sammler, die in Gebieten denken: Deutschland, Europa, Übersee. Erhaltung, Stempel und Zähnung entscheiden, und jede Marke geht unter der Lupe durch die Hand, bevor sie hier erscheint.",
  uhren:
    "Bei alten Uhren zählen Werk und Patina. Eine Taschenuhr trägt ihre Jahrzehnte sichtbar, und genau das macht ihren Charakter aus. Beschrieben wird jedes Stück so, wie es ist.",
  muenzen:
    "Numismatik ist Geschichte zum Anfassen. Prägejahr, Herkunft und Erhaltung erzählen, durch welche Hände ein Stück gegangen ist.",
  gold:
    "Anlagegold ist die ruhigste Form des Sammelns. Münzen und Barren, gewogen und geprüft, mit klar ausgewiesenem Feingewicht.",
  goldmuenzen:
    "Klassische Anlagemünzen, gewogen und geprüft. Das Feingewicht steht bei jedem Stück dabei.",
  goldbarren:
    "Barren sind die nüchternste Form der Anlage. Gewicht und Feinheit stehen bei jedem Stück dabei.",
  silber:
    "Silber ist das zugängliche Sammelgebiet. Münzen und Barren mit ehrlichem Gewicht, geprüft wie alles im Haus.",
  silbermuenzen:
    "Anlage und Sammlung liegen beim Silber nah beieinander. Jede Münze wird gewogen, geprüft und ehrlich beschrieben.",
  platin:
    "Platin ist das stille Metall der Anlage. Münzen und Barren, gewogen und mit ausgewiesener Feinheit.",
  schmuck:
    "Alte Ringe, Broschen und Preziosen aus verschiedenen Epochen. Geprüft wird Handwerk und Material, beschrieben wird, was man sieht und wiegt.",
  antiquitaeten:
    "Jedes Stück hier hat schon ein Leben hinter sich. Wir prüfen, ordnen ein und beschreiben ehrlich, mit allen Spuren der Zeit, die dazugehören.",
  sammlerobjekte:
    "Was aus Nachlässen und Sammlungen zu uns findet, wird gesichtet, sortiert und bewertet. Hier liegen die Funde, die es in die Vitrine geschafft haben.",
};

interface PageProps {
  params: { slug: string };
  searchParams: {
    metal?: string;
    sort?: string;
    min?: string;
    max?: string;
    page?: string;
  };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const category = await data.getCategoryBySlug(params.slug);
  if (!category) return {};

  return {
    title: `${category.nameDe} | warehouse14`,
    description:
      category.descriptionDe ??
      `Entdecken Sie unsere Auswahl an ${category.nameDe} bei warehouse14.`,
  };
}

export default async function KategoriePage({ params, searchParams }: PageProps) {
  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1);
  const offset = (page - 1) * LIMIT;

  const [category, categories] = await Promise.all([
    data.getCategoryBySlug(params.slug),
    data.listCategories(),
  ]);

  if (!category) notFound();

  const query: ProductQuery = {
    limit: LIMIT,
    offset,
    category: params.slug,
    metal: searchParams.metal,
    sort: searchParams.sort as ProductQuery["sort"],
    minPriceEur: searchParams.min ? parseFloat(searchParams.min) : undefined,
    maxPriceEur: searchParams.max ? parseFloat(searchParams.max) : undefined,
  };

  const paged = await data.listProducts(query);
  const { items, total } = paged;

  const intro = EDITORIAL_INTRO[category.slug];
  const EngravedIcon = engravedIconBySlug[category.slug];

  return (
    <PageShell>
      {/* Category hero — the editorial opener: Kicker, the engraved plate
          of this world, and the curator's line. Tight on the phone. */}
      <section className="border-b border-rule bg-raised">
        <div className="max-w-edge mx-auto px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
          <div className="flex items-start justify-between gap-5 sm:gap-8">
            <div className="min-w-0">
              <Kicker className="mb-3">Kategorie</Kicker>
              <h1 className="font-display text-3xl font-semibold text-ink sm:text-4xl">{category.nameDe}</h1>
              {/* One intro voice, not two stacked paragraphs: the curated
                  editorial line leads; the seam description only appears for
                  categories without a curated line. */}
              {intro ? (
                <p className="mt-4 max-w-2xl leading-relaxed text-ink-aged">{intro}</p>
              ) : (
                category.descriptionDe && (
                  <p className="mt-4 max-w-2xl leading-relaxed text-ink-aged">
                    {category.descriptionDe}
                  </p>
                )
              )}
            </div>
            {EngravedIcon && (
              <EngravedIcon className="mt-1 h-16 w-16 shrink-0 text-ink/45 sm:h-20 sm:w-20" />
            )}
          </div>
          {category.children.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-2">
              {category.children.map((child) => (
                <a
                  key={child.id}
                  href={`/kategorien/${child.slug}`}
                  className="inline-flex min-h-[44px] items-center rounded-button border border-rule bg-surface px-4 text-sm text-ink-aged transition-colors hover:border-ink/50 hover:text-ink"
                >
                  {child.nameDe}
                </a>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="max-w-edge mx-auto px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        {/* Result count */}
        <div className="mb-6 text-sm text-ink-faded sm:mb-8">
          <span className="tnum font-medium text-ink">{total}</span>{" "}
          {total === 1 ? "Objekt" : "Objekte"} in{" "}
          <span className="font-medium text-ink">{category.nameDe}</span>
        </div>

        {/* 2-column layout */}
        <div className="flex flex-col gap-w14-3 lg:flex-row lg:gap-10">
          <div className="w-full lg:w-64 shrink-0">
            <FacetSidebar
              categories={categories}
              activeCategory={params.slug}
              activeMetal={searchParams.metal}
              activeSort={searchParams.sort}
              activeMin={searchParams.min}
              activeMax={searchParams.max}
            />
          </div>

          <div className="min-w-0 flex-1">
            <ProductGrid products={items} />
            <PaginationBar total={total} limit={LIMIT} currentPage={page} />
          </div>
        </div>
      </div>
    </PageShell>
  );
}
