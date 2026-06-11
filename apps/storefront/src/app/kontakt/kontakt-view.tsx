"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { PageHeader, PageShell } from "@/components/page-shell";
import { WhatsAppIcon } from "@/components/brand-icons";
import { Reveal } from "@/components/ui/reveal";
import { waLink } from "@/lib/contact";
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
          <PageHeader
            eyebrow="Kontor Schorndorf"
            title="Kontakt"
            lead="Wir sind gerne persönlich, telefonisch oder per Nachricht für Sie da. Kommen Sie einfach vorbei oder schreiben Sie uns."
          />
        </Reveal>

        {/* Die direkte Alternative: WhatsApp statt Formular. */}
        <Reveal delay={0.04}>
          <div className="flex flex-col gap-3 rounded-card border border-rule bg-card p-4 sm:flex-row sm:items-center">
            <p className="text-sm leading-relaxed text-ink-aged sm:mr-auto">
              Oder direkt per WhatsApp: Schreiben Sie uns Ihre Frage, wir
              antworten so schnell wie möglich.
            </p>
            <a
              href={waLink("Guten Tag, ich habe eine Frage an warehouse14.")}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2.5 rounded-button border border-ink/25 bg-card px-5 py-2.5 text-sm font-medium text-ink transition-colors duration-fast ease-hover hover:border-[#25D366]/60"
            >
              <WhatsAppIcon className="h-[18px] w-[18px] text-[#25D366]" />
              WhatsApp öffnen
            </a>
          </div>
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
                <p className="font-medium text-ink">warehouse14</p>
                <p>Musterstraße 14</p>
                <p>73614 Schorndorf</p>
              </address>
              {/* 44px touch rows: the whole line is the link, not just a word. */}
              <div className="pt-2 text-ink-aged text-sm leading-relaxed">
                <p>
                  <a
                    href="tel:+497181000000"
                    className="inline-flex min-h-[44px] items-center gap-1.5 transition-colors duration-fast ease-hover hover:text-ink"
                  >
                    <span className="font-medium text-ink">Telefon</span>
                    <span className="tnum">+49 (0)7181 000000</span>
                  </a>
                </p>
                <p>
                  <a
                    href="mailto:hallo@warehouse14.de"
                    className="inline-flex min-h-[44px] items-center gap-1.5 transition-colors duration-fast ease-hover hover:text-ink"
                  >
                    <span className="font-medium text-ink">E-Mail</span>
                    hallo@warehouse14.de
                  </a>
                </p>
                <p>
                  <a
                    href={waLink()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[44px] items-center gap-1.5 transition-colors duration-fast ease-hover hover:text-ink"
                  >
                    <span className="font-medium text-ink">WhatsApp</span>
                    Nachricht senden
                    <WhatsAppIcon className="h-4 w-4 text-[#25D366]" />
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
                <p className="font-display text-xl font-semibold text-ink">
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
                      className="min-h-[44px] w-full rounded-button border border-rule bg-surface px-4 py-2.5 text-base text-ink placeholder:text-ink-faded focus:outline-none focus:ring-2 focus:ring-ink/40 transition-[border-color,box-shadow]"
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
                      className="min-h-[44px] w-full rounded-button border border-rule bg-surface px-4 py-2.5 text-base text-ink placeholder:text-ink-faded focus:outline-none focus:ring-2 focus:ring-ink/40 transition-[border-color,box-shadow]"
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
                    className="w-full resize-none rounded-button border border-rule bg-surface px-4 py-2.5 text-base text-ink placeholder:text-ink-faded focus:outline-none focus:ring-2 focus:ring-ink/40 transition-[border-color,box-shadow]"
                  />
                </div>

                {status === "error" && (
                  <p role="alert" className="text-sm text-wax-red">
                    Leider ist etwas schiefgelaufen. Bitte versuchen Sie es
                    erneut oder schreiben Sie uns direkt per E-Mail.
                  </p>
                )}

                <button
                  type="submit"
                  disabled={status === "sending"}
                  className="inline-flex min-h-[48px] w-full items-center justify-center rounded-button bg-ink px-7 py-2.5 text-sm font-semibold text-white transition-[background-color,box-shadow] duration-fast ease-hover hover:bg-ink-aged focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40 disabled:opacity-60 disabled:cursor-not-allowed sm:w-auto"
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
