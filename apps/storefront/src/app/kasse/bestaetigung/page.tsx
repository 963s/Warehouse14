import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Package, Mail } from "lucide-react";
import { PageShell } from "@/components/page-shell";

export const metadata: Metadata = {
  title: "Bestellung bestätigt | warehouse14",
  description: "Ihre Bestellung wurde erfolgreich entgegengenommen.",
};

export default function BestaetigenPage() {
  return (
    <PageShell>
      <div className="max-w-edge mx-auto px-4 pb-24 pt-16">
        <div className="mx-auto max-w-xl text-center">
          {/* Checkmark */}
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[#bf9430]/12">
            <CheckCircle2 className="h-11 w-11 text-[#bf9430]" strokeWidth={1.5} aria-hidden="true" />
          </div>

          {/* Heading */}
          <h1 className="mt-7 font-display text-3xl font-semibold text-ink md:text-4xl">
            Vielen Dank für Ihre Bestellung
          </h1>
          <p className="mt-3 text-base text-ink-aged">
            Ihre Bestellung ist bei uns eingegangen und wird nun bearbeitet.
          </p>

          {/* Info cards */}
          <div className="mt-10 grid gap-4 sm:grid-cols-2 text-left">
            <div className="rounded-card border border-rule bg-card p-5 shadow-card">
              <div className="flex items-center gap-3">
                <Mail className="h-5 w-5 shrink-0 text-[#bf9430]" aria-hidden="true" />
                <h2 className="font-semibold text-ink">Bestätigungsmail</h2>
              </div>
              <p className="mt-2 text-sm text-ink-aged leading-relaxed">
                Eine Bestätigungsmail mit Ihrer Bestellnummer und dem Kassenbeleg
                wird in Kurze an Ihre Adresse gesendet.
              </p>
            </div>

            <div className="rounded-card border border-rule bg-card p-5 shadow-card">
              <div className="flex items-center gap-3">
                <Package className="h-5 w-5 shrink-0 text-[#bf9430]" aria-hidden="true" />
                <h2 className="font-semibold text-ink">Versand</h2>
              </div>
              <p className="mt-2 text-sm text-ink-aged leading-relaxed">
                Den aktuellen Status Ihrer Bestellung können Sie jederzeit unter{" "}
                <Link
                  href="/konto/bestellungen"
                  className="font-medium text-[#bf9430] hover:underline"
                >
                  Mein Konto, Bestellungen
                </Link>{" "}
                einsehen.
              </p>
            </div>
          </div>

          {/* Fiscal note */}
          <div className="mt-6 rounded-button border border-rule bg-surface px-5 py-4 text-sm text-ink-faded text-left leading-relaxed">
            Der Kassenbeleg wird automatisch nach Zahlungseingang ausgestellt und
            entspricht den Anforderungen der Kassensicherungsverordnung (KassenSichV).
            Sie erhalten ihn zusammen mit der Bestätigungsmail.
          </div>

          {/* Actions */}
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/kollektion"
              className="rounded-button bg-[#bf9430] px-8 py-3 text-sm font-semibold text-white shadow-card transition-opacity hover:opacity-90"
            >
              Weiter einkaufen
            </Link>
            <Link
              href="/konto/bestellungen"
              className="rounded-button border border-rule px-8 py-3 text-sm font-semibold text-ink transition-colors hover:border-[#bf9430] hover:text-[#bf9430]"
            >
              Meine Bestellungen
            </Link>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
