"use client";

import Link from "next/link";
import { Heart } from "lucide-react";
import { ProductCard } from "@/components/product/product-card";
import { useWishlist } from "@/components/wishlist/wishlist-provider";
import type { ProductSummary } from "@/lib/storefront-data";

/** Client component: reads wishlist state and renders the grid or empty state. */
export function MerklisteClient() {
  const { items } = useWishlist();

  return (
    <div className="mx-auto max-w-edge px-5 py-16">
      <h1 className="font-display text-3xl font-semibold text-ink">Merkliste</h1>
      <p className="mt-2 text-sm text-ink-faded">
        {items.length > 0
          ? `${items.length} ${items.length === 1 ? "gespeichertes Stück" : "gespeicherte Stücke"}`
          : "Ihre gespeicherten Stücke erscheinen hier."}
      </p>

      {items.length === 0 ? (
        <div className="mt-20 flex flex-col items-center gap-6 text-center">
          <span className="grid h-20 w-20 place-items-center rounded-full bg-card shadow-card">
            <Heart aria-hidden="true" className="h-9 w-9 text-ink-faded" />
          </span>
          <div>
            <p className="font-display text-xl font-semibold text-ink">
              Noch keine Stücke gespeichert
            </p>
            <p className="mt-2 max-w-xs text-sm text-ink-faded">
              Klicken Sie auf das Herz-Symbol bei einem Artikel, um ihn auf der
              Merkliste zu speichern.
            </p>
          </div>
          <Link
            href="/kollektion"
            className="inline-flex min-h-[44px] items-center rounded-button bg-ink px-6 py-2.5 text-sm font-semibold text-white shadow-card transition-transform hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
          >
            Zur Kollektion
          </Link>
        </div>
      ) : (
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((snap) => (
            <ProductCard key={snap.id} product={snap as ProductSummary} />
          ))}
        </div>
      )}
    </div>
  );
}
