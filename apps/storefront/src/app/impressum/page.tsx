import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { Reveal } from "@/components/ui/reveal";

export const metadata: Metadata = {
  title: "Impressum | warehouse14",
  description:
    "Anbieterkennzeichnung nach § 5 DDG für warehouse14, Schorndorf. Kontaktdaten, Verantwortlicher, Haftungshinweise.",
};

export default function ImpressumPage() {
  return (
    <PageShell>
      <article className="mx-auto max-w-3xl px-5 py-16 md:py-24 text-ink-aged leading-relaxed">

        {/* Notice */}
        <Reveal>
          <div className="mb-10 rounded-card border border-rule bg-card px-5 py-4 text-sm text-ink-faded">
            <strong className="text-ink">Hinweis:</strong> Vorschau-Platzhalter.
            Die rechtsverbindlichen Texte werden vor dem Livegang anwaltlich finalisiert.
          </div>
        </Reveal>

        {/* Headline */}
        <Reveal delay={0.05}>
          <h1 className="font-display text-4xl md:text-5xl font-semibold text-ink mb-12">
            Impressum
          </h1>
        </Reveal>

        {/* 1 · Anbieter */}
        <Reveal delay={0.1}>
          <section className="space-y-4 mb-10">
            <h2 className="font-display text-2xl font-semibold text-ink">
              Angaben gemäß § 5 DDG
            </h2>
            <p>
              <strong className="text-ink">warehouse14</strong>
              <br />
              Inhaber: [Vorname Nachname]
              <br />
              Musterstrasse 14
              <br />
              73614 Schorndorf
              <br />
              Deutschland
            </p>
          </section>
        </Reveal>

        <hr className="border-rule my-8" />

        {/* 2 · Kontakt */}
        <Reveal delay={0.12}>
          <section className="space-y-4 mb-10">
            <h2 className="font-display text-2xl font-semibold text-ink">
              Kontakt
            </h2>
            <p>
              Telefon:{" "}
              <a
                href="tel:+4971812345678"
                className="text-gold hover:underline focus-visible:ring-2 focus-visible:ring-[--w14-gold] focus-visible:ring-offset-2 rounded-sm outline-none"
              >
                +49 7181 234567-8
              </a>
              <br />
              E-Mail:{" "}
              <a
                href="mailto:kontakt@warehouse14.de"
                className="text-gold hover:underline focus-visible:ring-2 focus-visible:ring-[--w14-gold] focus-visible:ring-offset-2 rounded-sm outline-none"
              >
                kontakt@warehouse14.de
              </a>
            </p>
          </section>
        </Reveal>

        <hr className="border-rule my-8" />

        {/* 3 · USt */}
        <Reveal delay={0.14}>
          <section className="space-y-4 mb-10">
            <h2 className="font-display text-2xl font-semibold text-ink">
              Umsatzsteuer-Identifikationsnummer
            </h2>
            <p>
              Gemäß § 27a Umsatzsteuergesetz: <em>folgt</em>
            </p>
          </section>
        </Reveal>

        <hr className="border-rule my-8" />

        {/* 4 · Verantwortlicher */}
        <Reveal delay={0.16}>
          <section className="space-y-4 mb-10">
            <h2 className="font-display text-2xl font-semibold text-ink">
              Verantwortlicher i.&thinsp;S.&thinsp;d. § 18 Abs. 2 MStV
            </h2>
            <p>
              [Vorname Nachname]
              <br />
              Musterstrasse 14
              <br />
              73614 Schorndorf
            </p>
          </section>
        </Reveal>

        <hr className="border-rule my-8" />

        {/* 5 · Berufsrecht / Aufsicht */}
        <Reveal delay={0.18}>
          <section className="space-y-4 mb-10">
            <h2 className="font-display text-2xl font-semibold text-ink">
              Berufsrecht und Aufsichtsbehörde
            </h2>
            <p>
              Der Betrieb unterliegt den gewerberechtlichen Vorschriften des
              Gewerbeordnung (GewO) sowie den einschlägigen Bestimmungen des
              Geldwäschegesetzes (GwG). Zuständige Aufsichtsbehörde ist das
              Ordnungsamt der Stadt Schorndorf sowie, in Fragen des GwG, die
              zuständige Behörde nach § 50 GwG.
            </p>
          </section>
        </Reveal>

        <hr className="border-rule my-8" />

        {/* 6 · EU-Streitschlichtung */}
        <Reveal delay={0.2}>
          <section className="space-y-4 mb-10">
            <h2 className="font-display text-2xl font-semibold text-ink">
              EU-Streitschlichtung
            </h2>
            <p>
              Die Europäische Kommission hatte eine Plattform zur
              Online-Streitbeilegung (OS) bereitgestellt. Diese Plattform
              wurde zum 20. Juli 2025 eingestellt und ist nicht mehr
              erreichbar.
            </p>
            <p>
              Wir sind nicht verpflichtet und nicht bereit, an einem
              Streitbeilegungsverfahren vor einer
              Verbraucherschlichtungsstelle teilzunehmen.
            </p>
          </section>
        </Reveal>

        <hr className="border-rule my-8" />

        {/* 7 · Haftung für Inhalte */}
        <Reveal delay={0.22}>
          <section className="space-y-4 mb-10">
            <h2 className="font-display text-2xl font-semibold text-ink">
              Haftung für Inhalte
            </h2>
            <p>
              Als Diensteanbieter sind wir gemäß § 7 Abs. 1 DDG für eigene
              Inhalte auf diesen Seiten nach den allgemeinen Gesetzen
              verantwortlich. Nach §§ 8 bis 10 DDG sind wir als
              Diensteanbieter jedoch nicht verpflichtet, übermittelte oder
              gespeicherte fremde Informationen zu überwachen oder nach
              Umständen zu forschen, die auf eine rechtswidrige Tätigkeit
              hinweisen.
            </p>
            <p>
              Verpflichtungen zur Entfernung oder Sperrung der Nutzung von
              Informationen nach den allgemeinen Gesetzen bleiben hiervon
              unberührt. Eine diesbezügliche Haftung ist jedoch erst ab dem
              Zeitpunkt der Kenntnis einer konkreten Rechtsverletzung möglich.
              Bei Bekanntwerden von entsprechenden Rechtsverletzungen werden
              wir diese Inhalte umgehend entfernen.
            </p>
          </section>
        </Reveal>

        <hr className="border-rule my-8" />

        {/* 8 · Haftung für Links */}
        <Reveal delay={0.24}>
          <section className="space-y-4 mb-10">
            <h2 className="font-display text-2xl font-semibold text-ink">
              Haftung für Links
            </h2>
            <p>
              Unser Angebot enthält Links zu externen Websites Dritter, auf
              deren Inhalte wir keinen Einfluss haben. Deshalb können wir für
              diese fremden Inhalte auch keine Gewähr übernehmen. Für die
              Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter
              oder Betreiber der Seiten verantwortlich.
            </p>
            <p>
              Die verlinkten Seiten wurden zum Zeitpunkt der Verlinkung auf
              mögliche Rechtsverstöße überprüft. Rechtswidrige Inhalte waren
              zum Zeitpunkt der Verlinkung nicht erkennbar. Eine permanente
              inhaltliche Kontrolle der verlinkten Seiten ist jedoch ohne
              konkrete Anhaltspunkte einer Rechtsverletzung nicht zumutbar.
              Bei Bekanntwerden von Rechtsverletzungen werden wir derartige
              Links umgehend entfernen.
            </p>
          </section>
        </Reveal>

        <hr className="border-rule my-8" />

        {/* 9 · Urheberrecht */}
        <Reveal delay={0.26}>
          <section className="space-y-4 mb-10">
            <h2 className="font-display text-2xl font-semibold text-ink">
              Urheberrecht
            </h2>
            <p>
              Die durch die Seitenbetreiber erstellten Inhalte und Werke auf
              diesen Seiten unterliegen dem deutschen Urheberrecht. Die
              Vervielfältigung, Bearbeitung, Verbreitung und jede Art der
              Verwertung außerhalb der Grenzen des Urheberrechtes bedürfen
              der schriftlichen Zustimmung des jeweiligen Autors bzw.
              Erstellers.
            </p>
            <p>
              Downloads und Kopien dieser Seite sind nur für den privaten,
              nicht kommerziellen Gebrauch gestattet. Soweit die Inhalte auf
              dieser Seite nicht vom Betreiber erstellt wurden, werden die
              Urheberrechte Dritter beachtet. Insbesondere werden Inhalte
              Dritter als solche gekennzeichnet. Sollten Sie trotzdem auf eine
              Urheberrechtsverletzung aufmerksam werden, bitten wir um einen
              entsprechenden Hinweis. Bei Bekanntwerden von Rechtsverletzungen
              werden wir derartige Inhalte umgehend entfernen.
            </p>
          </section>
        </Reveal>

      </article>
    </PageShell>
  );
}
