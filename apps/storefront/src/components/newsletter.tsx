"use client";

import { useState } from "react";
import { Mail, ArrowRight, CheckCircle } from "lucide-react";
import { Reveal } from "@/components/ui/reveal";
import { data } from "@/lib/storefront-data";

export function Newsletter() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("sending");
    setErrorMsg("");
    try {
      await data.subscribeNewsletter(email.trim());
      setStatus("success");
    } catch {
      setErrorMsg("Anmeldung fehlgeschlagen. Bitte versuchen Sie es erneut.");
      setStatus("error");
    }
  }

  const hasError = status === "error";

  return (
    <section className="px-5 py-w14-5">
      <Reveal className="mx-auto max-w-edge">
        <div className="bg-ink-deep relative overflow-hidden rounded-card px-6 py-w14-6 text-white md:px-14">
          <img
            src="/emblem.svg"
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-20 -right-10 hidden w-80 select-none opacity-[0.06] [filter:invert(1)] md:block"
          />
          <div className="relative grid items-center gap-w14-4 md:grid-cols-[1.1fr_0.9fr]">
            <div>
              <div className="eyebrow mb-w14-2 inline-flex items-center gap-2 text-gold">
                <Mail className="h-4 w-4" aria-hidden="true" /> Newsletter
              </div>
              <h2 className="font-display text-fluid-h2 font-semibold text-white">
                Marktbewegungen und neue Unikate zuerst
              </h2>
              <p className="mt-w14-2 max-w-md text-fluid-body text-white/65">
                Kursbewegungen, frisch eingetroffene Stücke und Einschätzungen unserer
                Experten — etwa zweimal im Monat, ohne Eile.
              </p>
            </div>

            <div aria-live="polite" aria-atomic="true">
              {status === "success" ? (
                <div className="flex items-center gap-3 rounded-button border border-white/15 bg-white/5 px-5 py-4">
                  <CheckCircle className="h-5 w-5 shrink-0 text-gold" aria-hidden="true" />
                  <p className="text-sm font-medium leading-snug text-white">
                    Vielen Dank — Sie sind angemeldet.
                  </p>
                </div>
              ) : (
                <form className="flex flex-col gap-3 sm:flex-row" onSubmit={handleSubmit} noValidate>
                  <div className="flex w-full flex-col gap-1.5">
                    <label htmlFor="newsletter-email" className="sr-only">
                      E-Mail-Adresse
                    </label>
                    <input
                      id="newsletter-email"
                      type="email"
                      required
                      autoComplete="email"
                      spellCheck={false}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Ihre E-Mail-Adresse"
                      aria-invalid={hasError}
                      aria-describedby={hasError ? "newsletter-error" : undefined}
                      className="w-full rounded-button border border-white/15 bg-white/5 px-4 py-3.5 text-white transition-colors duration-fast ease-hover placeholder:text-white/40 focus-visible:border-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40"
                    />
                    {hasError && (
                      <p id="newsletter-error" role="alert" className="text-xs text-gold-soft">
                        {errorMsg}
                      </p>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={status === "sending"}
                    className="bg-gold-gradient inline-flex shrink-0 items-center justify-center gap-2 rounded-button px-6 py-3.5 font-semibold text-[#2b210a] transition-transform duration-base ease-hover hover:-translate-y-0.5 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {status === "sending" ? "Bitte warten …" : "Abonnieren"}
                    <ArrowRight className="h-[18px] w-[18px]" aria-hidden="true" />
                  </button>
                </form>
              )}
            </div>
          </div>
          <p className="relative mt-w14-2 text-xs text-white/40">
            Jederzeit abbestellbar. Es gilt unsere Datenschutzerklärung. Kein Spam.
          </p>
        </div>
      </Reveal>
    </section>
  );
}
