"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
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

type SaveStatus = "idle" | "saving" | "saved" | "error";

function LoginGate() {
  return (
    <PageShell>
      <div className="mx-auto max-w-edge px-5 py-20 md:py-32 text-center space-y-8">
        <Reveal>
          <div className="space-y-4">
            <span className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-card shadow-card">
              <Lock aria-hidden="true" className="h-9 w-9 text-ink-faded" strokeWidth={1.6} />
            </span>
            <h1 className="font-display text-3xl md:text-4xl font-semibold text-ink">
              Mein Profil
            </h1>
            <p className="text-ink-aged max-w-md mx-auto leading-relaxed">
              Bitte melden Sie sich an, um Ihr Profil einzusehen und zu bearbeiten.
            </p>
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <Link
            href="/anmelden"
            className="inline-flex min-h-[48px] items-center rounded-button bg-ink px-8 py-3 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 transition-opacity"
          >
            Anmelden
          </Link>
        </Reveal>
      </div>
    </PageShell>
  );
}

export default function ProfilPage() {
  const [account, setAccount] = useState<Account | null | "loading">("loading");
  const [fullName, setFullName] = useState("");
  const [preferredLanguage, setPreferredLanguage] = useState<"de" | "en" | "ar">("de");
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  useEffect(() => {
    data
      .getAccount()
      .then((acc) => {
        setAccount(acc);
        if (acc) {
          setFullName(acc.fullName);
          setPreferredLanguage(
            (acc.preferredLanguage as "de" | "en" | "ar") ?? "de",
          );
          setMarketingConsent(acc.marketingConsent);
        }
      })
      .catch(() => setAccount(null));
  }, []);

  if (account === "loading") {
    return (
      <PageShell>
        <div className="mx-auto max-w-edge px-5 py-20 text-center text-ink-faded text-sm">
          Laden ...
        </div>
      </PageShell>
    );
  }

  if (account === null) {
    return <LoginGate />;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaveStatus("saving");
    try {
      await data.updateAccount({ fullName, preferredLanguage, marketingConsent });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch {
      setSaveStatus("error");
    }
  }

  return (
    <PageShell>
      <div className="mx-auto max-w-2xl px-5 py-16 md:py-24 space-y-10">
        <Reveal>
          <div className="flex items-center gap-4">
            <Link
              href="/konto"
              className="inline-flex min-h-[44px] items-center text-ink-faded text-sm hover:text-ink transition-colors"
            >
              &larr; Mein Konto
            </Link>
          </div>
          <div className="mt-4 space-y-2">
            <h1 className="font-display text-3xl md:text-4xl font-semibold text-ink">
              Mein Profil
            </h1>
            <p className="text-ink-aged text-sm">
              Angemeldet als {account.emailMasked}
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.08}>
          <form
            onSubmit={handleSubmit}
            className="bg-card border border-rule rounded-card shadow-card p-6 md:p-8 space-y-7"
            noValidate
          >
            <h2 className="font-display text-xl font-semibold text-ink">
              Persönliche Angaben
            </h2>

            {/* Vollständiger Name */}
            <div className="space-y-1.5">
              <label
                htmlFor="fullName"
                className="block text-sm font-medium text-ink"
              >
                Vollständiger Name
              </label>
              <input
                id="fullName"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
                placeholder="Vor- und Nachname"
                className="min-h-[44px] w-full rounded-button border border-rule bg-surface px-4 py-2.5 text-base text-ink placeholder:text-ink-faded focus:outline-none focus:border-ink focus:ring-2 focus:ring-[rgba(28,28,28,0.12)] transition-shadow"
              />
            </div>

            {/* Bevorzugte Sprache */}
            <div className="space-y-1.5">
              <label
                htmlFor="preferredLanguage"
                className="block text-sm font-medium text-ink"
              >
                Bevorzugte Sprache
              </label>
              <select
                id="preferredLanguage"
                value={preferredLanguage}
                onChange={(e) =>
                  setPreferredLanguage(e.target.value as "de" | "en" | "ar")
                }
                className="min-h-[44px] w-full cursor-pointer rounded-button border border-rule bg-surface px-4 py-2.5 text-base text-ink focus:outline-none focus:border-ink focus:ring-2 focus:ring-[rgba(28,28,28,0.12)] transition-shadow"
              >
                <option value="de">Deutsch</option>
                <option value="en">Englisch</option>
                <option value="ar">Arabisch</option>
              </select>
              <p className="text-xs text-ink-faded">
                Wird für Rechnungen, Bestätigungen und den Newsletter verwendet.
              </p>
            </div>

            {/* Marketing-Zustimmung */}
            <div className="border-t border-rule pt-5 space-y-3">
              <h3 className="text-sm font-semibold text-ink">
                Kommunikation
              </h3>
              <label className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={marketingConsent}
                  onChange={(e) => setMarketingConsent(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 rounded border-rule accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1 transition"
                />
                <span className="text-sm text-ink-aged leading-relaxed group-hover:text-ink transition-colors">
                  Ich möchte den Newsletter mit Ankündigungen, neuen Stücken
                  und Sonderangeboten erhalten. Abmeldung jederzeit möglich.
                </span>
              </label>
            </div>

            {/* Hinweis E-Mail */}
            <div className="bg-surface border border-rule rounded-card px-4 py-3 text-xs text-ink-faded leading-relaxed">
              Ihre E-Mail-Adresse ({account.emailMasked}) kann hier nicht
              geändert werden. Bitte wenden Sie sich für Änderungen an
              unseren{" "}
              <Link href="/kontakt" className="text-ink underline hover:text-ink-aged">
                Kundenservice
              </Link>
              .
            </div>

            {/* Fehlermeldung */}
            {saveStatus === "error" && (
              <p role="alert" className="text-sm text-wax-red">
                Beim Speichern ist ein Fehler aufgetreten. Bitte versuchen
                Sie es erneut.
              </p>
            )}

            {/* Erfolg */}
            {saveStatus === "saved" && (
              <p role="status" className="text-sm text-verdigris">
                Ihre Angaben wurden erfolgreich gespeichert.
              </p>
            )}

            <div className="pt-1">
              <button
                type="submit"
                disabled={saveStatus === "saving"}
                className="inline-flex min-h-[48px] w-full items-center justify-center rounded-button bg-ink px-7 py-2.5 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed sm:w-auto"
              >
                {saveStatus === "saving" ? "Wird gespeichert ..." : "Änderungen speichern"}
              </button>
            </div>
          </form>
        </Reveal>
      </div>
    </PageShell>
  );
}
