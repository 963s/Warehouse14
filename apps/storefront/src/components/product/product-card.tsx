import Link from "next/link";
import { ProductImage } from "./product-image";
import { AddToCartButton } from "@/components/cart/add-to-cart-button";
import { WishlistButton } from "@/components/wishlist/wishlist-button";
import { eur, grams, productHref, type ProductSummary } from "@/lib/storefront-data";

/** The one shared catalog card — a jewel-clean framed object.
 * The photo is the hero: it fills the square frame edge-to-edge (no cream
 * matting), so the piece reads present and crisp on a phone. One quiet hover
 * change at a time — the card lifts, the image settles in (1.03), the title's
 * hairline draws in. The price is a still tabular-nums hero in ink; gold stays
 * reserved for the single eyebrow accent. A hairline divides photo from caption.
 * `priority` flags the first row for LCP eager-loading. Props + data usage are
 * unchanged. */
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
        {/* the piece fills the frame — present, crisp, jewel-clean */}
        <div className="relative aspect-square overflow-hidden border-b border-rule">
          <ProductImage
            image={p.primaryImage}
            fit="cover"
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
        {/* Price + action. On a phone the price sits quiet on its own line and
            the add-to-cart is a generous full-width tap target (≥44px); from sm
            up they share one tidy baseline with the compact icon button. */}
        <div className="mt-auto pt-w14-3">
          <div className="text-[0.6875rem] uppercase tracking-[0.12em] text-ink-faded">Tagespreis</div>
          <div className="mt-1 flex items-end justify-between gap-w14-2">
            <div className="tnum text-fluid-h3 font-medium leading-none text-ink">{eur(p.listPriceEur)}</div>
            <div className="hidden sm:block">
              <AddToCartButton product={p} />
            </div>
          </div>
          <div className="mt-w14-2 sm:hidden">
            <AddToCartButton product={p} full label="In den Warenkorb" />
          </div>
        </div>
      </div>
    </article>
  );
}
