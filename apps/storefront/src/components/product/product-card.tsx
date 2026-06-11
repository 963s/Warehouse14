import Link from "next/link";
import { ProductImage } from "./product-image";
import { stampLine } from "./erhaltung";
import { AddToCartButton } from "@/components/cart/add-to-cart-button";
import { WishlistButton } from "@/components/wishlist/wishlist-button";
import { eur, grams, productHref, type ProductSummary } from "@/lib/storefront-data";

/** The one shared catalog card — a jewel-clean framed object.
 * The photo is the hero: it fills the square frame edge-to-edge (no cream
 * matting), so the piece reads present and crisp on a phone. One quiet hover
 * change at a time — the card lifts, the image settles in (1.03), the title's
 * hairline draws in. The price is a still tabular-nums hero in ink; the
 * caption voice stays quiet and neutral. A hairline divides photo from caption.
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
  // stamps lead with the collector's line (MiNr + Erhaltung); metal worlds
  // keep their material · weight · year caption — never both invented
  const meta = [stampLine(p), p.metal, p.weightGrams ? grams(p.weightGrams, 2) : null, p.yearMintedFrom ? String(p.yearMintedFrom) : null]
    .filter(Boolean)
    .join(" · ");
  const eyebrow = p.primaryCategory?.nameDe ?? p.metal ?? "Sammlerstück";

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-card border border-rule bg-card shadow-card hover-lift hover:shadow-lift">
      {/* the gilded stamp edge — a 1px gilt thread along the top, only on hover */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-gilt opacity-0 transition-opacity duration-base ease-hover group-hover:opacity-100 motion-reduce:transition-none"
      />
      <Link href={href} className="relative block" aria-label={p.name}>
        {/* the piece fills the frame — present, crisp, jewel-clean. The square
            aspect is fixed, so the grid never shifts while photos decode. */}
        <div className="relative aspect-square overflow-hidden border-b border-rule">
          <ProductImage
            image={p.primaryImage}
            fit="cover"
            className="img-zoom h-full w-full"
            sizes="(max-width: 1024px) 50vw, 25vw"
            priority={priority}
          />
        </div>
      </Link>
      <WishlistButton product={p} />

      {/* Caption: compact on the 2-up phone grid, generous from sm up */}
      <div className="flex flex-1 flex-col p-3 sm:p-card">
        <div className="eyebrow line-clamp-1">{eyebrow}</div>
        <h3 className="mt-w14-1 font-display text-[0.9375rem] font-medium leading-snug line-clamp-3 sm:mt-w14-2 sm:line-clamp-2 sm:text-fluid-h3">
          <Link href={href} className="underline-draw transition-colors hover:text-ink">
            {p.name}
          </Link>
        </h3>
        {meta && <div className="mt-w14-1 text-xs text-ink-faded sm:text-[0.8125rem]">{meta}</div>}
        {/* Price + action. On a phone the price sits quiet on its own line and
            the add-to-cart is a generous full-width tap target (≥44px); from sm
            up they share one tidy baseline with the compact icon button. */}
        <div className="mt-auto pt-w14-2 sm:pt-w14-3">
          <div className="text-[0.6875rem] uppercase tracking-[0.12em] text-ink-faded">Tagespreis</div>
          {/* flex-wrap + ml-auto instead of justify-between: in narrow card
              widths (the 4-up "Aus derselben Vitrine" strip at xl, where the
              button carries its text label) price + button no longer fit on
              one line — the button then wraps onto its own right-aligned row
              instead of clipping past the card border. */}
          <div className="mt-1 flex flex-wrap items-end gap-x-w14-2 gap-y-2">
            <div className="tnum min-w-0 text-base font-medium leading-none text-ink sm:text-fluid-h3">{eur(p.listPriceEur)}</div>
            <div className="ml-auto hidden sm:block">
              <AddToCartButton product={p} />
            </div>
          </div>
          {/* short label + trimmed padding so the button never wraps at ~170px */}
          <div className="mt-w14-2 sm:hidden [&_button]:min-h-[44px] [&_button]:px-3 [&_button]:py-2.5 [&_button]:text-sm">
            <AddToCartButton product={p} full label="Warenkorb" />
          </div>
        </div>
      </div>
    </article>
  );
}
