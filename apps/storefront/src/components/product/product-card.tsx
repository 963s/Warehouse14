import Link from "next/link";
import { ProductImage } from "./product-image";
import { AddToCartButton } from "@/components/cart/add-to-cart-button";
import { WishlistButton } from "@/components/wishlist/wishlist-button";
import { eur, grams, productHref, type ProductSummary } from "@/lib/storefront-data";

/** The one shared catalog card — a framed object in the heritage vitrine.
 * Calm hairline frame, the product photo as hero on matted cream, and one
 * quiet hover change at a time: the card lifts, the image settles in (1.03),
 * the title's gold hairline draws in. The price is a still tabular-nums hero
 * in ink (gold stays reserved for the single eyebrow accent). `priority` flags
 * the first row for LCP eager-loading. Props + data usage are unchanged. */
export function ProductCard({
  product: p,
  priority = false,
}: {
  product: ProductSummary;
  priority?: boolean;
}) {
  const href = productHref(p);
  const meta = [p.metal, p.weightGrams ? grams(p.weightGrams, 2) : null, p.yearMintedFrom ? String(p.yearMintedFrom) : null]
    .filter(Boolean)
    .join(" · ");
  const eyebrow = p.primaryCategory?.nameDe ?? p.metal ?? "Sammlerstück";

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-card border border-rule bg-card shadow-card hover-lift hover:shadow-lift">
      <Link href={href} className="relative block" aria-label={p.name}>
        {/* matted vitrine frame — the piece breathes inside a generous margin */}
        <div className="relative aspect-square overflow-hidden">
          <ProductImage
            image={p.primaryImage}
            className="img-zoom h-full w-full"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
            priority={priority}
          />
        </div>
      </Link>
      <WishlistButton product={p} />

      <div className="flex flex-1 flex-col p-card">
        <div className="eyebrow text-gold">{eyebrow}</div>
        <h3 className="mt-w14-2 font-display text-fluid-h3 font-medium leading-snug line-clamp-2">
          <Link href={href} className="underline-draw transition-colors hover:text-gold-deep">
            {p.name}
          </Link>
        </h3>
        {meta && <div className="mt-w14-1 text-[0.8125rem] text-ink-faded">{meta}</div>}
        <div className="mt-w14-3 flex items-center justify-between gap-w14-2 pt-w14-1">
          <div className="tnum text-fluid-h3 font-medium text-ink">{eur(p.listPriceEur)}</div>
          <AddToCartButton product={p} />
        </div>
      </div>
    </article>
  );
}
