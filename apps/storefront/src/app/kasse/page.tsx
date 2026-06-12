"use client";

import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { Kicker } from "@/components/brand/kicker";
import { BrandLoupeSketch } from "@/components/brand/marks";
import { CheckoutSteps } from "./checkout-steps";
import { useCart } from "@/components/cart/cart-provider";

export default function KassePage() {
  const { cart, count } = useCart();

  // ── Empty cart guard ────────────────────────────────────────────────────────
  if (cart !== null && count === 0) {
    return (
      <PageShell>
        <div className="max-w-edge mx-auto px-4 py-20 text-center">
          <BrandLoupeSketch className="mx-auto w-28 text-ink" />
          <h1 className="mt-6 font-display text-3xl font-semibold text-ink">
            Ihr Warenkorb ist leer
          </h1>
          <p className="mx-auto mt-3 max-w-md text-ink-aged">
            Bitte legen Sie zunächst Artikel in den Warenkorb, bevor Sie zur Kasse gehen.
          </p>
          <Link
            href="/kollektion"
            className="mt-8 inline-flex min-h-[48px] items-center rounded-button bg-ink px-8 py-3 text-sm font-semibold text-white shadow-card transition-opacity hover:opacity-90"
          >
            Zur Kollektion
          </Link>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="max-w-edge mx-auto px-4 pt-10">
        <Kicker className="mb-3">Bestellung abschließen</Kicker>
        <h1 className="font-display text-3xl font-semibold text-ink md:text-4xl">Kasse</h1>
        <p className="mt-2 text-sm text-ink-faded">
          Warenkorb · Adresse · Übersicht · Zahlung
        </p>
      </div>
      <CheckoutSteps />
    </PageShell>
  );
}
