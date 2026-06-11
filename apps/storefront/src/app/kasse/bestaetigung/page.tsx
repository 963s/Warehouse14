import type { Metadata } from "next";
import Link from "next/link";
import { Info } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { BrandPlaque, BrandRule } from "@/components/brand/marks";
import { Kicker } from "@/components/brand/kicker";
import { OrderRecap } from "./order-recap";

export const metadata: Metadata = {
  title: "Vielen Dank | warehouse14",
  description: "Bestellbestätigung von warehouse14, Schorndorf.",
};

/**
 * The closing brand moment of the checkout. The Kasse hands the chosen
 * shipping and payment method over via query params so the "was passiert
 * jetzt" rows tell the right story. Honest by design: the Vorschau hinweis
 * states clearly that no order was transmitted and no order number exists.
 */
export default function BestaetigungPage({
  searchParams,
}: {
  searchParams?: { zahlart?: string; versand?: string };
}) {
  const barzahlung = searchParams?.zahlart === "barzahlung";
  const abholung = searchParams?.versand === "abholung" || barzahlung;

  const steps: string[] = abholung
    ? [
        "Wir prüfen Ihre Bestellung und legen die Stücke für Sie zurück.",
        barzahlung
          ? "Sie erhalten unsere Bestellbestätigung mit allen Details zur Abholung."
          : "Sie erhalten unsere Bestellbestätigung mit Bankverbindung und allen Details.",
        barzahlung
          ? "Sie holen Ihre Stücke im Geschäft in Schorndorf ab und zahlen bequem vor Ort."
          : "Nach Zahlungseingang liegen Ihre Stücke im Geschäft in Schorndorf zur Abholung bereit.",
      ]
    : [
        "Wir prüfen Ihre Bestellung und reservieren die Stücke für Sie.",
        "Sie erhalten unsere Bestellbestätigung mit Bankverbindung und allen Details.",
        "Nach Zahlungseingang versenden wir wertversichert, neutral verpackt und mit Sendungsverfolgung.",
      ];

  return (
    <PageShell>
      <div className="max-w-edge mx-auto px-4 pb-24 pt-16">
        <div className="mx-auto max-w-xl">
          {/* The shop sign, then the thanks — a calm brand moment */}
          <div className="text-center">
            <BrandPlaque className="mx-auto w-40 text-ink sm:w-44" />
            <Kicker className="mt-10 justify-center">Ihre Bestellung</Kicker>
            <h1 className="mt-3 font-display text-4xl font-semibold text-ink md:text-5xl">
              Vielen Dank.
            </h1>
            <p className="mt-3 text-lg leading-relaxed text-ink-aged">
              Wir melden uns umgehend.
            </p>
            <BrandRule className="mx-auto mt-8 block w-44 text-gilt" />
          </div>

          {/* Bestellübersicht: only when the Kasse handed a recap over,
              a direct visit keeps the composed generic state below */}
          <OrderRecap />

          {/* Was passiert jetzt */}
          <section aria-labelledby="naechste-schritte" className="mt-12 rounded-card border border-rule bg-card p-5 shadow-card sm:p-6">
            <Kicker className="mb-1.5">Was passiert jetzt</Kicker>
            <h2 id="naechste-schritte" className="font-display text-xl font-semibold text-ink">
              Die nächsten Schritte
            </h2>
            <ol className="mt-4 divide-y divide-rule">
              {steps.map((text, i) => (
                <li key={text} className="flex items-start gap-3.5 py-4">
                  <span
                    aria-hidden="true"
                    className="tnum grid h-9 w-9 shrink-0 place-items-center rounded-full border border-rule font-display text-base font-semibold text-ink"
                  >
                    {i + 1}
                  </span>
                  <p className="pt-1.5 text-sm leading-relaxed text-ink-aged">{text}</p>
                </li>
              ))}
            </ol>
            <p className="border-t border-rule pt-4 text-sm leading-relaxed text-ink-aged">
              Fragen zu Ihrer Bestellung? Wir sind persönlich für Sie da,{" "}
              <Link href="/kontakt" className="font-medium text-ink underline underline-offset-2 hover:text-ink-aged">
                telefonisch oder per Nachricht
              </Link>
              .
            </p>
          </section>

          {/* Vorschau notice — honest by design, no invented order number */}
          <div className="mt-5 flex gap-3 rounded-button border border-rule bg-raised p-4">
            <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-ink-aged" />
            <p className="text-sm leading-relaxed text-ink-aged">
              Vorschau-Modus: Die Online-Bestellung wird mit dem Livegang freigeschaltet.
              Es wurde keine Bestellung übermittelt und keine Bestellnummer vergeben.
            </p>
          </div>

          {/* Actions — full width on the phone, 48px touch targets */}
          <div className="mt-10 flex flex-col items-stretch gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/kollektion"
              className="inline-flex min-h-[48px] items-center justify-center rounded-button bg-ink px-8 py-3 text-sm font-semibold text-white shadow-card transition-opacity hover:opacity-90"
            >
              Weiter einkaufen
            </Link>
            {abholung ? (
              <Link
                href="/termin"
                className="inline-flex min-h-[48px] items-center justify-center rounded-button border border-rule px-8 py-3 text-sm font-semibold text-ink transition-colors hover:border-ink"
              >
                Termin zur Abholung vereinbaren
              </Link>
            ) : (
              <Link
                href="/"
                className="inline-flex min-h-[48px] items-center justify-center rounded-button border border-rule px-8 py-3 text-sm font-semibold text-ink transition-colors hover:border-ink"
              >
                Zur Startseite
              </Link>
            )}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
