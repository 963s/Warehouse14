"use client";

import { useEffect, useState } from "react";
import { Kicker } from "@/components/brand/kicker";
import { useCart } from "@/components/cart/cart-provider";
import { eur } from "@/lib/storefront-data";

/** sessionStorage seam between the Kasse submit and the Bestätigung recap. */
const RECAP_KEY = "w14.checkout.recap.v1";

export type CheckoutRecapItem = {
  name: string;
  quantity: number;
  unitPriceEur: string;
};

export type CheckoutRecap = {
  items: CheckoutRecapItem[];
  totalEur: string;
  zahlart: "vorkasse" | "barzahlung";
  versand: "versand" | "abholung";
  placedAt: string;
  /** Set once the Bestätigung emptied the cart, keeps a reload from clearing again. */
  cartCleared?: boolean;
};

/** Called by the Kasse at submit time, quiet on storage failure. */
export function writeCheckoutRecap(recap: CheckoutRecap): void {
  try {
    sessionStorage.setItem(RECAP_KEY, JSON.stringify(recap));
  } catch {
    // private mode or storage full, the Bestätigung then shows the generic state
  }
}

function readRecap(): CheckoutRecap | null {
  try {
    const raw = sessionStorage.getItem(RECAP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CheckoutRecap;
    if (!Array.isArray(parsed?.items) || typeof parsed.totalEur !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Quiet recap under the thank-you: the requested items, the totals and the
 * chosen Zahlungsart und Lieferweg. Renders nothing on a direct visit (no
 * recap in sessionStorage), the page then keeps its composed generic state.
 * Clears the cart exactly once after the recap arrived from the Kasse.
 */
export function OrderRecap() {
  const { cart, clear } = useCart();
  const [recap, setRecap] = useState<CheckoutRecap | null>(null);
  const [needsClear, setNeedsClear] = useState(false);

  // Read after mount, sessionStorage does not exist on the server.
  useEffect(() => {
    const stored = readRecap();
    if (!stored) return;
    setRecap(stored);
    if (!stored.cartCleared) setNeedsClear(true);
  }, []);

  // Empty the cart once it is hydrated, then mark the recap as consumed.
  useEffect(() => {
    if (!needsClear || !recap || cart === null) return;
    setNeedsClear(false);
    writeCheckoutRecap({ ...recap, cartCleared: true });
    void clear();
  }, [needsClear, recap, cart, clear]);

  if (!recap) return null;

  const abholung = recap.versand === "abholung";

  return (
    <section
      aria-labelledby="bestell-uebersicht"
      className="mt-12 rounded-card border border-rule bg-card p-5 text-left shadow-card sm:p-6"
    >
      <Kicker className="mb-1.5">Ihre Auswahl</Kicker>
      <h2 id="bestell-uebersicht" className="font-display text-xl font-semibold text-ink">
        Bestellübersicht
      </h2>

      {/* Items: hairline rows, tnum numbers */}
      <ul className="mt-4 divide-y divide-rule border-y border-rule">
        {recap.items.map((item, i) => (
          <li key={`${item.name}-${i}`} className="flex items-baseline justify-between gap-4 py-3 text-sm">
            <span className="min-w-0 flex-1 text-ink">
              {item.name}
              {item.quantity > 1 && <span className="tnum text-ink-faded"> × {item.quantity}</span>}
            </span>
            <span className="shrink-0 text-right">
              {item.quantity > 1 && (
                <span className="tnum block text-xs text-ink-faded">je {eur(item.unitPriceEur)}</span>
              )}
              <span className="tnum font-medium text-ink">
                {eur((parseFloat(item.unitPriceEur) * item.quantity).toFixed(2))}
              </span>
            </span>
          </li>
        ))}
      </ul>

      {/* Totals and the chosen way of paying and receiving */}
      <dl className="divide-y divide-rule text-sm">
        <div className="flex justify-between gap-4 py-3">
          <dt className="text-ink-aged">Zwischensumme</dt>
          <dd className="tnum text-ink">{eur(recap.totalEur)}</dd>
        </div>
        <div className="flex justify-between gap-4 py-3">
          <dt className="text-ink-aged">Versand</dt>
          <dd className="text-ink-faded">{abholung ? "entfällt bei Abholung" : "laut Bestellbestätigung"}</dd>
        </div>
        <div className="flex justify-between gap-4 py-3">
          <dt className="text-ink-aged">Zahlungsart</dt>
          <dd className="text-right text-ink">
            {recap.zahlart === "barzahlung" ? "Barzahlung im Geschäft" : "Vorkasse (Banküberweisung)"}
          </dd>
        </div>
        <div className="flex justify-between gap-4 py-3">
          <dt className="text-ink-aged">Lieferweg</dt>
          <dd className="text-right text-ink">{abholung ? "Abholung im Geschäft" : "Versicherter Versand"}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 py-3">
          <dt className="font-display text-base font-semibold text-ink">Gesamt</dt>
          <dd className="tnum font-display text-lg font-semibold text-ink">{eur(recap.totalEur)}</dd>
        </div>
      </dl>
      {!abholung && (
        <p className="text-xs text-ink-faded">zzgl. Versandkosten laut Bestellbestätigung.</p>
      )}
    </section>
  );
}
