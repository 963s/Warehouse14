"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { GoogleG, AppleLogo } from "@/components/brand-icons";
import { Coin } from "@/components/logo";
import { data } from "@/lib/storefront-data";

export default function AnmeldenPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await data.signIn({ email, password });
      router.push("/konto");
    } catch {
      setError("Anmeldung fehlgeschlagen. Bitte E-Mail-Adresse und Passwort prüfen.");
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
              <h1 className="font-display text-2xl font-semibold text-ink">Anmelden</h1>
              <p className="text-sm text-ink-aged">
                Willkommen zurück. Melden Sie sich an, um Ihr Konto zu nutzen.
              </p>
            </div>

            {/* E-Mail ist der einzige aktive Weg und steht deshalb zuerst */}
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-3">
                <label htmlFor="anmelden-email" className="sr-only">E-Mail-Adresse</label>
                <input
                  id="anmelden-email"
                  type="email"
                  placeholder="E-Mail-Adresse"
                  required
                  autoComplete="email"
                  spellCheck={false}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="min-h-[48px] w-full rounded-button border border-rule bg-surface px-4 py-3 text-base text-ink focus:outline-none placeholder:text-ink-faded focus:border-ink focus:ring-2 focus:ring-[rgba(28,28,28,0.12)]"
                />
                <label htmlFor="anmelden-password" className="sr-only">Passwort</label>
                <input
                  id="anmelden-password"
                  type="password"
                  placeholder="Passwort"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="min-h-[48px] w-full rounded-button border border-rule bg-surface px-4 py-3 text-base text-ink focus:outline-none placeholder:text-ink-faded focus:border-ink focus:ring-2 focus:ring-[rgba(28,28,28,0.12)]"
                />
              </div>

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
                {pending ? "Anmeldung läuft ..." : "Anmelden"}
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
                Anmeldung über Google und Apple folgt
              </p>
            </div>

            <p className="text-center text-sm text-ink-aged">
              Noch kein Konto?{" "}
              <Link href="/registrieren" className="text-ink font-medium underline underline-offset-4 hover:text-ink-aged">
                Jetzt registrieren
              </Link>
            </p>

            {/* icon + one text span: bare flex children would otherwise lay out as columns */}
            <p className="flex items-start gap-2 text-xs leading-relaxed text-ink-faded">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-verdigris" aria-hidden="true" />
              <span>
                Ihre Daten werden sicher gespeichert und ausschließlich zur Kontoabwicklung
                verwendet. Es gelten unsere{" "}
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
