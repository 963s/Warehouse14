"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle } from "lucide-react";
import { Reveal } from "@/components/ui/reveal";
import { Kicker } from "@/components/brand/kicker";
import { BrandRoundel } from "@/components/brand/marks";
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
        {/* phone gets w14-5 padding — 96px of inner air stranded the panel on
            a 390px screen; the wide step returns from md up */}
        <div className="bg-ink-deep hairline relative overflow-hidden rounded-card px-5 py-w14-5 text-ink sm:px-8 md:px-14 md:py-w14-6">
          {/* the registered 14 roundel as a faint ink watermark, never redrawn */}
          <BrandRoundel className="pointer-events-none absolute -bottom-20 -right-10 hidden h-auto w-80 select-none text-ink opacity-[0.04] md:block" />
          <div className="relative grid items-center gap-w14-4 md:grid-cols-[1.1fr_0.9fr]">
            <div>
              <Kicker className="mb-w14-2">Newsletter</Kicker>
              <h2 className="font-display text-fluid-h2 font-semibold text-ink">
                Marktbewegungen und neue Unikate zuerst
              </h2>
              <p className="mt-w14-2 max-w-md text-fluid-body text-ink-aged">
                Kursbewegungen, frisch eingetroffene Stücke und Einschätzungen unserer
                Experten, etwa zweimal im Monat, ohne Eile.
              </p>
            </div>

            <div aria-live="polite" aria-atomic="true">
              {status === "success" ? (
                <div className="flex items-center gap-3 rounded-button border border-rule bg-card px-5 py-4 shadow-card">
                  <CheckCircle className="h-5 w-5 shrink-0 text-verdigris" strokeWidth={1.8} aria-hidden="true" />
                  <p className="text-sm font-medium leading-snug text-ink">
                    Vielen Dank. Sie sind angemeldet.
                  </p>
                </div>
              ) : (
                <form className="flex flex-col gap-3 sm:flex-row" onSubmit={handleSubmit} noValidate>
                  <div className="flex w-full flex-col gap-1.5">
                    <label htmlFor="newsletter-email" className="sr-only">
                      E-Mail-Adresse
                    </label>
                    {/* text-base keeps iOS from zoom-jumping into the field */}
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
                      className="min-h-[48px] w-full rounded-button border border-rule bg-card px-4 py-3.5 text-base text-ink transition-colors duration-fast ease-hover placeholder:text-ink-faded focus-visible:border-ink-faded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:color-mix(in_srgb,var(--w14-ink)_18%,transparent)]"
                    />
                    {hasError && (
                      <p id="newsletter-error" role="alert" className="text-xs text-wax-red">
                        {errorMsg}
                      </p>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={status === "sending"}
                    className="inline-flex min-h-[48px] shrink-0 items-center justify-center gap-2 rounded-button bg-ink px-6 py-3.5 font-semibold text-white transition-[transform,background-color] duration-base ease-hover hover:-translate-y-0.5 hover:bg-ink-aged disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {status === "sending" ? "Bitte warten …" : "Abonnieren"}
                    <ArrowRight className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
                  </button>
                </form>
              )}
            </div>
          </div>
          <p className="relative mt-w14-2 text-xs text-ink-faded">
            Jederzeit abbestellbar. Es gilt unsere Datenschutzerklärung. Kein Spam.
          </p>
        </div>
      </Reveal>
    </section>
  );
}
