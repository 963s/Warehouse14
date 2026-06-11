import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { ProductGrid } from "@/components/catalog/product-grid";
import { PaginationBar } from "@/components/catalog/pagination-bar";
import { Kicker } from "@/components/brand/kicker";
import { BrandLoupeSketch } from "@/components/brand/marks";
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
          <Kicker className="mb-2">Suche</Kicker>

          {query ? (
            <>
              <h1 className="break-words font-display text-3xl font-semibold text-ink sm:text-4xl">
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
              <h1 className="font-display text-3xl font-semibold text-ink sm:text-4xl">Suche</h1>
              <p className="mt-3 text-ink-faded">
                Bitte geben Sie einen Suchbegriff ein, um Objekte zu finden.
              </p>
            </>
          )}
        </header>

        {/* Results or empty states — the searching loupe, still looking */}
        {query && total === 0 ? (
          <div className="py-10 text-center sm:py-16">
            <BrandLoupeSketch className="mx-auto mb-6 h-14 w-auto text-ink/40 sm:h-16" />
            <h2 className="font-display text-2xl font-semibold text-ink mb-3">
              Nichts gefunden.
            </h2>
            <p className="text-ink-faded max-w-md mx-auto mb-8">
              Der Bestand wechselt täglich, schauen Sie wieder vorbei. Oder stöbern Sie
              jetzt in der Kollektion.
            </p>
            <Link
              href="/kollektion"
              className="inline-flex min-h-[48px] items-center gap-2 rounded-button bg-ink px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-ink-aged"
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
          <div className="py-10 text-center sm:py-16">
            <BrandLoupeSketch className="mx-auto mb-6 h-14 w-auto text-ink/40 sm:h-16" />
            <p className="text-ink-faded mb-8">
              Durchsuchen Sie Goldmünzen, Barren, Antiquitäten und mehr.
            </p>
            <Link
              href="/kollektion"
              className="inline-flex min-h-[48px] items-center gap-2 rounded-button bg-ink px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-ink-aged"
            >
              Alle Objekte durchstöbern
            </Link>
          </div>
        )}
      </div>
    </PageShell>
  );
}
