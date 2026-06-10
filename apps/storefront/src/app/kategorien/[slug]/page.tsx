import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { ProductGrid } from "@/components/catalog/product-grid";
import { FacetSidebar } from "@/components/catalog/facet-sidebar";
import { PaginationBar } from "@/components/catalog/pagination-bar";
import { data } from "@/lib/storefront-data";
import type { ProductQuery } from "@/lib/storefront-data";

const LIMIT = 12;

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

  return (
    <PageShell>
      {/* Category hero */}
      <section className="border-b border-rule bg-raised">
        <div className="max-w-edge mx-auto px-4 py-14 sm:px-6 lg:px-8">
          <div className="smallcaps mb-3 text-xs font-semibold tracking-widest text-gold">
            Kategorie
          </div>
          <h1 className="font-display text-4xl font-semibold text-ink">{category.nameDe}</h1>
          {category.descriptionDe && (
            <p className="mt-4 max-w-2xl text-ink-faded leading-relaxed">
              {category.descriptionDe}
            </p>
          )}
          {category.children.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-2">
              {category.children.map((child) => (
                <a
                  key={child.id}
                  href={`/kategorien/${child.slug}`}
                  className="rounded-button border border-rule bg-surface px-3.5 py-1.5 text-sm text-ink-aged transition-colors hover:border-gold hover:text-gold"
                >
                  {child.nameDe}
                </a>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="max-w-edge mx-auto px-4 py-12 sm:px-6 lg:px-8">
        {/* Result count */}
        <div className="mb-8 text-sm text-ink-faded">
          <span className="tnum font-medium text-ink">{total}</span>{" "}
          {total === 1 ? "Objekt" : "Objekte"} in{" "}
          <span className="font-medium text-ink">{category.nameDe}</span>
        </div>

        {/* 2-column layout */}
        <div className="flex flex-col gap-8 lg:flex-row lg:gap-10">
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
