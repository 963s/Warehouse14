import { FacetSidebar } from '@/components/catalog/facet-sidebar';
import { PaginationBar } from '@/components/catalog/pagination-bar';
import { ProductGrid } from '@/components/catalog/product-grid';
import { PageShell } from '@/components/page-shell';
import { data } from '@/lib/storefront-data';
import type { ProductQuery } from '@/lib/storefront-data';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Kollektion | warehouse14',
  description:
    'Entdecken Sie unsere gesamte Kollektion: Goldmunzen, Goldbarren, Silber, Platin, historische Munzen, Antiquitaten, Schmuck und mehr.',
};

const LIMIT = 12;

interface PageProps {
  searchParams: {
    category?: string;
    metal?: string;
    sort?: string;
    min?: string;
    max?: string;
    q?: string;
    page?: string;
  };
}

export default async function KollektionPage({ searchParams }: PageProps) {
  const page = Math.max(1, Number.parseInt(searchParams.page ?? '1', 10) || 1);
  const offset = (page - 1) * LIMIT;

  const query: ProductQuery = {
    limit: LIMIT,
    offset,
    category: searchParams.category,
    metal: searchParams.metal,
    sort: searchParams.sort as ProductQuery['sort'],
    minPriceEur: searchParams.min ? Number.parseFloat(searchParams.min) : undefined,
    maxPriceEur: searchParams.max ? Number.parseFloat(searchParams.max) : undefined,
    q: searchParams.q,
  };

  const [paged, categories] = await Promise.all([data.listProducts(query), data.listCategories()]);

  const { items, total } = paged;

  const hasActiveSearch = !!(
    searchParams.q ||
    searchParams.category ||
    searchParams.metal ||
    searchParams.min ||
    searchParams.max
  );

  return (
    <PageShell>
      <div className="max-w-edge mx-auto px-4 py-w14-5 sm:px-6 lg:px-8">
        {/* Page header */}
        <header className="mb-w14-4 border-b border-rule pb-w14-4">
          <p className="eyebrow mb-w14-1 text-gold">warehouse14</p>
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
        <div className="flex flex-col gap-w14-4 lg:flex-row lg:gap-w14-5">
          {/* Sidebar */}
          <div className="w-full lg:w-64 shrink-0">
            <FacetSidebar
              categories={categories}
              activeCategory={searchParams.category}
              activeMetal={searchParams.metal}
              activeSort={searchParams.sort}
              activeMin={searchParams.min}
              activeMax={searchParams.max}
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
