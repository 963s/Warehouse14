import { BrandLoupeSketch } from '@/components/brand/marks';
import { ProductCard } from '@/components/product/product-card';
import { Reveal } from '@/components/ui/reveal';
import type { ProductSummary } from '@/lib/storefront-data';

interface ProductGridProps {
  products: ProductSummary[];
}

/** Server component: renders a serene, responsive grid of ProductCards.
 *  2-up already on the phone (faster scanning, less scrolling), 3-up from lg.
 *  Cards rise in a calm staggered cascade as the section scrolls into view.
 *  The empty state is the house gesture: the searching loupe, still looking. */
export function ProductGrid({ products }: ProductGridProps) {
  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-w14-5 text-center sm:py-w14-7">
        <BrandLoupeSketch className="mb-w14-3 h-14 w-auto text-ink/40 sm:h-16" />
        <h2 className="font-display text-fluid-h3 font-medium text-ink">Nichts gefunden.</h2>
        <p className="measure mt-w14-2 text-fluid-body text-ink-faded">
          Der Bestand wechselt täglich, schauen Sie wieder vorbei.
        </p>
      </div>
    );
  }

  /* A lone result would strand in the left column of the 2-up grid. Compose
     it instead: one centered card under a max-w constraint, so the single
     piece reads intentional, like the last object in the vitrine. */
  if (products.length === 1) {
    return (
      <div className="mx-auto w-full max-w-sm">
        <Reveal>
          <ProductCard product={products[0]} priority />
        </Reveal>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-w14-2 sm:gap-w14-4 lg:grid-cols-3">
      {/* Reveal gets h-full so every card stretches to the row height and the
          price/CTA foot (mt-auto inside the card) sits on one shared baseline */}
      {products.map((product, i) => (
        <Reveal key={product.id} delay={Math.min(i * 0.07, 0.35)} className="h-full">
          <ProductCard product={product} priority={i < 4} />
        </Reveal>
      ))}
    </div>
  );
}
