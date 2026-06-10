import { ProductCard } from '@/components/product/product-card';
import { Reveal } from '@/components/ui/reveal';
import type { ProductSummary } from '@/lib/storefront-data';

interface ProductGridProps {
  products: ProductSummary[];
}

/** Server component: renders a serene, responsive grid of ProductCards.
 *  Cards rise in a calm staggered cascade as the section scrolls into view. */
export function ProductGrid({ products }: ProductGridProps) {
  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-w14-7 text-center">
        <span aria-hidden="true" className="mb-w14-3 block h-px w-16 origin-center bg-gold/60" />
        <h2 className="font-display text-fluid-h3 font-medium text-ink">Keine Objekte gefunden</h2>
        <p className="measure mt-w14-2 text-fluid-body text-ink-faded">
          Für Ihre Auswahl sind derzeit keine Objekte verfügbar. Bitte passen Sie Ihre Filter an
          oder schauen Sie zu einem späteren Zeitpunkt erneut vorbei.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-w14-3 sm:grid-cols-2 sm:gap-w14-4 lg:grid-cols-3">
      {products.map((product, i) => (
        <Reveal key={product.id} delay={Math.min(i * 0.07, 0.35)}>
          <ProductCard product={product} priority={i < 3} />
        </Reveal>
      ))}
    </div>
  );
}
