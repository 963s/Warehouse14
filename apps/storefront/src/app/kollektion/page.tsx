import { Kicker } from '@/components/brand/kicker';
import { FacetSidebar } from '@/components/catalog/facet-sidebar';
import { PaginationBar } from '@/components/catalog/pagination-bar';
import { ProductGrid } from '@/components/catalog/product-grid';
import { PageShell } from '@/components/page-shell';
import { erhaltungFromParam } from '@/components/product/erhaltung';
import { data } from '@/lib/storefront-data';
import type { ProductQuery } from '@/lib/storefront-data';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Kollektion | warehouse14',
  description:
    'Entdecken Sie unsere gesamte Kollektion: Goldmünzen, Goldbarren, Silber, Platin, historische Münzen, Antiquitäten, Schmuck und mehr.',
};

const LIMIT = 12;

interface PageProps {
  searchParams: {
    /** `kategorie` is the canonical param; `category` stays as an alias. */
    kategorie?: string;
    category?: string;
    metal?: string;
    sort?: string;
    min?: string;
    max?: string;
    erhaltung?: string;
    minrVon?: string;
    minrBis?: string;
    q?: string;
    page?: string;
  };
}

/** Parse a positive integer URL param; anything else → undefined. */
function intParam(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export default async function KollektionPage({ searchParams }: PageProps) {
  const page = Math.max(1, Number.parseInt(searchParams.page ?? '1', 10) || 1);
  const offset = (page - 1) * LIMIT;
  const category = searchParams.kategorie ?? searchParams.category;

  const query: ProductQuery = {
    limit: LIMIT,
    offset,
    category,
    metal: searchParams.metal,
    sort: searchParams.sort as ProductQuery['sort'],
    minPriceEur: searchParams.min ? Number.parseFloat(searchParams.min) : undefined,
    maxPriceEur: searchParams.max ? Number.parseFloat(searchParams.max) : undefined,
    erhaltung: erhaltungFromParam(searchParams.erhaltung),
    minrVon: intParam(searchParams.minrVon),
    minrBis: intParam(searchParams.minrBis),
    q: searchParams.q,
  };

  const [paged, categories] = await Promise.all([data.listProducts(query), data.listCategories()]);

  const { items, total } = paged;

  const hasActiveSearch = !!(
    searchParams.q ||
    category ||
    searchParams.metal ||
    searchParams.min ||
    searchParams.max ||
    searchParams.erhaltung ||
    searchParams.minrVon ||
    searchParams.minrBis
  );

  return (
    <PageShell>
      <div className="max-w-edge mx-auto px-4 py-w14-4 sm:px-6 sm:py-w14-5 lg:px-8">
        {/* Page header */}
        <header className="mb-w14-3 border-b border-rule pb-w14-3 sm:mb-w14-4 sm:pb-w14-4">
          <Kicker className="mb-w14-1">warehouse14</Kicker>
          <h1 className="font-display text-fluid-h1 font-medium text-ink">Kollektion</h1>
          {searchParams.q ? (
            <p className="mt-w14-2 text-fluid-body text-ink-faded">
              Suchergebnisse für{' '}
              <span className="font-medium text-ink">&bdquo;{searchParams.q}&ldquo;</span> &middot;{' '}
              <span className="tnum">
                {total} {total === 1 ? 'Objekt' : 'Objekte'}
              </span>
            </p>
          ) : (
            <p className="mt-w14-2 text-fluid-body text-ink-faded">
              {total === 0 ? (
                'Keine Objekte gefunden'
              ) : (
                <span className="tnum">
                  {total} {total === 1 ? 'Objekt' : 'Objekte'}
                  {hasActiveSearch && ' (gefiltert)'}
                </span>
              )}
            </p>
          )}
        </header>

        {/* 2-column layout: sidebar + grid */}
        <div className="flex flex-col gap-w14-3 lg:flex-row lg:gap-w14-5">
          {/* Sidebar */}
          <div className="w-full lg:w-64 shrink-0">
            <FacetSidebar
              categories={categories}
              activeCategory={category}
              activeMetal={searchParams.metal}
              activeSort={searchParams.sort}
              activeMin={searchParams.min}
              activeMax={searchParams.max}
              activeErhaltung={searchParams.erhaltung}
              activeMinrVon={searchParams.minrVon}
              activeMinrBis={searchParams.minrBis}
            />
          </div>

          {/* Main grid */}
          <div className="min-w-0 flex-1">
            <ProductGrid products={items} />
            <PaginationBar total={total} limit={LIMIT} currentPage={page} />
          </div>
        </div>
      </div>
    </PageShell>
  );
}
