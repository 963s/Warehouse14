import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { ProductGrid } from "@/components/catalog/product-grid";
import { PaginationBar } from "@/components/catalog/pagination-bar";
import { data } from "@/lib/storefront-data";

export const metadata: Metadata = {
  title: "Suche | warehouse14",
  description: "Durchsuchen Sie die gesamte Kollektion von warehouse14.",
  robots: { index: false },
};

const LIMIT = 12;

interface PageProps {
  searchParams: {
    q?: string;
    page?: string;
  };
}

export default async function SuchePage({ searchParams }: PageProps) {
  const query = searchParams.q?.trim() ?? "";
  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1);
  const offset = (page - 1) * LIMIT;

  const paged = query
    ? await data.listProducts({ q: query, limit: LIMIT, offset })
    : { items: [], total: 0, limit: LIMIT, offset: 0 };

  const { items, total } = paged;

  return (
    <PageShell>
      <div className="max-w-edge mx-auto px-4 py-12 sm:px-6 lg:px-8">
        {/* Search header */}
        <header className="mb-10 border-b border-rule pb-8">
          <div className="smallcaps mb-2 text-xs font-semibold tracking-widest text-gold">
            Suche
          </div>

          {query ? (
            <>
              <h1 className="font-display text-4xl font-semibold text-ink">
                &bdquo;{query}&ldquo;
              </h1>
              <p className="mt-3 text-ink-faded">
                {total === 0 ? (
                  "Keine Ergebnisse gefunden."
                ) : (
                  <>
                    <span className="tnum font-medium text-ink">{total}</span>{" "}
                    {total === 1 ? "Ergebnis" : "Ergebnisse"} gefunden
                  </>
                )}
              </p>
            </>
          ) : (
            <>
              <h1 className="font-display text-4xl font-semibold text-ink">Suche</h1>
              <p className="mt-3 text-ink-faded">
                Bitte geben Sie einen Suchbegriff ein, um Objekte zu finden.
              </p>
            </>
          )}
        </header>

        {/* Results or empty states */}
        {query && total === 0 ? (
          <div className="py-16 text-center">
            <div className="mx-auto mb-6 grid h-16 w-16 place-items-center rounded-full bg-raised text-gold">
              <Search className="h-7 w-7" aria-hidden="true" />
            </div>
            <h2 className="font-display text-2xl font-semibold text-ink mb-3">
              Keine Treffer fur &bdquo;{query}&ldquo;
            </h2>
            <p className="text-ink-faded max-w-md mx-auto mb-8">
              Versuchen Sie einen anderen Suchbegriff oder stobern Sie in unserer Kollektion.
            </p>
            <Link
              href="/kollektion"
              className="inline-flex items-center gap-2 rounded-button bg-ink px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-gold hover:text-[#2b210a]"
            >
              Zur Kollektion
            </Link>
          </div>
        ) : query ? (
          <>
            <ProductGrid products={items} />
            <PaginationBar total={total} limit={LIMIT} currentPage={page} />
          </>
        ) : (
          /* No query: show a prompt to browse */
          <div className="py-16 text-center">
            <div className="mx-auto mb-6 grid h-16 w-16 place-items-center rounded-full bg-raised text-gold">
              <Search className="h-7 w-7" aria-hidden="true" />
            </div>
            <p className="text-ink-faded mb-8">
              Durchsuchen Sie Goldmunzen, Barren, Antiquitaten und mehr.
            </p>
            <Link
              href="/kollektion"
              className="inline-flex items-center gap-2 rounded-button bg-ink px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-gold hover:text-[#2b210a]"
            >
              Alle Objekte durchstobern
            </Link>
          </div>
        )}
      </div>
    </PageShell>
  );
}
