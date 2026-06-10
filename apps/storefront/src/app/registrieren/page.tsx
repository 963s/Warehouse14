"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { PageShell } from "@/components/page-shell";
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
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-gold/10 text-gold ring-gold-soft">
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
                  className="w-full rounded-button border border-rule bg-surface px-4 py-3 text-ink placeholder:text-ink-faded focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
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
                  className="w-full rounded-button border border-rule bg-surface px-4 py-3 text-ink placeholder:text-ink-faded focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
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
                  className="w-full rounded-button border border-rule bg-surface px-4 py-3 text-ink placeholder:text-ink-faded focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
                />
              </div>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={marketingConsent}
                  onChange={(e) => setMarketingConsent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-rule accent-gold"
                />
                <span className="text-xs text-ink-aged leading-relaxed">
                  Ich möchte gelegentlich Neuigkeiten zu Angeboten und Neuankünften per E-Mail
                  erhalten. Eine Abmeldung ist jederzeit möglich. (optional)
                </span>
              </label>

              {error && (
                <p role="alert" className="rounded-button bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={pending}
                className="w-full rounded-button border border-ink/15 bg-ink px-4 py-3 text-[0.95rem] font-semibold text-white transition-transform hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {pending ? "Konto wird erstellt..." : "Konto erstellen"}
              </button>
            </form>

            <p className="text-center text-sm text-ink-aged">
              Bereits ein Konto?{" "}
              <Link href="/anmelden" className="text-gold font-medium hover:underline">
                Anmelden
              </Link>
            </p>

            <p className="flex items-start gap-2 text-xs leading-relaxed text-ink-faded">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-verdigris" aria-hidden="true" />
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
            </p>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
