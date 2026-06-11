"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AddToCartButton } from "@/components/cart/add-to-cart-button";
import { eur, type ProductSummary } from "@/lib/storefront-data";

const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * The primary CTA plus its quiet phone companion: once the visitor scrolls
 * PAST the inline "In den Warenkorb" (IntersectionObserver on the wrapper),
 * a calm bottom bar rises — tnum price left, the same add-to-cart action
 * right. Phones only (hidden from sm up), safe-area padding so it never
 * fights the browser chrome. Reduced motion gets a plain fade.
 *
 * The bar renders through a portal on document.body: the page wraps this
 * component in transform-animated Reveals, and a transformed ancestor would
 * otherwise re-anchor position:fixed.
 */
export function StickyBuyBar({
  product,
}: {
  product: Pick<
    ProductSummary,
    "id" | "name" | "slug" | "sku" | "primaryImage" | "listPriceEur"
  >;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [passed, setPassed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    setMounted(true);
    const el = anchorRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => {
        // Only when the CTA has scrolled up and out of view — not while it
        // is still below the fold on first paint.
        setPassed(!entry.isIntersecting && entry.boundingClientRect.bottom < 0);
      },
      { threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const bar = (
    <AnimatePresence>
      {passed && (
        <motion.div
          initial={reduce ? { opacity: 0 } : { y: "110%" }}
          animate={reduce ? { opacity: 1 } : { y: 0 }}
          exit={reduce ? { opacity: 0 } : { y: "110%" }}
          transition={{ duration: 0.38, ease: EASE }}
          className="fixed inset-x-0 bottom-0 z-[70] border-t border-rule bg-card/95 backdrop-blur-sm sm:hidden"
          style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}
        >
          <div className="flex items-center justify-between gap-3 px-4 pt-2.5">
            <div className="min-w-0">
              <div className="text-[0.625rem] uppercase tracking-[0.14em] text-ink-faded">
                Tagespreis
              </div>
              <div className="tnum truncate text-lg font-semibold leading-tight text-ink">
                {eur(product.listPriceEur)}
              </div>
            </div>
            <div className="shrink-0 [&_button]:min-h-[44px] [&_button]:px-5 [&_button]:py-2.5 [&_button]:text-sm">
              <AddToCartButton product={product} full label="In den Warenkorb" />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <>
      {/* the primary, in-flow CTA (the observed anchor) */}
      <div ref={anchorRef}>
        <AddToCartButton product={product} full label="In den Warenkorb" />
      </div>

      {/* the phone companion bar — portaled past any transformed ancestor */}
      {mounted && createPortal(bar, document.body)}
    </>
  );
}
