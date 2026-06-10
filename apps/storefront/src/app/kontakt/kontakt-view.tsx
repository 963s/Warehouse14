"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Reveal } from "@/components/ui/reveal";
import { data } from "@/lib/storefront-data";

export function KontaktView() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    try {
      await data.submitContact({ name: name.trim(), email: email.trim(), message: message.trim() });
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  }

  return (
    <PageShell>
      <article className="mx-auto max-w-3xl px-5 py-16 md:py-24 space-y-16">
        {/* Seitenheader */}
        <Reveal>
          <header className="space-y-4">
            <h1 className="font-display text-4xl md:text-5xl font-semibold text-ink">
              Kontakt
            </h1>
            <p className="text-ink-aged leading-relaxed max-w-xl">
              Wir sind gerne persönlich, telefonisch oder per Nachricht für
              Sie da. Kommen Sie einfach vorbei oder schreiben Sie uns.
            </p>
          </header>
        </Reveal>

        {/* Adresse, Öffnungszeiten, Kontaktdaten */}
        <Reveal delay={0.08}>
          <div className="grid gap-8 sm:grid-cols-2">
            {/* Adressblock */}
            <div className="bg-card rounded-card shadow-card p-6 space-y-2 border border-rule">
              <h2 className="font-display text-xl font-semibold text-ink mb-3">
                Anschrift
              </h2>
              <address className="not-italic text-ink-aged leading-relaxed space-y-1">
                <p className="font-medium text-ink">Warehouse14</p>
                <p>Musterstrasse 14</p>
                <p>73614 Schorndorf</p>
              </address>
              <div className="pt-4 space-y-2 text-ink-aged text-sm leading-relaxed">
                <p>
                  <span className="text-gold font-medium">Telefon&nbsp;</span>
                  <a
                    href="tel:+4971812345678"
                    className="hover:text-gold transition-colors"
                  >
                    +49 7181 234 5678
                  </a>
                </p>
                <p>
                  <span className="text-gold font-medium">E-Mail&nbsp;</span>
                  <a
                    href="mailto:hallo@warehouse14.de"
                    className="hover:text-gold transition-colors"
                  >
                    hallo@warehouse14.de
                  </a>
                </p>
                <p>
                  <span className="text-gold font-medium">WhatsApp&nbsp;</span>
                  <a
                    href="https://wa.me/4971812345678"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-gold transition-colors"
                  >
                    Nachricht senden
                  </a>
                </p>
              </div>
            </div>

            {/* Öffnungszeiten */}
            <div className="bg-card rounded-card shadow-card p-6 border border-rule">
              <h2 className="font-display text-xl font-semibold text-ink mb-4">
                Öffnungszeiten
              </h2>
              <dl className="space-y-2 text-ink-aged text-sm leading-relaxed">
                <div className="flex justify-between gap-4">
                  <dt className="font-medium text-ink">Mo. bis Fr.</dt>
                  <dd>10:00 bis 18:00 Uhr</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="font-medium text-ink">Samstag</dt>
                  <dd>10:00 bis 14:00 Uhr</dd>
                </div>
                <div className="flex justify-between gap-4 pt-2 border-t border-rule text-ink-faded">
                  <dt>So. und Feiertage</dt>
                  <dd>geschlossen</dd>
                </div>
              </dl>
              <p className="mt-5 text-ink-faded text-xs leading-relaxed">
                Außerhalb der Öffnungszeiten erreichen Sie uns per WhatsApp.
                Wir melden uns in der Regel am nächsten Werktag.
              </p>
            </div>
          </div>
        </Reveal>

        {/* Kontaktformular */}
        <Reveal delay={0.14}>
          <section className="bg-card rounded-card shadow-card p-6 md:p-10 border border-rule">
            <h2 className="font-display text-2xl md:text-3xl font-semibold text-ink mb-2">
              Schreiben Sie uns
            </h2>
            <p className="text-ink-aged leading-relaxed mb-8">
              Haben Sie eine Frage zu einem Stück, möchten einen Ankauftermin
              vereinbaren oder benötigen Sie eine Beratung? Wir freuen uns auf
              Ihre Nachricht.
            </p>

            {status === "sent" ? (
              <div className="rounded-card bg-surface border border-rule px-6 py-8 text-center space-y-2">
                <p className="font-display text-xl font-semibold text-gold">
                  Vielen Dank, wir melden uns.
                </p>
                <p className="text-ink-aged text-sm leading-relaxed">
                  Wir haben Ihre Anfrage erhalten und melden uns bald bei Ihnen.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6" noValidate>
                <div className="grid gap-6 sm:grid-cols-2">
                  {/* Name */}
                  <div className="space-y-1.5">
                    <label
                      htmlFor="name"
                      className="block text-sm font-medium text-ink"
                    >
                      Name
                    </label>
                    <input
                      id="name"
                      name="name"
                      type="text"
                      required
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Ihr vollständiger Name"
                      className="w-full rounded-button border border-rule bg-surface px-4 py-2.5 text-ink placeholder:text-ink-faded text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 transition-[border-color,box-shadow]"
                    />
                  </div>

                  {/* E-Mail */}
                  <div className="space-y-1.5">
                    <label
                      htmlFor="email"
                      className="block text-sm font-medium text-ink"
                    >
                      E-Mail-Adresse
                    </label>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="ihre@email.de"
                      className="w-full rounded-button border border-rule bg-surface px-4 py-2.5 text-ink placeholder:text-ink-faded text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 transition-[border-color,box-shadow]"
                    />
                  </div>
                </div>

                {/* Nachricht */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="nachricht"
                    className="block text-sm font-medium text-ink"
                  >
                    Ihre Nachricht
                  </label>
                  <textarea
                    id="nachricht"
                    name="message"
                    required
                    rows={5}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Womit können wir Ihnen helfen?"
                    className="w-full rounded-button border border-rule bg-surface px-4 py-2.5 text-ink placeholder:text-ink-faded text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 transition-[border-color,box-shadow] resize-none"
                  />
                </div>

                {status === "error" && (
                  <p role="alert" className="text-sm text-red-600">
                    Leider ist etwas schiefgelaufen. Bitte versuchen Sie es
                    erneut oder schreiben Sie uns direkt per E-Mail.
                  </p>
                )}

                <button
                  type="submit"
                  disabled={status === "sending"}
                  className="rounded-button bg-gold px-7 py-2.5 text-sm font-semibold text-white hover:bg-gold/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 transition-[background-color,box-shadow] disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {status === "sending"
                    ? "Wird gesendet ..."
                    : "Nachricht senden"}
                </button>
              </form>
            )}
          </section>
        </Reveal>
      </article>
    </PageShell>
  );
}
