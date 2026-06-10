"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShoppingBag, AlertCircle, CreditCard, Info } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { AddressForm, type AddressFormValues } from "@/components/checkout/address-form";
import { useCart } from "@/components/cart/cart-provider";
import { data, eur } from "@/lib/storefront-data";

// ─────────────────────────────────────────────────────────────────────────────
// Payment method labels
// ─────────────────────────────────────────────────────────────────────────────

const PAYMENT_METHODS = [
  "Visa",
  "Mastercard",
  "PayPal",
  "Klarna",
  "SEPA-Lastschrift",
  "Vorkasse",
];

// ─────────────────────────────────────────────────────────────────────────────
// KassePage
// ─────────────────────────────────────────────────────────────────────────────

export default function KassePage() {
  const router = useRouter();
  const { cart, meta, count } = useCart();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Collect the address values from the form submission
  const [pendingValues, setPendingValues] = useState<AddressFormValues | null>(null);

  async function handleAddressSubmit(values: AddressFormValues) {
    setPendingValues(values);
    await doCheckout(values);
  }

  async function doCheckout(values: AddressFormValues) {
    setError(null);
    setPending(true);
    try {
      await data.checkout({ shippingAddress: values.shipping, billingAddress: values.billing });
      router.push("/kasse/bestaetigung");
    } catch {
      setError("Die Bestellung konnte nicht abgeschlossen werden. Bitte versuchen Sie es erneut.");
      setPending(false);
    }
  }

  // ── Empty cart guard ────────────────────────────────────────────────────────
  if (cart !== null && count === 0) {
    return (
      <PageShell>
        <div className="max-w-edge mx-auto px-4 py-20 text-center">
          <ShoppingBag className="mx-auto mb-5 h-14 w-14 text-ink-faded" aria-hidden="true" />
          <h1 className="font-display text-3xl font-semibold text-ink">
            Ihr Warenkorb ist leer
          </h1>
          <p className="mt-3 text-ink-aged">
            Bitte legen Sie zunächst Artikel in den Warenkorb, bevor Sie zur Kasse gehen.
          </p>
          <Link
            href="/kollektion"
            className="mt-8 inline-block rounded-button bg-[#bf9430] px-8 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Zur Kollektion
          </Link>
        </div>
      </PageShell>
    );
  }

  const items = cart?.items ?? [];
  const totalEur = cart?.totalEur ?? "0.00";

  return (
    <PageShell>
      <div className="max-w-edge mx-auto px-4 pb-20 pt-10">
        {/* Heading */}
        <h1 className="font-display text-3xl font-semibold text-ink md:text-4xl">
          Kasse
        </h1>
        <p className="mt-2 text-sm text-ink-faded">
          Schritt 1 von 1, Testmodus aktiv
        </p>

        <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_380px]">
          {/* ── LEFT: address form + payment info ───────────────────────── */}
          <div className="space-y-10">
            {/* Address */}
            <section className="rounded-card border border-rule bg-card p-6 shadow-card">
              <AddressForm onSubmit={handleAddressSubmit} pending={pending} />
            </section>

            {/* Payment section */}
            <section className="rounded-card border border-rule bg-card p-6 shadow-card">
              <div className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-gold" aria-hidden="true" />
                <h2 className="font-display text-xl font-semibold text-ink">
                  Zahlung
                </h2>
              </div>

              {/* Method pills */}
              <div className="mt-4 flex flex-wrap gap-2">
                {PAYMENT_METHODS.map((m) => (
                  <span
                    key={m}
                    className="rounded border border-rule bg-surface px-3 py-1 text-xs font-medium text-ink-aged"
                  >
                    {m}
                  </span>
                ))}
              </div>

              {/* Test mode notice */}
              <div className="mt-5 flex gap-3 rounded-button border border-[#bf9430]/30 bg-[#bf9430]/8 p-4">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#bf9430]" aria-hidden="true" />
                <p className="text-sm text-ink-aged">
                  Testmodus: die echte Stripe-Zahlung wird beim Livegang aktiviert. Im
                  Testmodus wird keine Zahlung ausgelöst.
                </p>
              </div>
            </section>

            {/* Error */}
            <div role="alert" aria-live="assertive">
              {error && (
                <div className="flex items-start gap-3 rounded-button border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  {error}
                </div>
              )}
            </div>
          </div>

          {/* ── RIGHT: order summary ─────────────────────────────────────── */}
          <aside className="space-y-5">
            <div className="rounded-card border border-rule bg-card p-6 shadow-card">
              <h2 className="font-display text-xl font-semibold text-ink">
                Bestellübersicht
              </h2>

              {/* Line items */}
              <ul className="mt-5 space-y-3">
                {items.length === 0 && (
                  <li className="text-sm text-ink-faded">Keine Artikel</li>
                )}
                {items.map((item) => {
                  const m = meta[item.productId];
                  return (
                    <li
                      key={item.id}
                      className="flex items-start justify-between gap-3 text-sm"
                    >
                      <span className="text-ink">
                        {m?.name ?? "Artikel"}{" "}
                        {item.quantity > 1 && (
                          <span className="text-ink-faded">x{item.quantity}</span>
                        )}
                      </span>
                      <span className="tnum shrink-0 font-medium text-ink">
                        {eur(
                          (
                            parseFloat(item.unitPriceEur) * item.quantity
                          ).toFixed(2),
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>

              {/* Totals */}
              <div className="mt-5 space-y-2 border-t border-rule pt-5 text-sm">
                <div className="flex justify-between text-ink-aged">
                  <span>Zwischensumme</span>
                  <span className="tnum">{eur(totalEur)}</span>
                </div>
                <div className="flex justify-between text-ink-aged">
                  <span>Versand</span>
                  <span className="text-ink-faded italic">wird berechnet</span>
                </div>
                <div className="flex justify-between border-t border-rule pt-3 font-display text-lg font-semibold text-ink">
                  <span>Gesamt</span>
                  <span className="tnum">{eur(totalEur)}</span>
                </div>
              </div>

              {/* Fiscal note */}
              <p className="mt-4 rounded-button bg-surface px-3 py-2.5 text-xs leading-relaxed text-ink-faded">
                Der Kassenbeleg wird automatisch nach Bezahlung ausgestellt und
                erfüllt die Anforderungen der Kassensicherungsverordnung (KassenSichV).
              </p>
            </div>

            {/* CTA button */}
            <button
              type="submit"
              form="checkout-address-form"
              disabled={pending}
              className="w-full rounded-button bg-[#bf9430] px-6 py-4 text-sm font-semibold text-white shadow-card transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#bf9430]"
            >
              {pending ? "Wird verarbeitet ..." : "Kauf abschließen (Testmodus)"}
            </button>

            <p className="text-center text-xs text-ink-faded">
              Mit dem Kauf akzeptieren Sie unsere{" "}
              <Link href="/agb" className="underline hover:text-gold">
                Allgemeinen Geschäftsbedingungen
              </Link>{" "}
              und die{" "}
              <Link href="/datenschutz" className="underline hover:text-gold">
                Datenschutzerklärung
              </Link>
              .
            </p>
          </aside>
        </div>
      </div>
    </PageShell>
  );
}
