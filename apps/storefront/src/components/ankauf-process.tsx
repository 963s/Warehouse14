import { ScanLine, BadgeCheck, Banknote, ArrowRight } from "lucide-react";
import { Reveal } from "@/components/ui/reveal";
import { metalRates, eur } from "@/lib/placeholder-data";

const steps = [
  {
    icon: ScanLine,
    title: "Bewerten lassen",
    body: "Foto hochladen oder vorbeibringen. Wir bestimmen Material, Gewicht und Tagespreis, transparent und kostenlos.",
  },
  {
    icon: BadgeCheck,
    title: "Prüfen & Angebot",
    body: "Sachkundige Prüfung im Haus. Sie erhalten ein faires, schriftliches Angebot auf Basis des Live-Goldkurses.",
  },
  {
    icon: Banknote,
    title: "Sofort-Auszahlung",
    body: "Bei Zustimmung zahlen wir sofort aus, bar oder per Überweisung, GwG-konform dokumentiert.",
  },
];

export function AnkaufProcess() {
  const gold = metalRates[0];
  return (
    <section id="ankauf" className="border-y border-rule bg-card py-section">
      <div className="mx-auto max-w-edge px-5">
        <div className="grid items-center gap-w14-5 lg:grid-cols-[0.9fr_1.1fr]">
          <Reveal>
            <p className="eyebrow text-gold">Goldankauf</p>
            <h2 className="mt-w14-3 font-display text-fluid-h2 font-medium leading-tight">
              Gold verkaufen in&nbsp;drei&nbsp;Schritten
            </h2>
            <span className="mt-w14-3 block h-px w-16 origin-left bg-gold/60" aria-hidden="true" />
            <p className="mt-w14-3 max-w-measure text-fluid-body text-ink-aged">
              Faire Tagespreise, sachkundige Bewertung und sofortige Auszahlung — mit
              echter Erfahrung in Gold, Münzen und Nachlässen.
            </p>

            <div className="mt-w14-4 flex flex-wrap items-center gap-w14-3 rounded-card border border-rule bg-surface p-card">
              <span className="grid h-12 w-12 place-items-center rounded-full text-gold ring-gold-soft">
                <Banknote className="h-6 w-6" aria-hidden="true" />
              </span>
              <div>
                <div className="eyebrow">Tagespreis Gold</div>
                <div className="tnum mt-w14-1 font-display text-fluid-h3 font-medium text-ink">
                  {eur(gold.pricePerGram)}/g
                </div>
              </div>
              <a
                href="/goldankauf"
                className="ml-auto inline-flex min-h-[44px] items-center gap-2 rounded-button border border-gold/40 bg-surface px-5 py-3 text-fluid-body font-medium text-ink transition-colors duration-base ease-hover hover:border-gold hover:text-gold-deep"
              >
                Bewerten lassen <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>
          </Reveal>

          <div className="relative">
            {/* single hairline threading the steps together */}
            <div className="absolute left-[34px] top-10 hidden h-[calc(100%-5rem)] w-px bg-gradient-to-b from-gold/50 via-rule to-transparent md:block" />
            <ol className="space-y-w14-3">
              {steps.map((s, i) => (
                <Reveal key={i} delay={i * 0.1}>
                  <li className="hover-lift group relative flex gap-w14-3 rounded-card border border-rule bg-surface p-card shadow-card hover:shadow-lift">
                    <div className="relative z-10 grid h-[68px] w-[68px] shrink-0 place-items-center rounded-full bg-ink text-gold">
                      <s.icon className="h-7 w-7" strokeWidth={1.4} aria-hidden="true" />
                      <span className="tnum absolute -right-1 -top-1 grid h-6 w-6 place-items-center rounded-full bg-gold text-[0.72rem] font-semibold text-white">
                        {i + 1}
                      </span>
                    </div>
                    <div>
                      <h3 className="font-display text-fluid-h3 font-medium leading-snug">{s.title}</h3>
                      <p className="mt-w14-1 max-w-measure text-fluid-body text-ink-aged">{s.body}</p>
                    </div>
                  </li>
                </Reveal>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
