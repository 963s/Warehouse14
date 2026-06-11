"use client";

import { useEffect, useRef } from "react";
import { motion, AnimatePresence, MotionConfig } from "framer-motion";
import { X, ShoppingBag, Trash2, ArrowRight, Minus, Plus } from "lucide-react";
import Link from "next/link";
import { useCart } from "./cart-provider";
import { ProductImage } from "@/components/product/product-image";
import { BrandLoupeSketch, BrandRule } from "@/components/brand/marks";
import { eur } from "@/lib/storefront-data";

export function CartDrawer() {
  const { cart, meta, isOpen, closeCart, remove, increase, decrease, mutatingId } = useCart();
  const items = cart?.items ?? [];
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  /* Native-feeling overlay behaviour (mirrors SideMenu): lock the page scroll
   * behind the sheet, close on ESC, keep Tab cycling inside the panel and
   * focus the close button once the slide-in has begun. Restores on close. */
  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => closeRef.current?.focus(), 80);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeCart();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [isOpen, closeCart]);

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              /* explicit rgba: token colors carry no alpha channel, `bg-ink/45` would not compile */
              className="fixed inset-0 z-[85] bg-[rgba(28,28,28,0.45)] backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeCart}
            />
            <motion.aside
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="cart-drawer-title"
              className="fixed inset-y-0 right-0 z-[90] flex w-[min(420px,92vw)] flex-col bg-card shadow-modal"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 36 }}
            >
              <header className="flex items-center justify-between border-b border-rule px-5 py-3">
                <h2 id="cart-drawer-title" className="flex items-center gap-2 font-display text-xl font-semibold">
                  <ShoppingBag aria-hidden="true" className="h-5 w-5 text-ink-aged" strokeWidth={1.7} /> Warenkorb
                </h2>
                <button
                  ref={closeRef}
                  onClick={closeCart}
                  aria-label="Schließen"
                  className="grid h-11 w-11 place-items-center rounded-button text-ink-faded transition-colors hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
                >
                  <X aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.7} />
                </button>
              </header>

              <div className="flex-1 overflow-y-auto overscroll-contain p-5">
                {items.length === 0 ? (
                  /* Composed empty state: the searching loupe, then the invitation */
                  <div className="grid h-full place-items-center text-center">
                    <div className="flex flex-col items-center px-4">
                      <BrandLoupeSketch className="w-24 text-ink" />
                      <p className="mt-4 font-display text-lg font-semibold text-ink">
                        Ihr Warenkorb ist noch leer.
                      </p>
                      <p className="mt-1.5 max-w-[16rem] text-sm leading-relaxed text-ink-aged">
                        Gold, seltene Münzen und geprüfte Antiquitäten warten in der Kollektion.
                      </p>
                      <Link
                        href="/kollektion"
                        onClick={closeCart}
                        className="mt-4 inline-flex min-h-[44px] items-center px-3 text-sm font-semibold text-ink underline underline-offset-4 transition-colors hover:text-ink-aged"
                      >
                        Kollektion entdecken
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div className="flex min-h-full flex-col">
                    <ul className="space-y-3">
                    {items.map((it) => {
                      const m = meta[it.productId];
                      const busy = mutatingId === it.id;
                      return (
                        <li key={it.id} className="rounded-card border border-rule bg-surface p-3">
                          <div className="flex items-start gap-3">
                            <Link href={m?.href ?? "#"} onClick={closeCart} className="shrink-0">
                              <ProductImage image={m?.image ?? null} className="h-16 w-16 rounded-button" emojiClassName="text-2xl" />
                            </Link>
                            <div className="min-w-0 flex-1">
                              <Link href={m?.href ?? "#"} onClick={closeCart} className="line-clamp-2 font-medium leading-snug text-ink hover:underline">
                                {m?.name ?? "Artikel"}
                              </Link>
                              {/* unit price only when it differs from the line total */}
                              {it.quantity > 1 && (
                                <div className="tnum mt-0.5 text-sm text-ink-faded">
                                  {it.quantity} × {eur(it.unitPriceEur)}
                                </div>
                              )}
                            </div>
                            <span className="tnum shrink-0 pt-0.5 text-sm font-semibold text-ink">
                              {eur((parseFloat(it.unitPriceEur) * it.quantity).toFixed(2))}
                            </span>
                          </div>
                          {/* Quantity stepper + remove: every control is a 44px touch target */}
                          <div className="mt-2 flex items-center justify-between">
                            <div className="inline-flex items-center rounded-button border border-rule bg-card">
                              <button
                                onClick={() => decrease(it)}
                                disabled={busy}
                                aria-label={it.quantity <= 1 ? "Artikel entfernen" : "Menge verringern"}
                                className="grid h-11 w-11 place-items-center rounded-l-button text-ink-aged transition-colors hover:bg-raised hover:text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-inset"
                              >
                                <Minus aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.7} />
                              </button>
                              <span aria-live="polite" className="tnum min-w-[2.25rem] text-center text-sm font-semibold text-ink">
                                {it.quantity}
                              </span>
                              <button
                                onClick={() => increase(it)}
                                disabled={busy}
                                aria-label="Menge erhöhen"
                                className="grid h-11 w-11 place-items-center rounded-r-button text-ink-aged transition-colors hover:bg-raised hover:text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-inset"
                              >
                                <Plus aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.7} />
                              </button>
                            </div>
                            <button
                              onClick={() => remove(it.id)}
                              disabled={busy}
                              aria-label="Entfernen"
                              className="grid h-11 w-11 shrink-0 place-items-center rounded-button text-ink-faded transition-colors hover:text-wax-red disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
                            >
                              <Trash2 aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.7} />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                    </ul>
                    {/* gilt thread closes the list, a short cart still reads composed */}
                    <div aria-hidden="true" className="mt-auto flex justify-center pt-8">
                      <BrandRule className="w-24 text-gilt" />
                    </div>
                  </div>
                )}
              </div>

              {items.length > 0 && cart && (
                <footer className="border-t border-rule p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
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
                    className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-button bg-ink px-5 py-3.5 font-semibold text-white shadow-card transition-transform hover:-translate-y-0.5"
                  >
                    Zur Kasse <ArrowRight aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.7} />
                  </Link>
                  <Link
                    href="/warenkorb"
                    onClick={closeCart}
                    className="mt-1 flex min-h-[44px] w-full items-center justify-center text-sm font-medium text-ink-aged underline underline-offset-4 transition-colors hover:text-ink"
                  >
                    Warenkorb ansehen
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
