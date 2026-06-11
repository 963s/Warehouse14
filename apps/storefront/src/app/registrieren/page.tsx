"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { GoogleG, AppleLogo } from "@/components/brand-icons";
import { Coin } from "@/components/logo";
import { data } from "@/lib/storefront-data";

export default function RegistrierenPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await data.signUp({ email, password, fullName, marketingConsent });
      router.push("/konto");
    } catch {
      setError(
        "Registrierung fehlgeschlagen. Bitte prüfen Sie Ihre Angaben oder versuchen Sie es erneut.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <PageShell>
      <div className="mx-auto max-w-edge px-5 py-16 md:py-28 flex justify-center">
        <div className="w-full max-w-md">
          <div className="bg-card border border-rule rounded-card shadow-card p-8 sm:p-10 space-y-7">
            <div className="text-center space-y-3">
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-rule bg-raised text-ink" aria-hidden="true">
                <Coin className="h-9 w-9" />
              </span>
              <h1 className="font-display text-2xl font-semibold text-ink">Konto erstellen</h1>
              <p className="text-sm text-ink-aged">
                Einmal registrieren, dauerhaft profitieren. Ihre Daten verbleiben in der EU.
              </p>
            </div>

            <div className="rounded-card bg-surface border border-rule px-5 py-4 space-y-1.5">
              <p className="text-xs font-medium text-ink smallcaps">Sicher und unkompliziert</p>
              <p className="text-xs text-ink-aged leading-relaxed">
                Kein Passwort-Chaos: Sie legen ein Passwort fest, das ausschließlich bei uns
                gilt. Alle Daten werden DSGVO-konform auf EU-Servern gespeichert.
              </p>
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-3">
                <label htmlFor="registrieren-name" className="sr-only">Vor- und Nachname</label>
                <input
                  id="registrieren-name"
                  type="text"
                  placeholder="Vor- und Nachname"
                  required
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="min-h-[48px] w-full rounded-button border border-rule bg-surface px-4 py-3 text-base text-ink placeholder:text-ink-faded focus:outline-none focus:border-ink focus:ring-2 focus:ring-[rgba(28,28,28,0.12)]"
                />
                <label htmlFor="registrieren-email" className="sr-only">E-Mail-Adresse</label>
                <input
                  id="registrieren-email"
                  type="email"
                  placeholder="E-Mail-Adresse"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="min-h-[48px] w-full rounded-button border border-rule bg-surface px-4 py-3 text-base text-ink placeholder:text-ink-faded focus:outline-none focus:border-ink focus:ring-2 focus:ring-[rgba(28,28,28,0.12)]"
                />
                <label htmlFor="registrieren-password" className="sr-only">Passwort</label>
                <input
                  id="registrieren-password"
                  type="password"
                  placeholder="Passwort wählen"
                  required
                  autoComplete="new-password"
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="min-h-[48px] w-full rounded-button border border-rule bg-surface px-4 py-3 text-base text-ink placeholder:text-ink-faded focus:outline-none focus:border-ink focus:ring-2 focus:ring-[rgba(28,28,28,0.12)]"
                />
              </div>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={marketingConsent}
                  onChange={(e) => setMarketingConsent(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 rounded border-rule accent-ink"
                />
                <span className="text-xs text-ink-aged leading-relaxed">
                  Ich möchte gelegentlich Neuigkeiten zu Angeboten und Neuankünften per E-Mail
                  erhalten. Eine Abmeldung ist jederzeit möglich. (optional)
                </span>
              </label>

              {error && (
                <p role="alert" className="rounded-button border border-[rgba(192,73,47,0.35)] bg-[rgba(192,73,47,0.07)] px-4 py-2.5 text-sm text-wax-red">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={pending}
                className="min-h-[48px] w-full rounded-button bg-ink px-4 py-3 text-[0.95rem] font-semibold text-white transition-transform hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {pending ? "Konto wird erstellt..." : "Konto erstellen"}
              </button>
            </form>

            <div className="flex items-center gap-3 text-xs text-ink-faded">
              <span className="h-px flex-1 bg-rule" />
              oder
              <span className="h-px flex-1 bg-rule" />
            </div>

            {/* Google und Apple sind bewusst noch nicht angebunden: ehrlich
             * deaktiviert statt scheinbar klickbar, sie kehren später zurück */}
            <div className="space-y-3">
              <button
                type="button"
                disabled
                aria-disabled="true"
                title="Bald verfügbar"
                className="relative flex min-h-[48px] w-full cursor-not-allowed items-center justify-center gap-3 rounded-button border border-rule bg-surface px-4 py-3 text-[0.95rem] font-medium text-ink-faded"
              >
                <GoogleG className="h-5 w-5 opacity-50 grayscale" aria-hidden="true" /> Mit Google fortfahren
                <span className="absolute -top-2 right-3 rounded-full border border-rule bg-raised px-2 py-0.5 text-[0.6875rem] leading-4 text-ink-faded">
                  Bald verfügbar
                </span>
              </button>
              <button
                type="button"
                disabled
                aria-disabled="true"
                title="Bald verfügbar"
                className="relative flex min-h-[48px] w-full cursor-not-allowed items-center justify-center gap-2.5 rounded-button border border-rule bg-surface px-4 py-3 text-[0.95rem] font-medium text-ink-faded"
              >
                <AppleLogo className="h-[19px] w-[19px] opacity-50" aria-hidden="true" /> Mit Apple fortfahren
                <span className="absolute -top-2 right-3 rounded-full border border-rule bg-raised px-2 py-0.5 text-[0.6875rem] leading-4 text-ink-faded">
                  Bald verfügbar
                </span>
              </button>
              <p className="text-center text-xs text-ink-faded">
                Registrierung über Google und Apple folgt
              </p>
            </div>

            <p className="text-center text-sm text-ink-aged">
              Bereits ein Konto?{" "}
              <Link href="/anmelden" className="text-ink font-medium underline underline-offset-4 hover:text-ink-aged">
                Anmelden
              </Link>
            </p>

            {/* icon + one text span: bare flex children would otherwise lay out as columns */}
            <p className="flex items-start gap-2 text-xs leading-relaxed text-ink-faded">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-verdigris" aria-hidden="true" />
              <span>
                Ihre Daten werden ausschließlich in der EU gespeichert und niemals an Dritte
                weitergegeben. Mit der Registrierung akzeptieren Sie unsere{" "}
                <Link href="/agb" className="underline hover:text-ink-aged">
                  AGB
                </Link>{" "}
                und{" "}
                <Link href="/datenschutz" className="underline hover:text-ink-aged">
                  Datenschutzbestimmungen
                </Link>
                .
              </span>
            </p>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
