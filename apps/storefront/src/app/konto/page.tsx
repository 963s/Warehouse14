"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { Reveal } from "@/components/ui/reveal";
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
    icon: "📦",
  },
  {
    href: "/konto/profil",
    title: "Mein Profil",
    description: "Name, Sprache und Kommunikationspräferenzen anpassen.",
    icon: "👤",
  },
  {
    href: "/konto/adressbuch",
    title: "Adressbuch",
    description: "Gespeicherte Liefer- und Rechnungsadressen verwalten.",
    icon: "📍",
  },
] as const;

function LoginGate() {
  return (
    <PageShell>
      <div className="mx-auto max-w-edge px-5 py-20 md:py-32 text-center space-y-8">
        <Reveal>
          <div className="space-y-4">
            <p className="text-5xl">🔐</p>
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
              className="rounded-button bg-gold px-8 py-3 text-sm font-semibold text-white hover:bg-gold/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 transition-[background-color,box-shadow]"
            >
              Anmelden
            </Link>
            <Link
              href="/registrieren"
              className="rounded-button border border-rule px-8 py-3 text-sm font-medium text-ink hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 transition-[background-color,box-shadow]"
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
              <li className="flex items-center gap-2">
                <span className="text-base">✉️</span> E-Mail und Passwort
              </li>
              <li className="flex items-center gap-2">
                <span className="text-base">🔵</span> Google-Konto
              </li>
              <li className="flex items-center gap-2">
                <span className="text-base">⚫</span> Apple-ID
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
            {HUB_CARDS.map((card, i) => (
              <Link
                key={card.href}
                href={card.href}
                className="group bg-card border border-rule rounded-card shadow-card p-6 space-y-3 hover:shadow-lift transition-shadow focus:outline-none focus:ring-2 focus:ring-gold/40"
              >
                <span className="text-3xl">{card.icon}</span>
                <h2 className="font-display text-lg font-semibold text-ink group-hover:text-gold transition-colors">
                  {card.title}
                </h2>
                <p className="text-sm text-ink-aged leading-relaxed">
                  {card.description}
                </p>
                <span className="inline-block text-gold text-sm font-medium">
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
              className="rounded-button border border-rule px-6 py-2.5 text-sm font-medium text-ink-aged hover:text-ink hover:bg-raised focus:outline-none focus:ring-2 focus:ring-gold/40 transition"
            >
              Abmelden
            </button>
          </div>
        </Reveal>
      </div>
    </PageShell>
  );
}
