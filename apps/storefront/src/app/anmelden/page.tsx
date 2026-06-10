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
      setError("Anmeldung fehlgeschlagen. Bitte E-Mail-Adresse und Passwort pruefen.");
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
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-gold/10 text-gold ring-gold-soft" aria-hidden="true">
                <Coin className="h-9 w-9" />
              </span>
              <h1 className="font-display text-2xl font-semibold text-ink">Anmelden</h1>
              <p className="text-sm text-ink-aged">
                Willkommen zurück. Melden Sie sich an, um Ihr Konto zu nutzen.
              </p>
            </div>

            <div className="space-y-3">
              <button
                type="button"
                className="flex w-full items-center justify-center gap-3 rounded-button border border-rule bg-white px-4 py-3 text-[0.95rem] font-medium text-[#1f1f1f] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-card"
              >
                <GoogleG className="h-5 w-5" aria-hidden="true" /> Mit Google fortfahren
              </button>
              <button
                type="button"
                className="flex w-full items-center justify-center gap-2.5 rounded-button bg-black px-4 py-3 text-[0.95rem] font-medium text-white transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-lift"
              >
                <AppleLogo className="h-[19px] w-[19px]" aria-hidden="true" /> Mit Apple fortfahren
              </button>
              <p className="text-center text-xs text-ink-faded">
                Anmeldung uber Google und Apple folgt
              </p>
            </div>

            <div className="flex items-center gap-3 text-xs text-ink-faded">
              <span className="h-px flex-1 bg-rule" />
              oder
              <span className="h-px flex-1 bg-rule" />
            </div>

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
                  className="w-full rounded-button border border-rule bg-surface px-4 py-3 text-ink focus:outline-none placeholder:text-ink-faded focus:border-gold focus:ring-2 focus:ring-gold/30"
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
                  className="w-full rounded-button border border-rule bg-surface px-4 py-3 text-ink focus:outline-none placeholder:text-ink-faded focus:border-gold focus:ring-2 focus:ring-gold/30"
                />
              </div>

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
                {pending ? "Anmeldung laeuft..." : "Anmelden"}
              </button>
            </form>

            <p className="text-center text-sm text-ink-aged">
              Noch kein Konto?{" "}
              <Link href="/registrieren" className="text-gold font-medium hover:underline">
                Jetzt registrieren
              </Link>
            </p>

            <p className="flex items-start gap-2 text-xs leading-relaxed text-ink-faded">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-verdigris" aria-hidden="true" />
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
            </p>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
