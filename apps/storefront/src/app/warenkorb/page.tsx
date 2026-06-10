"use client";

import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { ProductImage } from "@/components/product/product-image";
import { useCart } from "@/components/cart/cart-provider";
import { eur } from "@/lib/storefront-data";

export default function WarenkorbPage() {
  const { cart, meta, remove } = useCart();

  // cart===null means the async fetch hasn't resolved yet; avoid flashing empty-state
  const isLoading = cart === null;
  const isEmpty = !isLoading && cart.items.length === 0;

  return (
    <PageShell>
      <div className="max-w-edge mx-auto px-4 py-12 sm:px-6 lg:px-8">
        {/* Page title */}
        <h1 className="font-display text-3xl font-semibold text-ink mb-10">Warenkorb</h1>

        {isLoading ? (
          /* Loading skeleton — prevents empty-state flash during hydration */
          <div aria-busy="true" role="status" className="flex flex-col gap-4 py-10">
            {[1, 2].map((n) => (
              <div key={n} className="flex gap-4 rounded-card border border-rule bg-card p-5 shadow-card animate-pulse">
                <div className="h-24 w-24 shrink-0 rounded-card bg-rule" />
                <div className="flex flex-1 flex-col gap-3 py-1">
                  <div className="h-4 w-2/3 rounded bg-rule" />
                  <div className="h-3 w-1/3 rounded bg-rule" />
                </div>
              </div>
            ))}
          </div>
        ) : isEmpty ? (
          /* Empty state */
          <div className="flex flex-col items-center gap-6 py-24 text-center">
            <span className="text-7xl select-none">🛒</span>
            <p className="text-ink-aged text-lg leading-relaxed max-w-sm">
              Ihr Warenkorb ist noch leer. Entdecken Sie unsere Kollektion aus Gold, seltenen Münzen
              und geprüften Antiquitäten.
            </p>
            <Link
              href="/kollektion"
              className="mt-2 inline-flex items-center gap-2 rounded-button bg-gold-gradient px-6 py-3 text-sm font-semibold text-white shadow-card transition-opacity hover:opacity-90"
            >
              Zur Kollektion
            </Link>
          </div>
        ) : (
          /* Two-column layout */
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_360px]">
            {/* ── Left: line items ── */}
            <section aria-label="Artikel im Warenkorb">
              <ul className="divide-y divide-rule">
                {cart.items.map((item) => {
                  const m = meta[item.productId];
                  return (
                    <li
                      key={item.id}
                      className="flex gap-4 py-6 sm:gap-6"
                    >
                      {/* Thumbnail */}
                      <Link
                        href={m?.href ?? "#"}
                        className="shrink-0 rounded-card overflow-hidden shadow-card ring-1 ring-rule focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                        tabIndex={m?.href ? 0 : -1}
                        aria-label={m?.name ?? "Produkt ansehen"}
                      >
                        <ProductImage
                          image={m?.image ?? null}
                          className="h-24 w-24 sm:h-28 sm:w-28"
                          emojiClassName="text-4xl sm:text-5xl"
                          sizes="112px"
                        />
                      </Link>

                      {/* Details */}
                      <div className="flex flex-1 flex-col justify-between gap-2 min-w-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            {m?.href ? (
                              <Link
                                href={m.href}
                                className="font-display text-base font-semibold text-ink hover:text-gold transition-colors line-clamp-2 leading-snug"
                              >
                                {m?.name ?? "Artikel"}
                              </Link>
                            ) : (
                              <span className="font-display text-base font-semibold text-ink line-clamp-2 leading-snug">
                                {m?.name ?? "Artikel"}
                              </span>
                            )}
                            <p className="mt-1 text-sm text-ink-faded tnum">
                              {item.quantity} &times;{" "}
                              <span className="text-ink-aged font-medium">
                                {eur(item.unitPriceEur)}
                              </span>
                            </p>
                          </div>

                          {/* Line total */}
                          <span className="shrink-0 tnum text-base font-semibold text-ink tabular-nums">
                            {eur(
                              (
                                parseFloat(item.unitPriceEur) * item.quantity
                              ).toFixed(2),
                            )}
                          </span>
                        </div>

                        {/* Remove button */}
                        <div className="flex items-center">
                          <button
                            type="button"
                            onClick={() => remove(item.id)}
                            className="text-xs text-ink-faded underline underline-offset-2 hover:text-gold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold rounded"
                            aria-label={`${m?.name ?? "Artikel"} entfernen`}
                          >
                            Entfernen
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {/* Back to collection link */}
              <div className="mt-6">
                <Link
                  href="/kollektion"
                  className="text-sm text-ink-faded hover:text-gold transition-colors underline underline-offset-2"
                >
                  Weiter einkaufen
                </Link>
              </div>
            </section>

            {/* ── Right: order summary ── */}
            <aside aria-label="Bestellzusammenfassung">
              <div className="rounded-card border border-rule bg-card p-6 shadow-card sticky top-6">
                <h2 className="font-display text-xl font-semibold text-ink mb-6">
                  Zusammenfassung
                </h2>

                <dl className="space-y-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-ink-aged">Zwischensumme</dt>
                    <dd className="tnum font-semibold text-ink tabular-nums">
                      {eur(cart.totalEur)}
                    </dd>
                  </div>

                  <div className="flex justify-between gap-4">
                    <dt className="text-ink-aged">Versand</dt>
                    <dd className="text-ink-faded">wird berechnet</dd>
                  </div>
                </dl>

                {/* Hairline divider */}
                <div className="my-5 border-t border-rule" />

                {/* VAT and shipping note */}
                <p className="text-xs text-ink-faded leading-relaxed mb-6">
                  Preise inkl. gesetzlicher MwSt. (sofern anwendbar). Versandkosten
                  und eventuelle Gebühren werden im Kassiervorgang ausgewiesen.
                  Edelmetallmünzen und Barren ggf. nach §25a UStG differenzbesteuert.
                </p>

                {/* Checkout CTA */}
                <Link
                  href="/kasse"
                  className="block w-full rounded-button bg-gold-gradient px-6 py-3.5 text-center text-sm font-semibold text-white shadow-card transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ring-gold-soft"
                >
                  Zur Kasse
                </Link>
              </div>
            </aside>
          </div>
        )}
      </div>
    </PageShell>
  );
}
