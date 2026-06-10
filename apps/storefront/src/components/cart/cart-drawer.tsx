"use client";

import { useEffect } from "react";
import { motion, AnimatePresence, MotionConfig } from "framer-motion";
import { X, ShoppingBag, Trash2, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useCart } from "./cart-provider";
import { ProductImage } from "@/components/product/product-image";
import { eur } from "@/lib/storefront-data";

export function CartDrawer() {
  const { cart, meta, isOpen, closeCart, remove } = useCart();
  const items = cart?.items ?? [];

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeCart();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, closeCart]);

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-[85] bg-ink/45 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeCart}
            />
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-labelledby="cart-drawer-title"
              className="fixed inset-y-0 right-0 z-[90] flex w-[min(420px,92vw)] flex-col bg-card shadow-modal"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 36 }}
            >
              <header className="flex items-center justify-between border-b border-rule px-5 py-4">
                <h2 id="cart-drawer-title" className="flex items-center gap-2 font-display text-xl font-semibold">
                  <ShoppingBag aria-hidden="true" className="h-5 w-5 text-gold" /> Warenkorb
                </h2>
                <button
                  onClick={closeCart}
                  aria-label="Schließen"
                  className="grid h-9 w-9 place-items-center rounded-button text-ink-faded transition-colors hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2"
                >
                  <X aria-hidden="true" className="h-[18px] w-[18px]" />
                </button>
              </header>

              <div className="flex-1 overflow-y-auto overscroll-contain p-5">
                {items.length === 0 ? (
                  <div className="grid h-full place-items-center text-center text-ink-faded">
                    <div>
                      <ShoppingBag aria-hidden="true" className="mx-auto h-10 w-10 opacity-40" />
                      <p className="mt-3">Ihr Warenkorb ist noch leer.</p>
                      <Link href="/kollektion" onClick={closeCart} className="mt-4 inline-block text-sm font-semibold text-gold hover:underline">
                        Kollektion entdecken
                      </Link>
                    </div>
                  </div>
                ) : (
                  <ul className="space-y-3">
                    {items.map((it) => {
                      const m = meta[it.productId];
                      return (
                        <li key={it.id} className="flex items-center gap-3 rounded-card border border-rule bg-surface p-3">
                          <Link href={m?.href ?? "#"} onClick={closeCart} className="shrink-0">
                            <ProductImage image={m?.image ?? null} className="h-16 w-16 rounded-button" emojiClassName="text-2xl" />
                          </Link>
                          <div className="min-w-0 flex-1">
                            <Link href={m?.href ?? "#"} onClick={closeCart} className="block truncate font-medium text-ink hover:text-gold">
                              {m?.name ?? "Artikel"}
                            </Link>
                            <div className="tnum text-sm text-ink-faded">
                              {it.quantity} × {eur(it.unitPriceEur)}
                            </div>
                          </div>
                          <button
                            onClick={() => remove(it.id)}
                            aria-label="Entfernen"
                            className="grid h-8 w-8 shrink-0 place-items-center rounded-button text-ink-faded transition-colors hover:text-wax-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2"
                          >
                            <Trash2 aria-hidden="true" className="h-[18px] w-[18px]" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {items.length > 0 && cart && (
                <footer className="border-t border-rule p-5">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-ink-aged">Zwischensumme</span>
                    <span className="tnum font-display text-xl font-semibold">{eur(cart.totalEur)}</span>
                  </div>
                  <p className="mb-3 text-xs text-ink-faded">
                    inkl. MwSt., ggf. Differenzbesteuerung. Versand wird im nächsten Schritt berechnet.
                  </p>
                  <Link
                    href="/kasse"
                    onClick={closeCart}
                    className="bg-gold-gradient flex w-full items-center justify-center gap-2 rounded-button px-5 py-3.5 font-semibold text-[#2b210a] shadow-gold transition-transform hover:-translate-y-0.5"
                  >
                    Zur Kasse <ArrowRight aria-hidden="true" className="h-[18px] w-[18px]" />
                  </Link>
                </footer>
              )}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}
