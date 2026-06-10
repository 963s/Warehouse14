import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { Reveal } from "@/components/ui/reveal";

export const metadata: Metadata = {
  title: "Allgemeine Geschäftsbedingungen | Warehouse14",
  description:
    "AGB von Warehouse14, Schorndorf. Geltungsbereich, Vertragsschluss, Preise, Zahlung, Lieferung, Widerruf, Gewährleistung und GwG-Hinweise.",
};

export default function AgbPage() {
  return (
    <PageShell>
      <article className="mx-auto max-w-3xl px-5 py-16 md:py-24">
        {/* Placeholder notice */}
        <Reveal>
          <div className="mb-10 rounded-card border border-gold/40 bg-card px-5 py-4 text-sm text-ink-aged shadow-card">
            <strong className="text-ink">Hinweis:</strong> Vorschau-Platzhalter.
            Die rechtsverbindlichen Texte werden vor dem Livegang anwaltlich
            finalisiert.
          </div>
        </Reveal>

        {/* Title */}
        <Reveal delay={0.05}>
          <h1 className="font-display text-4xl font-semibold text-ink md:text-5xl">
            Allgemeine<br />
            Geschäftsbedingungen
          </h1>
          <p className="mt-3 text-sm text-ink-faded">
            Stand: Januar 2025 &middot; Warehouse14 &middot; Musterstraße 14,
            73614 Schorndorf &middot; USt-IdNr folgt
          </p>
        </Reveal>

        <div className="mt-12 space-y-12 text-ink-aged leading-relaxed">

          {/* 1 Geltungsbereich */}
          <Reveal delay={0.07}>
            <section className="space-y-4">
              <h2 className="font-display text-2xl font-semibold text-ink">
                1. Geltungsbereich
              </h2>
              <p>
                Diese Allgemeinen Geschäftsbedingungen (AGB) regeln alle
                Kaufverträge, die zwischen Ihnen (nachfolgend "Käuferin"
                oder "Käufer") und
              </p>
              <p className="rounded-card bg-card px-4 py-3 text-ink shadow-card">
                Warehouse14 &middot; Musterstraße 14 &middot; 73614
                Schorndorf<br />
                Inhaber: [Name folgt] &middot; USt-IdNr folgt<br />
                E-Mail: shop@warehouse14.de
              </p>
              <p>
                über den Onlineshop unter{" "}
                <span className="text-gold">warehouse14.de</span> geschlossen
                werden. Abweichende Bedingungen des Käufenden werden nicht
                anerkannt, es sei denn, wir stimmen ihrer Geltung ausdrücklich
                schriftlich zu.
              </p>
            </section>
          </Reveal>

          <hr className="border-rule" />

          {/* 2 Vertragsschluss */}
          <Reveal delay={0.07}>
            <section className="space-y-4">
              <h2 className="font-display text-2xl font-semibold text-ink">
                2. Vertragsschluss
              </h2>
              <p>
                Die Darstellung der Produkte im Onlineshop stellt kein
                rechtlich verbindliches Angebot dar, sondern eine Einladung
                zur Bestellung (invitatio ad offerendum). Mit dem Abschicken
                der Bestellung geben Sie ein verbindliches Angebot zum
                Abschluss eines Kaufvertrags ab.
              </p>
              <p>
                Wir bestätigen den Eingang Ihrer Bestellung unmittelbar per
                E-Mail. Diese Eingangsbestätigung stellt noch keine
                Annahme Ihres Angebots dar. Der Kaufvertrag kommt zustande,
                wenn wir Ihre Bestellung durch eine gesonderte
                Auftragsbestätigung annehmen oder die Ware versenden, je
                nachdem, was zuerst eintritt.
              </p>
              <p>
                Wir behalten uns vor, Bestellungen ohne Angabe von Gründen
                abzulehnen, insbesondere bei Nichtverfügbarkeit des Artikels
                oder bei begegneten Sicherheitsbedenken.
              </p>
            </section>
          </Reveal>

          <hr className="border-rule" />

          {/* 3 Preise & Versandkosten */}
          <Reveal delay={0.07}>
            <section className="space-y-4">
              <h2 className="font-display text-2xl font-semibold text-ink">
                3. Preise und Versandkosten
              </h2>
              <p>
                Alle Preise verstehen sich in Euro (EUR) und enthalten die
                gesetzliche Umsatzsteuer. Bei Anlagemünzen und
                Anlagegold-Barren gilt die steuerliche Sonderregelung nach
                Art. 152 MwStSystRL (differenzbesteuert oder
                umsatzsteuerbefreit, je nach Artikel und Herkunft), was
                im jeweiligen Produktlisting kenntlich gemacht wird.
              </p>
              <p>
                Versandkosten werden im Bestellprozess transparent vor
                Abgabe der Bestellung angezeigt und richten sich nach
                Gewicht, Wert und Versandziel. Der Versand hochwertiger
                Edelmetall- und Sammlerstücke erfolgt ausschließlich
                versichert, vgl. Abschnitt 6.
              </p>
            </section>
          </Reveal>

          <hr className="border-rule" />

          {/* 4 Zahlung */}
          <Reveal delay={0.07}>
            <section className="space-y-4">
              <h2 className="font-display text-2xl font-semibold text-ink">
                4. Zahlung
              </h2>
              <p>Wir akzeptieren folgende Zahlungswege:</p>
              <ul className="ml-5 list-disc space-y-2">
                <li>
                  <strong className="text-ink">Kreditkarte / Debitkarte</strong>
                  {" "}(Visa, Mastercard, American Express). Die Belastung
                  erfolgt zum Zeitpunkt der Bestellbestätigung.
                </li>
                <li>
                  <strong className="text-ink">SEPA-Lastschrift</strong>
                  {" "}Durch Angabe Ihrer IBAN erteilen Sie uns ein
                  SEPA-Lastschriftmandat. Die Abbuchung erfolgt spätestens
                  einen Bankwerktag nach Versandbestätigung. Das Mandat wird
                  Ihnen per E-Mail zugeschickt.
                </li>
                <li>
                  <strong className="text-ink">Klarna</strong>
                  {" "}(Sofort-Bezahlung, Ratenkauf oder Rechnungskauf nach
                  separater Prüfung durch Klarna). Es gelten ergänzend die
                  Nutzungsbedingungen von Klarna AB.
                </li>
                <li>
                  <strong className="text-ink">Vorkasse (Banküberweisung)</strong>
                  {" "}Die Ware wird nach Zahlungseingang auf unserem Konto
                  versandt. Bankverbindung und Verwendungszweck werden mit der
                  Bestellbestätigung mitgeteilt.
                </li>
              </ul>
              <p>
                Bei Zahlungsverzug sind wir berechtigt, Verzugszinsen in
                gesetzlicher Höhe zu verlangen. Das Recht auf Geltendmachung
                eines weitergehenden Schadens bleibt vorbehalten.
              </p>
            </section>
          </Reveal>

          <hr className="border-rule" />

          {/* 5 Lieferung */}
          <Reveal delay={0.07}>
            <section className="space-y-4">
              <h2 className="font-display text-2xl font-semibold text-ink">
                5. Lieferung
              </h2>
              <p>
                Wir liefern ausschließlich an Adressen in Deutschland
                (und nach Vereinbarung in ausgewählte EU-Länder). Alle
                Sendungen werden versichert und in diskret neutraler
                Verpackung durch DHL Express oder DHL Paket verschickt.
              </p>
              <p>
                Die Lieferzeit beträgt in der Regel 2 bis 5 Werktage nach
                Zahlungseingang, soweit beim jeweiligen Produkt keine
                abweichende Frist angegeben ist. Bei Sonderanfertigungen
                oder besonderen Beschaffungslagen wird die voraussichtliche
                Lieferzeit im Produktlisting separat ausgewiesen.
              </p>
              <p>
                Jede Sendung enthält eine Sendungsverfolgungsnummer, die
                Ihnen per E-Mail zugestellt wird. Das Versandrisiko liegt
                bis zur Übergabe an DHL bei uns, sofern Sie Verbraucherin
                oder Verbraucher sind.
              </p>
            </section>
          </Reveal>

          <hr className="border-rule" />

          {/* 6 Eigentumsvorbehalt */}
          <Reveal delay={0.07}>
            <section className="space-y-4">
              <h2 className="font-display text-2xl font-semibold text-ink">
                6. Eigentumsvorbehalt
              </h2>
              <p>
                Die gelieferte Ware bleibt bis zur vollständigen Bezahlung
                des Kaufpreises unser Eigentum. Sie sind verpflichtet, die
                Ware bis zur Eigentumsübergang sorgsam aufzubewahren und
                vor Zugriff Dritter zu schützen. Im Falle von
                Zahlungsverzug sind wir berechtigt, die Ware
                zurückzuverlangen.
              </p>
            </section>
          </Reveal>

          <hr className="border-rule" />

          {/* 7 Widerruf */}
          <Reveal delay={0.07}>
            <section className="space-y-4">
              <h2 className="font-display text-2xl font-semibold text-ink">
                7. Widerrufsrecht
              </h2>
              <p>
                Als Verbraucherin oder Verbraucher haben Sie das Recht, diesen
                Vertrag innerhalb von vierzehn Tagen ohne Angabe von Gründen
                zu widerrufen. Die vollständigen Widerrufsbelehrungen sowie
                das Musterwiderrufsformular finden Sie auf unserer gesonderten
                Seite.
              </p>
              <p>
                Bitte beachten Sie, dass bei maßgeschneiderten Anfertigungen,
                versiegelten Tonträgern oder hygienischen Produkten, die nach
                der Lieferung entsiegelt wurden, das Widerrufsrecht gemäß
                § 312g Abs. 2 BGB ausgeschlossen sein kann.
              </p>
              <p>
                Den Widerruf können Sie erklären per E-Mail an{" "}
                <a href="mailto:widerruf@warehouse14.de" className="text-gold underline underline-offset-2 hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--w14-gold] focus-visible:ring-offset-2 rounded-sm">widerruf@warehouse14.de</a>{" "}
                oder über unser Kontaktformular. Ausführliche Informationen
                finden Sie in unserer{" "}
                <a
                  href="/widerruf"
                  className="text-gold underline underline-offset-2 hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--w14-gold] focus-visible:ring-offset-2 rounded-sm"
                >
                  Widerrufsbelehrung
                </a>
                .
              </p>
            </section>
          </Reveal>

          <hr className="border-rule" />

          {/* 8 Gewaehrleistung */}
          <Reveal delay={0.07}>
            <section className="space-y-4">
              <h2 className="font-display text-2xl font-semibold text-ink">
                8. Gewährleistung
              </h2>
              <p>
                Es gelten die gesetzlichen Mängelgewährleistungsrechte.
                Die Verjährungsfrist für Mängelansprüche beträgt bei
                neuen Sachen zwei Jahre, bei gebrauchten Sachen ein Jahr ab
                Lieferung, soweit gesetzlich zulässig.
              </p>
              <p>
                Bei Münzen und Edelmetallen gilt als Mangel eine
                wesentliche Abweichung vom vereinbarten Feingehalt, Gewicht
                oder Echtheitsnachweis. Normale Gebrauchsspuren, die dem
                numismatischen Zustand entsprechen (z.B. "sehr schön" bis
                "fast vorzüglich"), stellen keinen Mangel dar, sofern sie
                in der Produktbeschreibung dokumentiert sind.
              </p>
              <p>
                Zur Geltendmachung von Gewährleistungsansprüchen wenden
                Sie sich bitte an:{" "}
                <a href="mailto:service@warehouse14.de" className="text-gold underline underline-offset-2 hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--w14-gold] focus-visible:ring-offset-2 rounded-sm">service@warehouse14.de</a>.
              </p>
            </section>
          </Reveal>

          <hr className="border-rule" />

          {/* 9 GwG-Hinweis */}
          <Reveal delay={0.07}>
            <section className="space-y-4">
              <div className="rounded-card border border-gold/50 bg-card px-5 py-5 shadow-card">
                <h2 className="font-display text-2xl font-semibold text-ink">
                  9. Hinweis gemäß Geldwäschegesetz (GwG)
                </h2>
                <p className="mt-4">
                  Ab einem Kaufpreis von <strong className="text-ink">15.000 EUR</strong>{" "}
                  (oder dem Gegenwert in einer anderen Währung) für
                  Anlagegold, Silberbarren oder sonstige Edelmetalle sind wir
                  gemäß § 4 Abs. 4 i.V.m. § 10 GwG verpflichtet,
                  Ihre Identität zu überprüfen und die Transaktion zu
                  dokumentieren.
                </p>
                <p className="mt-3">
                  Dies gilt auch dann, wenn mehrere Transaktionen offensichtlich
                  miteinander zusammenhängen und zusammen diesen Schwellenwert
                  erreichen oder überschreiten. Wir sind in diesem Fall
                  berechtigt und verpflichtet, vor Versand der Ware eine
                  Kopie Ihres amtlichen Lichtbildausweises (Personalausweis
                  oder Reisepass) anzufordern.
                </p>
                <p className="mt-3">
                  Die erhobenen Daten werden ausschließlich zur Erfüllung
                  unserer gesetzlichen Pflichten nach dem GwG verarbeitet und
                  für die gesetzlich vorgeschriebene Aufbewahrungsfrist von
                  fünf Jahren gespeichert. Weitere Informationen finden Sie
                  in unserer{" "}
                  <a
                    href="/datenschutz"
                    className="text-gold underline underline-offset-2 hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--w14-gold] focus-visible:ring-offset-2 rounded-sm"
                  >
                    Datenschutzerklärung
                  </a>
                  .
                </p>
              </div>
            </section>
          </Reveal>

          <hr className="border-rule" />

          {/* 10 Schlussbestimmungen */}
          <Reveal delay={0.07}>
            <section className="space-y-4">
              <h2 className="font-display text-2xl font-semibold text-ink">
                10. Schlussbestimmungen
              </h2>
              <p>
                Es gilt das Recht der Bundesrepublik Deutschland unter
                Ausschluss des UN-Kaufrechts (CISG). Gerichtsstand für
                sämtliche Streitigkeiten ist, soweit gesetzlich zulässig,
                73614 Schorndorf.
              </p>
              <p>
                Sollten einzelne Bestimmungen dieser AGB ganz oder teilweise
                unwirksam sein oder werden, berührt dies die Gültigkeit
                der übrigen Bestimmungen nicht. An die Stelle unwirksamer
                Klauseln tritt die nächstkommende wirksame Regelung, die
                dem wirtschaftlichen Zweck der unwirksamen Klausel am
                nächsten kommt.
              </p>
              <p className="text-sm text-ink-faded">
                Warehouse14 &middot; Musterstraße 14 &middot; 73614
                Schorndorf &middot; shop@warehouse14.de
              </p>
            </section>
          </Reveal>
        </div>
      </article>
    </PageShell>
  );
}
