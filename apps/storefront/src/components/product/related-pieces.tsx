import { data } from "@/lib/storefront-data";
import { ProductCard } from "@/components/product/product-card";
import { Kicker } from "@/components/brand/kicker";
import { Reveal } from "@/components/ui/reveal";

/**
 * "Aus derselben Vitrine" — up to four further pieces from the same
 * category, rendered through the one sacred ProductCard frame. Server
 * component; fetches via the seam and renders nothing when the vitrine
 * holds no other piece.
 */
export async function RelatedPieces({
  categorySlug,
  categoryName,
  excludeId,
}: {
  categorySlug: string;
  categoryName: string;
  excludeId: string;
}) {
  const paged = await data.listProducts({ category: categorySlug, limit: 5 });
  const items = paged.items.filter((p) => p.id !== excludeId).slice(0, 4);

  if (items.length === 0) return null;

  return (
    <section aria-label="Aus derselben Vitrine" className="mt-14 border-t border-rule pt-10 sm:mt-16 sm:pt-12">
      <Reveal>
        <Kicker className="mb-2">{categoryName}</Kicker>
        <h2 className="font-display text-2xl font-semibold text-ink sm:text-3xl">
          Aus derselben Vitrine
        </h2>
      </Reveal>

      <div className="mt-6 grid grid-cols-2 gap-w14-2 sm:mt-8 sm:gap-w14-4 lg:grid-cols-4">
        {items.map((product, i) => (
          <Reveal key={product.id} delay={Math.min(i * 0.07, 0.28)} className="h-full">
            <ProductCard product={product} />
          </Reveal>
        ))}
      </div>
    </section>
  );
}
