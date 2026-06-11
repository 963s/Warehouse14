"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Lock, Mail, Package, UserRound, MapPin } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { Reveal } from "@/components/ui/reveal";
import { GoogleG, AppleLogo } from "@/components/brand-icons";
import { data } from "@/lib/storefront-data";

type Account = {
  fullName: string;
  emailMasked: string;
  preferredLanguage: string;
  marketingConsent: boolean;
  address: {
    recipientName: string;
    line1: string;
    line2?: string;
    postalCode: string;
    city: string;
    country: string;
  } | null;
};

const HUB_CARDS = [
  {
    href: "/konto/bestellungen",
    title: "Bestellungen",
    description: "Alle Ihre Bestellungen im Überblick, inklusive Status und Lieferverfolgung.",
    icon: Package,
  },
  {
    href: "/konto/profil",
    title: "Mein Profil",
    description: "Name, Sprache und Kommunikationspräferenzen anpassen.",
    icon: UserRound,
  },
  {
    href: "/konto/adressbuch",
    title: "Adressbuch",
    description: "Gespeicherte Liefer- und Rechnungsadressen verwalten.",
    icon: MapPin,
  },
] as const;

function LoginGate() {
  return (
    <PageShell>
      <div className="mx-auto max-w-edge px-5 py-16 md:py-32 text-center space-y-8">
        <Reveal>
          <div className="space-y-4">
            <span className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-card shadow-card">
              <Lock aria-hidden="true" className="h-9 w-9 text-ink-faded" strokeWidth={1.6} />
            </span>
            <h1 className="font-display text-3xl md:text-4xl font-semibold text-ink">
              Mein Konto
            </h1>
            <p className="text-ink-aged max-w-md mx-auto leading-relaxed">
              Bitte melden Sie sich an, um auf Ihr Konto zuzugreifen. Sie können sich mit
              Google, Apple oder Ihrer E-Mail-Adresse einloggen.
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/anmelden"
              className="inline-flex min-h-[48px] items-center justify-center rounded-button bg-ink px-8 py-3 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 transition-opacity"
            >
              Anmelden
            </Link>
            <Link
              href="/registrieren"
              className="inline-flex min-h-[48px] items-center justify-center rounded-button border border-rule px-8 py-3 text-sm font-medium text-ink hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 transition-colors"
            >
              Konto erstellen
            </Link>
          </div>
        </Reveal>

        <Reveal delay={0.18}>
          <div className="mx-auto max-w-sm bg-card border border-rule rounded-card p-5 text-left space-y-3">
            <p className="text-xs font-medium text-ink-faded uppercase tracking-wider">
              Anmeldeoptionen
            </p>
            <ul className="space-y-2 text-sm text-ink-aged">
              <li className="flex min-h-[28px] items-center gap-2.5">
                <Mail aria-hidden="true" className="h-[18px] w-[18px] text-ink-faded" strokeWidth={1.7} /> E-Mail und Passwort
              </li>
              <li className="flex min-h-[28px] items-center gap-2.5">
                <GoogleG aria-hidden="true" className="h-[18px] w-[18px]" /> Google-Konto
              </li>
              <li className="flex min-h-[28px] items-center gap-2.5">
                <AppleLogo aria-hidden="true" className="h-[18px] w-[18px]" /> Apple-ID
              </li>
            </ul>
          </div>
        </Reveal>
      </div>
    </PageShell>
  );
}

export default function KontoPage() {
  const [account, setAccount] = useState<Account | null | "loading">("loading");

  useEffect(() => {
    data.getAccount().then(setAccount).catch(() => setAccount(null));
  }, []);

  if (account === "loading") {
    return (
      <PageShell>
        <div aria-busy="true" role="status" className="mx-auto max-w-edge px-5 py-20 text-center text-ink-faded text-sm">
          Laden ...
        </div>
      </PageShell>
    );
  }

  if (account === null) {
    return <LoginGate />;
  }

  async function handleSignOut() {
    await data.signOut();
    window.location.href = "/";
  }

  return (
    <PageShell>
      <div className="mx-auto max-w-edge px-5 py-16 md:py-24 space-y-12">
        <Reveal>
          <header className="space-y-2">
            <h1 className="font-display text-3xl md:text-4xl font-semibold text-ink">
              Mein Konto
            </h1>
            <p className="text-ink-aged">
              Willkommen zurück, {account.fullName}. ({account.emailMasked})
            </p>
          </header>
        </Reveal>

        <Reveal delay={0.08}>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {HUB_CARDS.map((card) => (
              <Link
                key={card.href}
                href={card.href}
                className="group bg-card border border-rule rounded-card shadow-card p-6 space-y-3 hover:shadow-lift transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
              >
                <span className="grid h-10 w-10 place-items-center rounded-button bg-raised">
                  <card.icon aria-hidden="true" className="h-5 w-5 text-ink-aged" strokeWidth={1.7} />
                </span>
                <h2 className="font-display text-lg font-semibold text-ink">
                  {card.title}
                </h2>
                <p className="text-sm text-ink-aged leading-relaxed">
                  {card.description}
                </p>
                <span className="inline-block text-sm font-medium text-ink underline-draw">
                  Öffnen &rarr;
                </span>
              </Link>
            ))}
          </div>
        </Reveal>

        <Reveal delay={0.16}>
          <div className="border-t border-rule pt-8">
            <button
              type="button"
              onClick={handleSignOut}
              className="min-h-[44px] rounded-button border border-rule px-6 py-2.5 text-sm font-medium text-ink-aged hover:text-ink hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink transition-colors"
            >
              Abmelden
            </button>
          </div>
        </Reveal>
      </div>
    </PageShell>
  );
}
