import type { Metadata } from "next";
import { ShieldCheck, Clock, TrendingUp } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { AnkaufProcess } from "@/components/ankauf-process";
import { MetalCalculator } from "@/components/goldankauf/metal-calculator";
import { IntakeForm } from "@/components/goldankauf/intake-form";
import { Kicker } from "@/components/brand/kicker";
import { Reveal } from "@/components/ui/reveal";

export const metadata: Metadata = {
  title: "Goldankauf | warehouse14 Schorndorf",
  description:
    "Gold, Silber, Platin, Münzen und Schmuck zum fairen Tagespreis verkaufen, vom Einzelstück bis zum ganzen Nachlass. Kostenlose Bewertung, sachkundige Prüfung und sofortige Auszahlung in Schorndorf.",
};

const TRUST_ITEMS = [
  {
    icon: TrendingUp,
    title: "Faire Tagespreise",
    body: "Wir kaufen auf Basis des aktuellen Londoner Fixings. Kein versteckter Abzug, transparente Berechnung.",
  },
  {
    icon: ShieldCheck,
    title: "GwG-konform dokumentiert",
    body: "Alle Ankäufe werden satzungsgemäß nach dem Geldwäschegesetz erfasst und quittiert.",
  },
  {
    icon: Clock,
    title: "Sofort-Auszahlung",
    body: "Bei Einigung zahlen wir unmittelbar aus, bar oder per Banküberweisung, ganz nach Ihrem Wunsch.",
  },
] as const;

export default function GoldankaufPage() {
  return (
    <PageShell>
      {/* Hero */}
      <section className="border-b border-rule bg-surface py-16 md:py-24">
        <div className="mx-auto max-w-edge px-5">
          <Reveal>
            <Kicker className="mb-3">Ankauf Schorndorf</Kicker>
            <h1 className="font-display text-4xl font-semibold leading-tight text-ink md:text-5xl lg:text-6xl">
              Gold verkaufen
            </h1>
            <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink-aged">
              Faire Tagespreise, sachkundige Bewertung und sofortige Auszahlung. Wir
              kaufen Gold, Silber, Platin, Münzen, Schmuck, Briefmarken und
              Antiquitäten, vom Einzelstück bis zum ganzen Nachlass, kompetent und
              diskret.
            </p>
          </Reveal>

          {/* Vertrauen */}
          <div className="mt-10 grid gap-5 sm:grid-cols-3">
            {TRUST_ITEMS.map((item, i) => (
              <Reveal key={item.title} delay={i * 0.1}>
                <div className="flex gap-4 rounded-card border border-rule bg-card p-5 shadow-card">
                  <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-raised text-ink">
                    <item.icon className="h-[18px] w-[18px]" strokeWidth={1.7} />
                  </div>
                  <div>
                    <h2 className="font-display text-base font-semibold text-ink">
                      {item.title}
                    </h2>
                    <p className="mt-1 text-sm leading-relaxed text-ink-aged">{item.body}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Ablauf */}
      <AnkaufProcess />

      {/* Rechner + Formular */}
      <section className="py-16 md:py-24">
        <div className="mx-auto max-w-edge px-5">
          <Reveal>
            <Kicker className="mb-2">Kostenloses Angebot</Kicker>
            <h2 className="font-display text-3xl font-semibold text-ink md:text-4xl">
              Wert ermitteln und anfragen
            </h2>
            <p className="mt-3 max-w-xl text-ink-aged">
              Berechnen Sie unverbindlich den indikativen Wert Ihres Edelmetalls und
              senden Sie uns anschließend Ihre Anfrage, ob Einzelstück oder ganzer
              Nachlass. Wir melden uns noch am gleichen Werktag.
            </p>
          </Reveal>

          <div className="mt-10 grid gap-10 lg:grid-cols-2">
            {/* Rechner */}
            <Reveal delay={0.08}>
              <MetalCalculator />
            </Reveal>

            {/* Formular */}
            <Reveal delay={0.16}>
              <div className="rounded-card border border-rule bg-card p-6 shadow-card md:p-8">
                <h3 className="font-display text-xl font-semibold text-ink mb-1">
                  Anfrage stellen
                </h3>
                <p className="mb-6 text-sm leading-relaxed text-ink-aged">
                  Beschreiben Sie kurz, was Sie verkaufen möchten. Die Bewertung ist
                  kostenlos und unverbindlich.
                </p>
                <IntakeForm />
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* FAQ / Vertrauens-Fußband (anchor target for the footer FAQ link) */}
      <section id="faq" className="border-t border-rule bg-card py-14 scroll-mt-24">
        <div className="mx-auto max-w-edge px-5">
          <Reveal>
            <h2 className="font-display text-2xl font-semibold text-ink mb-8">
              Häufige Fragen
            </h2>
          </Reveal>
          <div className="grid gap-6 md:grid-cols-2">
            {FAQ.map((faq, i) => (
              <Reveal key={faq.q} delay={i * 0.07}>
                <div className="space-y-2">
                  <h3 className="font-display text-base font-semibold text-ink">
                    {faq.q}
                  </h3>
                  <p className="text-sm leading-relaxed text-ink-aged">{faq.a}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>
    </PageShell>
  );
}

const FAQ = [
  {
    q: "Welche Unterlagen brauche ich?",
    a: "Gemäß Geldwäschegesetz benötigen wir bei Ankäufen ab 2.000 Euro Ihren amtlichen Lichtbildausweis. Für kleinere Beträge genügt ein formloser Nachweis.",
  },
  {
    q: "Wie schnell erhalte ich mein Geld?",
    a: "Bei Einigung zahlen wir sofort, entweder bar oder per Sofortüberweisung. Geldeingang auf Ihrem Konto in der Regel noch am selben Tag.",
  },
  {
    q: "Nehmen Sie auch angelaufenes Silber oder beschädigten Schmuck?",
    a: "Ja. Anlauf und leichte Beschädigungen mindern den Wert kaum, da wir das Material nach Feingehalt und Gewicht bewerten, nicht nach optischem Zustand.",
  },
  {
    q: "Kann ich Objekte auch einsenden?",
    a: "Ja, nach vorheriger Absprache. Wir empfehlen versicherten Versand. Kosten und Risiko trägt der Einsender bis zur Bewertung; bei Nichteinigung senden wir kostenlos zurück.",
  },
  {
    q: "Bewerten Sie auch Münzsammlungen und Nachlass?",
    a: "Ja, sehr gerne. Wir kommen bei größeren Konvoluten oder aus Gesundheitsgründen auch zu Ihnen nach Hause, nach vorheriger Terminvereinbarung.",
  },
  {
    q: "Was passiert, wenn ich das Angebot ablehne?",
    a: "Kein Problem. Bewertung und Angebot sind kostenlos und unverbindlich. Wir geben Ihnen Ihre Gegenstände selbstverständlich unverzüglich zurück.",
  },
] as const;
