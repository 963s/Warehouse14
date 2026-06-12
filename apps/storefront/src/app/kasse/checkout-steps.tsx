"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  Check,
  FileCheck2,
  Info,
  Landmark,
  MapPin,
  ShieldCheck,
  ShoppingBag,
  Store,
  Truck,
} from "lucide-react";
import { AddressForm, type AddressFormValues } from "@/components/checkout/address-form";
import { PaymentGateModal } from "./payment-gate-modal";
import { ProductImage } from "@/components/product/product-image";
import { KlarnaIcon, MastercardIcon, PaypalIcon, VisaIcon } from "@/components/brand-icons";
import { useCart } from "@/components/cart/cart-provider";
import { eur } from "@/lib/storefront-data";
import { cn } from "@/lib/cn";

// ─────────────────────────────────────────────────────────────────────────────
// Choices
// ─────────────────────────────────────────────────────────────────────────────

type ShippingMethod = "versand" | "abholung";
type PaymentMethod = "vorkasse" | "barzahlung";

/**
 * The checkout journey, as four named steps the shopper walks one at a time:
 *
 *   1 · Warenkorb   (the cart page — links back here, never trapped)
 *   2 · Adresse     (Kontakt + Lieferadresse, the AddressForm)
 *   3 · Übersicht   (Versand + Zahlungsart + order recap)
 *   4 · Zahlung     (the honest PaymentGateModal fires here)
 *
 * Every step past the first carries a visible "Zurück". The AddressForm stays
 * MOUNTED across steps (toggled with `hidden`, never unmounted) so all entered
 * contact + address data survives going back and forth — React keeps its state.
 */
const STEP_LABELS = ["Warenkorb", "Adresse", "Übersicht", "Zahlung"] as const;
// Step indices used inside this component (the cart is step 1, handled upstream).
type Step = 2 | 3 | 4;

// ─────────────────────────────────────────────────────────────────────────────
// Building blocks
// ─────────────────────────────────────────────────────────────────────────────

/** The horizontal step rail: numbered discs, the current one inked. */
function StepRail({ current }: { current: Step }) {
  return (
    <nav aria-label="Bestellschritte" className="mb-8">
      <ol className="flex items-center gap-1.5 sm:gap-2">
        {STEP_LABELS.map((label, i) => {
          const n = i + 1; // 1..4
          const done = n < current;
          const active = n === current;
          return (
            <li key={label} className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
              <span
                className={cn(
                  "tnum grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-semibold transition-colors sm:h-8 sm:w-8 sm:text-sm",
                  active
                    ? "border-ink bg-ink text-white"
                    : done
                      ? "border-ink/40 bg-raised text-ink"
                      : "border-rule bg-surface text-ink-faded",
                )}
                aria-current={active ? "step" : undefined}
              >
                {done ? <Check className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden="true" /> : n}
              </span>
              <span
                className={cn(
                  "hidden truncate text-xs font-medium sm:inline sm:text-sm",
                  active ? "text-ink" : "text-ink-faded",
                )}
              >
                {label}
              </span>
              {n < STEP_LABELS.length && (
                <span aria-hidden="true" className="h-px flex-1 bg-rule" />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The house numbered step card: tnum numeral in a hairline disc, then title. */
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

/** A back link styled as a calm, 44px-tall text control. */
function BackButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-[44px] items-center gap-2 rounded-button px-2 text-sm font-medium text-ink-aged transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
    >
      <ArrowLeft aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.7} />
      {children}
    </button>
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
// CheckoutSteps
// ─────────────────────────────────────────────────────────────────────────────

export function CheckoutSteps() {
  const { cart, meta } = useCart();
  const [step, setStep] = useState<Step>(2);
  const [address, setAddress] = useState<AddressFormValues | null>(null);
  const [shippingMethod, setShippingMethod] = useState<ShippingMethod>("versand");
  const [payment, setPayment] = useState<PaymentMethod>("vorkasse");
  const [gateOpen, setGateOpen] = useState(false);

  function chooseShipping(method: ShippingMethod) {
    setShippingMethod(method);
    // Barzahlung pairs only with Abholung; fall back quietly.
    if (method === "versand" && payment === "barzahlung") setPayment("vorkasse");
  }

  /* The AddressForm submit advances to the Übersicht: data is captured and the
   * form stays mounted (hidden) so "Zurück" returns to it fully filled in. */
  function handleAddressSubmit(values: AddressFormValues) {
    setAddress(values);
    setStep(3);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goTo(next: Step) {
    setStep(next);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const items = cart?.items ?? [];
  const totalEur = cart?.totalEur ?? "0.00";

  // ── The order recap, reused by the Übersicht and the Zahlung step ──────────
  const summary = (
    <section aria-label="Bestellübersicht" className="rounded-card border border-rule bg-card p-5 shadow-card sm:p-6">
      <h2 className="font-display text-xl font-semibold text-ink">Ihre Bestellung</h2>
      <ul className="mt-5 space-y-3">
        {items.length === 0 && <li className="text-sm text-ink-faded">Wird geladen ...</li>}
        {items.map((item) => {
          const m = meta[item.productId];
          return (
            <li key={item.id} className="flex items-center gap-3 text-sm">
              <span className="shrink-0 overflow-hidden rounded-button ring-1 ring-rule">
                <ProductImage image={m?.image ?? null} className="h-11 w-11" emojiClassName="text-lg" sizes="44px" />
              </span>
              <span className="min-w-0 flex-1 truncate text-ink">
                {m?.name ?? "Artikel"}
                {item.quantity > 1 && <span className="tnum text-ink-faded"> × {item.quantity}</span>}
              </span>
              <span className="tnum shrink-0 font-medium text-ink">
                {eur((parseFloat(item.unitPriceEur) * item.quantity).toFixed(2))}
              </span>
            </li>
          );
        })}
      </ul>

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
          <dd className="tnum font-display text-lg font-semibold tabular-nums text-ink">{eur(totalEur)}</dd>
        </div>
      </dl>
      {shippingMethod === "versand" && (
        <p className="mt-1 text-xs text-ink-faded">zzgl. Versandkosten laut Bestellbestätigung.</p>
      )}

      <p className="mt-4 rounded-button bg-surface px-3 py-2.5 text-xs leading-relaxed text-ink-faded">
        Der Kassenbeleg wird automatisch nach Bezahlung ausgestellt und erfüllt die Anforderungen der
        Kassensicherungsverordnung (KassenSichV). Edelmetallmünzen und Barren ggf. nach §25a UStG
        differenzbesteuert.
      </p>
    </section>
  );

  return (
    <div className="max-w-edge mx-auto px-4 pb-24 pt-10 lg:pb-20">
      <StepRail current={step} />

      <div className="grid gap-8 lg:grid-cols-[1fr_380px] lg:gap-10">
        {/* ── LEFT: the active step ─────────────────────────────────────── */}
        <div className="space-y-6">
          {/* STEP 2 · Adresse — kept mounted, only hidden, so data survives */}
          <div className={cn(step !== 2 && "hidden")}>
            <StepCard n={2} title="Kontakt & Lieferadresse" sub="Wohin dürfen wir liefern, und wie erreichen wir Sie?">
              <AddressForm onSubmit={handleAddressSubmit} />
            </StepCard>
            <div className="mt-4">
              <Link
                href="/warenkorb"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-button px-2 text-sm font-medium text-ink-aged transition-colors hover:text-ink"
              >
                <ArrowLeft aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.7} />
                Zurück zum Warenkorb
              </Link>
            </div>
          </div>

          {/* STEP 3 · Übersicht (Versand + Zahlungsart) */}
          {step === 3 && (
            <div className="space-y-6">
              {/* Entered contact + address recap with a quick edit jump back */}
              {address && (
                <StepCard n={2} title="Kontakt & Lieferadresse" sub="So haben wir Ihre Angaben notiert.">
                  <div className="text-sm leading-relaxed text-ink-aged">
                    <p className="text-ink">{address.shipping.recipientName}</p>
                    <p>{address.shipping.line1}</p>
                    {address.shipping.line2 && <p>{address.shipping.line2}</p>}
                    <p>
                      {address.shipping.postalCode} {address.shipping.city}
                    </p>
                    <p className="mt-2 text-ink-faded">{address.contact.email}</p>
                    {address.contact.phone && <p className="text-ink-faded">{address.contact.phone}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => goTo(2)}
                    className="mt-3 inline-flex min-h-[44px] items-center text-sm font-medium text-ink underline underline-offset-4 transition-colors hover:text-ink-aged"
                  >
                    Angaben ändern
                  </button>
                </StepCard>
              )}

              <StepCard n={3} title="Versand & Zahlungsart" sub="Wie möchten Sie Ihre Stücke erhalten und bezahlen?">
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

                <div className="mt-5 space-y-3 border-t border-rule pt-5" role="radiogroup" aria-label="Zahlungsart">
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

              {/* nav: back to address, forward to payment */}
              <div className="flex items-center justify-between gap-4">
                <BackButton onClick={() => goTo(2)}>Zurück</BackButton>
                <button
                  type="button"
                  onClick={() => goTo(4)}
                  className="inline-flex min-h-[48px] items-center gap-2 rounded-button bg-ink px-6 py-3.5 text-sm font-semibold text-white shadow-card transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
                >
                  Weiter zur Zahlung <ArrowRight aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.7} />
                </button>
              </div>
            </div>
          )}

          {/* STEP 4 · Zahlung — the final, honest gate */}
          {step === 4 && (
            <div className="space-y-6">
              <StepCard n={4} title="Zahlung" sub="Letzter Schritt: Bestellung prüfen und abschließen.">
                <div className="flex gap-3 rounded-button border border-rule bg-raised p-4">
                  <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-ink-aged" />
                  <p className="text-sm leading-relaxed text-ink-aged">
                    Die Online-Zahlung ist noch nicht verfügbar — die Zahlungsanbindung wird derzeit
                    eingerichtet. Es wird keine Zahlung ausgelöst; Ihre Auswahl können Sie im Geschäft
                    oder telefonisch reservieren.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setGateOpen(true)}
                  className="mt-5 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-button bg-ink px-6 py-4 text-sm font-semibold text-white shadow-card transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
                >
                  Kostenpflichtig bestellen
                </button>

                <p className="mt-3 text-center text-xs leading-relaxed text-ink-faded">
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
              </StepCard>

              <div>
                <BackButton onClick={() => goTo(3)}>Zurück zu Versand & Zahlungsart</BackButton>
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT: the persistent order summary ───────────────────────── */}
        <aside className="lg:sticky lg:top-6 lg:self-start">{summary}</aside>
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
    </div>
  );
}
