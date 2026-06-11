"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Banknote, FileCheck2, Info, Landmark, MapPin, ShieldCheck, Store, Truck } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { Kicker } from "@/components/brand/kicker";
import { BrandLoupeSketch } from "@/components/brand/marks";
import { KlarnaIcon, MastercardIcon, PaypalIcon, VisaIcon } from "@/components/brand-icons";
import { AddressForm, type AddressFormValues } from "@/components/checkout/address-form";
import { PaymentGateModal } from "./payment-gate-modal";
import { ProductImage } from "@/components/product/product-image";
import { useCart } from "@/components/cart/cart-provider";
import { eur } from "@/lib/storefront-data";
import { cn } from "@/lib/cn";

// ─────────────────────────────────────────────────────────────────────────────
// Choices
// ─────────────────────────────────────────────────────────────────────────────

type ShippingMethod = "versand" | "abholung";
type PaymentMethod = "vorkasse" | "barzahlung";

// ─────────────────────────────────────────────────────────────────────────────
// Building blocks
// ─────────────────────────────────────────────────────────────────────────────

/** The house numbered step: tnum numeral in a hairline disc, then the title. */
function StepCard({
  n,
  title,
  sub,
  children,
}: {
  n: number;
  title: string;
  sub?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`kasse-step-${n}`} className="rounded-card border border-rule bg-card p-5 shadow-card sm:p-6">
      <div className="flex items-start gap-3.5">
        <span
          aria-hidden="true"
          className="tnum grid h-9 w-9 shrink-0 place-items-center rounded-full border border-rule font-display text-base font-semibold text-ink"
        >
          {n}
        </span>
        <div className="min-w-0">
          <h2 id={`kasse-step-${n}`} className="font-display text-xl font-semibold text-ink">
            {title}
          </h2>
          {sub && <p className="mt-1 text-sm leading-relaxed text-ink-faded">{sub}</p>}
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** A selectable option row: native radio for a11y, one calm border change. */
function OptionRow({
  name,
  value,
  checked,
  disabled,
  onSelect,
  icon,
  title,
  desc,
  hint,
  trailing,
}: {
  name: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  icon?: ReactNode;
  title: string;
  desc?: string;
  hint?: string;
  trailing?: string;
}) {
  return (
    <label
      className={cn(
        "flex items-start gap-3 rounded-button border p-4 transition-colors",
        checked ? "border-ink bg-raised" : "border-rule bg-surface",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-ink/40",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="mt-0.5 h-5 w-5 shrink-0 accent-ink"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="flex items-center gap-2 font-medium text-ink">
            {icon}
            {title}
          </span>
          {trailing && <span className="shrink-0 text-sm text-ink-aged">{trailing}</span>}
        </span>
        {desc && <span className="mt-1 block text-sm leading-relaxed text-ink-aged">{desc}</span>}
        {hint && <span className="mt-1 block text-xs leading-relaxed text-ink-faded">{hint}</span>}
      </span>
    </label>
  );
}

/** Disabled payment row with the house "Bald verfügbar" chip (auth treatment). */
function ComingSoonRow({ icons, title }: { icons: ReactNode; title: string }) {
  return (
    <div
      aria-disabled="true"
      title="Bald verfügbar"
      className="relative flex min-h-[48px] cursor-not-allowed items-center gap-3 rounded-button border border-rule bg-surface px-4 py-3"
    >
      <span aria-hidden="true" className="flex items-center gap-1.5 opacity-50 grayscale">
        {icons}
      </span>
      <span className="text-[0.95rem] font-medium text-ink-faded">{title}</span>
      <span className="absolute -top-2 right-3 rounded-full border border-rule bg-raised px-2 py-0.5 text-[0.6875rem] leading-4 text-ink-faded">
        Bald verfügbar
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KassePage
// ─────────────────────────────────────────────────────────────────────────────

export default function KassePage() {
  const { cart, meta, count } = useCart();
  const [gateOpen, setGateOpen] = useState(false);
  const [shippingMethod, setShippingMethod] = useState<ShippingMethod>("versand");
  const [payment, setPayment] = useState<PaymentMethod>("vorkasse");

  function chooseShipping(method: ShippingMethod) {
    setShippingMethod(method);
    // Barzahlung pairs only with Abholung; fall back quietly.
    if (method === "versand" && payment === "barzahlung") setPayment("vorkasse");
  }

  /* HONEST PAYMENT GATE: the api's checkout() reserves stock AND creates a
   * Stripe payment intent in one step — with the gateway deliberately not yet
   * configured there is no order submission that does not claim a payment.
   * So the validated journey ends in the PaymentGateModal: no fake success,
   * no invented order, the cart stays intact, and the shopper gets the two
   * real channels (WhatsApp-Reservierung, Termin im Geschäft). */
  function handleAddressSubmit(_values: AddressFormValues) {
    setGateOpen(true);
  }

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

  const items = cart?.items ?? [];
  const totalEur = cart?.totalEur ?? "0.00";

  return (
    <PageShell>
      {/* extra bottom padding clears the sticky phone CTA */}
      <div className="max-w-edge mx-auto px-4 pb-36 pt-10 lg:pb-20">
        {/* Opener */}
        <Kicker className="mb-3">Bestellung abschließen</Kicker>
        <h1 className="font-display text-3xl font-semibold text-ink md:text-4xl">Kasse</h1>
        <p className="mt-2 text-sm text-ink-faded">
          Kontakt & Lieferung · Versand · Zahlungsart · Bestätigen
        </p>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_380px] lg:gap-10">
          {/* ── LEFT: the numbered journey ───────────────────────────────── */}
          <div className="space-y-6">
            {/* 1 · Kontakt & Lieferadresse */}
            <StepCard
              n={1}
              title="Kontakt & Lieferadresse"
              sub="Wohin dürfen wir liefern, und wie erreichen wir Sie?"
            >
              <AddressForm onSubmit={handleAddressSubmit} />
            </StepCard>

            {/* 2 · Versand */}
            <StepCard n={2} title="Versand" sub="Wie möchten Sie Ihre Stücke erhalten?">
              <div className="space-y-3" role="radiogroup" aria-label="Versandart">
                <OptionRow
                  name="versandart"
                  value="versand"
                  checked={shippingMethod === "versand"}
                  onSelect={() => chooseShipping("versand")}
                  icon={<Truck aria-hidden="true" className="h-[18px] w-[18px] text-ink-aged" strokeWidth={1.7} />}
                  title="Versicherter Versand"
                  desc="Wertversichert per DHL, neutral verpackt, mit Sendungsverfolgung."
                  hint="Die Versandkosten werden in der Bestellbestätigung ausgewiesen."
                />
                <OptionRow
                  name="versandart"
                  value="abholung"
                  checked={shippingMethod === "abholung"}
                  onSelect={() => chooseShipping("abholung")}
                  icon={<Store aria-hidden="true" className="h-[18px] w-[18px] text-ink-aged" strokeWidth={1.7} />}
                  title="Abholung im Geschäft"
                  desc="warehouse14 in Schorndorf. Auf Wunsch mit Termin, damit Ihre Stücke bereitliegen."
                  trailing="ohne Versandkosten"
                />
              </div>
            </StepCard>

            {/* 3 · Zahlungsart */}
            <StepCard n={3} title="Zahlungsart" sub="Heute verfügbar: Vorkasse und Barzahlung bei Abholung.">
              <div className="space-y-3" role="radiogroup" aria-label="Zahlungsart">
                <OptionRow
                  name="zahlungsart"
                  value="vorkasse"
                  checked={payment === "vorkasse"}
                  onSelect={() => setPayment("vorkasse")}
                  icon={<Landmark aria-hidden="true" className="h-[18px] w-[18px] text-ink-aged" strokeWidth={1.7} />}
                  title="Vorkasse (Banküberweisung)"
                  desc="Sie erhalten unsere Bankverbindung mit der Bestellbestätigung."
                />
                <OptionRow
                  name="zahlungsart"
                  value="barzahlung"
                  checked={payment === "barzahlung"}
                  disabled={shippingMethod !== "abholung"}
                  onSelect={() => setPayment("barzahlung")}
                  icon={<Banknote aria-hidden="true" className="h-[18px] w-[18px] text-ink-aged" strokeWidth={1.7} />}
                  title="Barzahlung im Geschäft"
                  desc="Sie zahlen bequem bei der Abholung in Schorndorf."
                  hint={shippingMethod !== "abholung" ? "Nur in Verbindung mit Abholung im Geschäft." : undefined}
                />
              </div>

              {/* Coming soon, honest by design */}
              <div className="mt-5 space-y-3 border-t border-rule pt-5">
                <ComingSoonRow
                  title="Kreditkarte"
                  icons={
                    <>
                      <VisaIcon className="h-5" />
                      <MastercardIcon className="h-5" />
                    </>
                  }
                />
                <ComingSoonRow title="PayPal" icons={<PaypalIcon className="h-5" />} />
                <ComingSoonRow title="Klarna" icons={<KlarnaIcon className="h-5" />} />
              </div>
            </StepCard>

            {/* Trust band: only claims the site already makes */}
            <div className="grid gap-4 rounded-card border border-rule bg-card p-5 shadow-card sm:grid-cols-3">
              <p className="flex items-start gap-2.5 text-xs leading-relaxed text-ink-aged">
                <ShieldCheck aria-hidden="true" className="mt-0.5 h-[18px] w-[18px] shrink-0 text-verdigris" strokeWidth={1.7} />
                Versicherter Versand, neutral verpackt und mit Sendungsverfolgung.
              </p>
              <p className="flex items-start gap-2.5 text-xs leading-relaxed text-ink-aged">
                <FileCheck2 aria-hidden="true" className="mt-0.5 h-[18px] w-[18px] shrink-0 text-ink-aged" strokeWidth={1.7} />
                GoBD- & GwG-konform, fiskalisch sauber von der Kasse bis zum Beleg.
              </p>
              <p className="flex items-start gap-2.5 text-xs leading-relaxed text-ink-aged">
                <MapPin aria-hidden="true" className="mt-0.5 h-[18px] w-[18px] shrink-0 text-ink-aged" strokeWidth={1.7} />
                Abholung und Beratung im Geschäft in Schorndorf möglich.
              </p>
            </div>
          </div>

          {/* ── RIGHT: 4 · Übersicht & Bestätigen ───────────────────────── */}
          <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start">
            <section aria-labelledby="kasse-step-4" className="rounded-card border border-rule bg-card p-5 shadow-card sm:p-6">
              <div className="flex items-start gap-3.5">
                <span
                  aria-hidden="true"
                  className="tnum grid h-9 w-9 shrink-0 place-items-center rounded-full border border-rule font-display text-base font-semibold text-ink"
                >
                  4
                </span>
                <h2 id="kasse-step-4" className="font-display text-xl font-semibold text-ink">
                  Übersicht & Bestätigen
                </h2>
              </div>

              {/* Line items */}
              <ul className="mt-5 space-y-3">
                {items.length === 0 && <li className="text-sm text-ink-faded">Wird geladen ...</li>}
                {items.map((item) => {
                  const m = meta[item.productId];
                  return (
                    <li key={item.id} className="flex items-center gap-3 text-sm">
                      <span className="shrink-0 overflow-hidden rounded-button ring-1 ring-rule">
                        <ProductImage
                          image={m?.image ?? null}
                          className="h-11 w-11"
                          emojiClassName="text-lg"
                          sizes="44px"
                        />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-ink">
                        {m?.name ?? "Artikel"}
                        {item.quantity > 1 && (
                          <span className="tnum text-ink-faded"> × {item.quantity}</span>
                        )}
                      </span>
                      <span className="tnum shrink-0 font-medium text-ink">
                        {eur((parseFloat(item.unitPriceEur) * item.quantity).toFixed(2))}
                      </span>
                    </li>
                  );
                })}
              </ul>

              {/* Totals: hairline rows */}
              <dl className="mt-5 divide-y divide-rule border-t border-rule text-sm">
                <div className="flex justify-between gap-4 py-3">
                  <dt className="text-ink-aged">Zwischensumme</dt>
                  <dd className="tnum tabular-nums text-ink">{eur(totalEur)}</dd>
                </div>
                <div className="flex justify-between gap-4 py-3">
                  <dt className="text-ink-aged">Versand</dt>
                  <dd className="text-ink-faded">
                    {shippingMethod === "abholung" ? "entfällt bei Abholung" : "laut Bestellbestätigung"}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 py-3">
                  <dt className="font-display text-base font-semibold text-ink">Gesamt</dt>
                  <dd className="tnum font-display text-lg font-semibold tabular-nums text-ink">
                    {eur(totalEur)}
                  </dd>
                </div>
              </dl>
              {shippingMethod === "versand" && (
                <p className="text-xs text-ink-faded">zzgl. Versandkosten laut Bestellbestätigung.</p>
              )}

              {/* Fiscal note */}
              <p className="mt-4 rounded-button bg-surface px-3 py-2.5 text-xs leading-relaxed text-ink-faded">
                Der Kassenbeleg wird automatisch nach Bezahlung ausgestellt und erfüllt die
                Anforderungen der Kassensicherungsverordnung (KassenSichV). Edelmetallmünzen
                und Barren ggf. nach §25a UStG differenzbesteuert.
              </p>
            </section>

            {/* Honest notice — the gate states it again at the final action */}
            <div className="flex gap-3 rounded-button border border-rule bg-raised p-4">
              <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-ink-aged" />
              <p className="text-sm leading-relaxed text-ink-aged">
                Die Online-Zahlung ist noch nicht verfügbar — die Zahlungsanbindung wird
                derzeit eingerichtet. Es wird keine Zahlung ausgelöst; Ihre Auswahl können
                Sie im Geschäft oder telefonisch reservieren.
              </p>
            </div>

            {/* CTA (desktop + tablet; phones use the sticky bar below) */}
            <button
              type="submit"
              form="checkout-address-form"
              className="hidden min-h-[48px] w-full rounded-button bg-ink px-6 py-4 text-sm font-semibold text-white shadow-card transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 lg:block"
            >
              Kostenpflichtig bestellen
            </button>

            <p className="text-center text-xs leading-relaxed text-ink-faded">
              Mit dem Absenden akzeptieren Sie unsere{" "}
              <Link href="/agb" className="underline hover:text-ink">
                Allgemeinen Geschäftsbedingungen
              </Link>{" "}
              und die{" "}
              <Link href="/datenschutz" className="underline hover:text-ink">
                Datenschutzerklärung
              </Link>
              .
            </p>
          </aside>
        </div>
      </div>

      {/* Sticky summary CTA — phone first, safe-area aware */}
      <div
        className="fixed inset-x-0 bottom-0 z-[60] border-t border-rule bg-card/95 backdrop-blur-sm lg:hidden"
        style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto flex max-w-edge items-center gap-4 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[0.6875rem] uppercase tracking-wide text-ink-faded">Gesamt</p>
            <p className="tnum font-display text-lg font-semibold leading-tight text-ink">
              {eur(totalEur)}
            </p>
          </div>
          <button
            type="submit"
            form="checkout-address-form"
            className="min-h-[48px] flex-1 rounded-button bg-ink px-5 py-3 text-sm font-semibold text-white shadow-card transition-opacity hover:opacity-90"
          >
            Kostenpflichtig bestellen
          </button>
        </div>
      </div>

      {/* The honest end state: no fake order, the cart stays intact */}
      <PaymentGateModal
        open={gateOpen}
        onClose={() => setGateOpen(false)}
        items={items.map((it) => ({
          name: meta[it.productId]?.name ?? "Artikel",
          quantity: it.quantity,
        }))}
        totalEur={totalEur}
      />
    </PageShell>
  );
}
