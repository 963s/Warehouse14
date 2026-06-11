"use client";

import Link from "next/link";
import { ArrowRight, Minus, Plus, Trash2 } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { ProductImage } from "@/components/product/product-image";
import { BrandLoupeSketch } from "@/components/brand/marks";
import { Kicker } from "@/components/brand/kicker";
import { useCart } from "@/components/cart/cart-provider";
import { eur } from "@/lib/storefront-data";

export default function WarenkorbPage() {
  const { cart, meta, count, remove, increase, decrease, mutatingId } = useCart();

  // cart===null means the async fetch hasn't resolved yet; avoid flashing empty-state
  const isLoading = cart === null;
  const isEmpty = !isLoading && cart.items.length === 0;

  return (
    <PageShell>
      <div className="max-w-edge mx-auto px-4 py-12 sm:px-6 lg:px-8">
        {/* Page opener */}
        <Kicker className="mb-3">Ihre Auswahl</Kicker>
        <div className="mb-10 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="font-display text-3xl font-semibold text-ink md:text-4xl">Warenkorb</h1>
          {!isLoading && !isEmpty && (
            <p className="tnum text-sm text-ink-faded">{count} Artikel</p>
          )}
        </div>

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
          /* Composed empty state: the searching loupe, then the invitation */
          <div className="flex flex-col items-center gap-5 py-16 text-center">
            <BrandLoupeSketch className="w-28 text-ink sm:w-32" />
            <p className="max-w-sm text-lg leading-relaxed text-ink-aged">
              Ihr Warenkorb ist noch leer. Entdecken Sie unsere Kollektion aus Gold, seltenen Münzen
              und geprüften Antiquitäten.
            </p>
            <Link
              href="/kollektion"
              className="mt-1 inline-flex min-h-[48px] items-center gap-2 rounded-button bg-ink px-6 py-3 text-sm font-semibold text-white shadow-card transition-opacity hover:opacity-90"
            >
              Zur Kollektion
            </Link>
          </div>
        ) : (
          /* Two-column layout */
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_360px]">
            {/* ── Left: line items ── */}
            <section aria-label="Artikel im Warenkorb">
              <ul className="divide-y divide-rule border-y border-rule">
                {cart.items.map((item) => {
                  const m = meta[item.productId];
                  const busy = mutatingId === item.id;
                  return (
                    <li key={item.id} className="flex gap-4 py-6 sm:gap-6">
                      {/* Thumbnail — the unified frame: hairline ring on card */}
                      <Link
                        href={m?.href ?? "#"}
                        className="shrink-0 overflow-hidden rounded-card shadow-card ring-1 ring-rule focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
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
                      <div className="flex min-w-0 flex-1 flex-col justify-between gap-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            {m?.href ? (
                              <Link
                                href={m.href}
                                className="font-display text-base font-semibold leading-snug text-ink line-clamp-2 transition-colors hover:underline"
                              >
                                {m?.name ?? "Artikel"}
                              </Link>
                            ) : (
                              <span className="font-display text-base font-semibold leading-snug text-ink line-clamp-2">
                                {m?.name ?? "Artikel"}
                              </span>
                            )}
                            <p className="tnum mt-1 text-sm text-ink-faded">
                              Einzelpreis{" "}
                              <span className="font-medium text-ink-aged">{eur(item.unitPriceEur)}</span>
                            </p>
                          </div>

                          {/* Line total */}
                          <span className="tnum shrink-0 text-base font-semibold tabular-nums text-ink">
                            {eur((parseFloat(item.unitPriceEur) * item.quantity).toFixed(2))}
                          </span>
                        </div>

                        {/* Stepper + remove: every control is a 44px touch target */}
                        <div className="flex items-center justify-between gap-3">
                          <div className="inline-flex items-center rounded-button border border-rule bg-card">
                            <button
                              type="button"
                              onClick={() => decrease(item)}
                              disabled={busy}
                              aria-label={item.quantity <= 1 ? `${m?.name ?? "Artikel"} entfernen` : "Menge verringern"}
                              className="grid h-11 w-11 place-items-center rounded-l-button text-ink-aged transition-colors hover:bg-raised hover:text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink"
                            >
                              <Minus aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.7} />
                            </button>
                            <span aria-live="polite" className="tnum min-w-[2.25rem] text-center text-sm font-semibold text-ink">
                              {item.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => increase(item)}
                              disabled={busy}
                              aria-label="Menge erhöhen"
                              className="grid h-11 w-11 place-items-center rounded-r-button text-ink-aged transition-colors hover:bg-raised hover:text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink"
                            >
                              <Plus aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.7} />
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => remove(item.id)}
                            disabled={busy}
                            aria-label={`${m?.name ?? "Artikel"} entfernen`}
                            className="grid h-11 w-11 shrink-0 place-items-center rounded-button text-ink-faded transition-colors hover:text-wax-red disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
                          >
                            <Trash2 aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.7} />
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {/* Back to collection link */}
              <div className="mt-4">
                <Link
                  href="/kollektion"
                  className="inline-flex min-h-[44px] items-center text-sm text-ink-faded underline underline-offset-2 transition-colors hover:text-ink"
                >
                  Weiter einkaufen
                </Link>
              </div>
            </section>

            {/* ── Right: order summary ── */}
            <aside aria-label="Bestellzusammenfassung">
              {/* sticky only on the two-column desktop layout */}
              <div className="rounded-card border border-rule bg-card p-6 shadow-card lg:sticky lg:top-6">
                <h2 className="mb-5 font-display text-xl font-semibold text-ink">
                  Zusammenfassung
                </h2>

                {/* Totals block: hairline rows */}
                <dl className="divide-y divide-rule text-sm">
                  <div className="flex justify-between gap-4 py-3">
                    <dt className="text-ink-aged">Zwischensumme</dt>
                    <dd className="tnum font-semibold tabular-nums text-ink">{eur(cart.totalEur)}</dd>
                  </div>
                  <div className="flex justify-between gap-4 py-3">
                    <dt className="text-ink-aged">Versand</dt>
                    <dd className="text-ink-faded">wird an der Kasse gewählt</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4 py-3">
                    <dt className="font-display text-base font-semibold text-ink">Gesamt</dt>
                    <dd className="tnum font-display text-lg font-semibold tabular-nums text-ink">
                      {eur(cart.totalEur)}
                    </dd>
                  </div>
                </dl>

                {/* VAT note — Differenzbesteuerung stays */}
                <p className="mb-6 mt-2 text-xs leading-relaxed text-ink-faded">
                  Preise inkl. gesetzlicher MwSt. (sofern anwendbar), zzgl. eventueller
                  Versandkosten. Edelmetallmünzen und Barren ggf. nach §25a UStG
                  differenzbesteuert.
                </p>

                {/* Checkout CTA — full width, 48px tall, thumb-friendly */}
                <Link
                  href="/kasse"
                  className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-button bg-ink px-6 py-3.5 text-center text-sm font-semibold text-white shadow-card transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
                >
                  Zur Kasse <ArrowRight aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.7} />
                </Link>
              </div>
            </aside>
          </div>
        )}
      </div>
    </PageShell>
  );
}
