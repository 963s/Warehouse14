import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { Reveal } from "@/components/ui/reveal";

export const metadata: Metadata = {
  title: "Datenschutzerklärung | warehouse14",
  description:
    "Informationen zur Erhebung, Verarbeitung und Speicherung personenbezogener Daten gemäß DSGVO bei warehouse14 in Schorndorf.",
};

export default function DatenschutzPage() {
  return (
    <PageShell>
      <article className="mx-auto max-w-3xl px-5 py-16 md:py-24 text-ink-aged leading-relaxed">
        {/* Placeholder notice */}
        <Reveal>
          <div className="mb-10 rounded-card border border-rule bg-card px-6 py-4 text-sm text-ink-faded">
            <strong className="text-ink">Hinweis:</strong> Vorschau-Platzhalter.
            Die rechtsverbindlichen Texte werden vor dem Livegang anwaltlich
            finalisiert.
          </div>
        </Reveal>

        {/* Title */}
        <Reveal delay={0.05}>
          <h1 className="font-display text-4xl md:text-5xl font-semibold text-ink mb-4">
            Datenschutzerklärung
          </h1>
          <p className="text-ink-faded text-sm mb-12">Stand: Juni 2026</p>
        </Reveal>

        {/* 1. Verantwortlicher */}
        <Reveal delay={0.08}>
          <section className="mb-12 space-y-4">
            <h2 className="font-display text-2xl font-semibold text-ink">
              1. Verantwortlicher
            </h2>
            <p>
              Verantwortlicher im Sinne der Datenschutz-Grundverordnung (DSGVO)
              und anderer nationaler Datenschutzgesetze sowie sonstiger
              datenschutzrechtlicher Bestimmungen ist:
            </p>
            <div className="rounded-card bg-card border border-rule px-6 py-5 space-y-1 text-sm">
              <p className="font-semibold text-ink">warehouse14</p>
              <p>Musterstraße 14</p>
              <p>73614 Schorndorf</p>
              <p>Deutschland</p>
              <p className="pt-2">
                E-Mail:{" "}
                <a
                  href="mailto:info@warehouse14.de"
                  className="text-ink underline underline-offset-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
                >
                  info@warehouse14.de
                </a>
              </p>
              <p>USt-IdNr.: folgt</p>
            </div>
          </section>
        </Reveal>

        {/* 2. Erhebung und Verarbeitung */}
        <Reveal delay={0.1}>
          <section className="mb-12 space-y-4">
            <h2 className="font-display text-2xl font-semibold text-ink">
              2. Erhebung und Verarbeitung personenbezogener Daten
            </h2>
            <p>
              Wir erheben und verarbeiten personenbezogene Daten nur, soweit
              dies zur Erbringung unserer Leistungen, zur Vertragserfüllung oder
              aufgrund gesetzlicher Pflichten erforderlich ist. Rechtsgrundlagen
              sind insbesondere Art. 6 Abs. 1 lit. b DSGVO (Vertrag), Art. 6
              Abs. 1 lit. c DSGVO (rechtliche Verpflichtung) sowie Art. 6 Abs.
              1 lit. f DSGVO (berechtigtes Interesse).
            </p>
            <p>
              Bei Bestellungen erheben wir Name, Anschrift, E-Mail-Adresse,
              Telefonnummer sowie Zahlungsdaten. Diese Daten verwenden wir
              ausschließlich zur Abwicklung Ihrer Bestellung, zur Kommunikation
              mit Ihnen und zur Erfüllung steuerrechtlicher und
              handelsrechtlicher Aufbewahrungspflichten.
            </p>
            <p>
              Im Rahmen des Ankaufs von Edelmetallen, Münzen und Antiquitäten
              sind wir nach dem Geldwäschegesetz (GwG) verpflichtet, Ihre
              Identität festzustellen und zu dokumentieren. Die hierbei
              verarbeiteten Daten werden auf Grundlage von Art. 6 Abs. 1 lit. c
              DSGVO i. V. m. § 8 GwG verarbeitet.
            </p>
          </section>
        </Reveal>

        {/* 3. Cookies & Consent */}
        <Reveal delay={0.1}>
          <section className="mb-12 space-y-4">
            <h2 className="font-display text-2xl font-semibold text-ink">
              3. Cookies und Einwilligung
            </h2>
            <p>
              Unsere Website verwendet technisch notwendige Cookies, die für
              den Betrieb der Seite unerlässlich sind (z. B. Warenkorb,
              Session-Verwaltung). Diese Cookies werden ohne gesonderte
              Einwilligung gesetzt, da sie auf Art. 6 Abs. 1 lit. f DSGVO
              gestützt werden.
            </p>
            <p>
              Sofern wir Analyse- oder Marketing-Cookies einsetzen, holen wir
              Ihre ausdrückliche Einwilligung gemäß Art. 6 Abs. 1 lit. a DSGVO
              ein. Sie können eine erteilte Einwilligung jederzeit mit Wirkung
              für die Zukunft widerrufen, indem Sie die Cookie-Einstellungen in
              Ihrem Browser anpassen oder über unser Consent-Banner.
            </p>
          </section>
        </Reveal>

        {/* 4. Auftragsverarbeiter */}
        <Reveal delay={0.1}>
          <section className="mb-12 space-y-4">
            <h2 className="font-display text-2xl font-semibold text-ink">
              4. Auftragsverarbeiter und Drittanbieter
            </h2>
            <p>
              Wir setzen für bestimmte Verarbeitungstätigkeiten
              Dienstleister ein, mit denen wir Auftragsverarbeitungsverträge
              gemäß Art. 28 DSGVO geschlossen haben oder schließen werden.
            </p>

            <div className="space-y-6">
              {/* Stripe */}
              <div className="rounded-card border border-rule bg-card px-6 py-5 space-y-2">
                <h3 className="font-semibold text-ink">
                  Stripe (Zahlungsabwicklung)
                </h3>
                <p className="text-sm">
                  Zahlungen werden über Stripe Payments Europe Ltd., 1 Grand
                  Canal Street Lower, Dublin 2, Irland abgewickelt. Stripe
                  verarbeitet Ihre Zahlungsdaten im Auftrag gemäß Art. 28
                  DSGVO. Weitere Informationen finden Sie in der
                  Datenschutzerklärung von Stripe unter{" "}
                  <a
                    href="https://stripe.com/de/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ink underline underline-offset-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
                  >
                    stripe.com/de/privacy
                  </a>
                  .
                </p>
              </div>

              {/* DHL */}
              <div className="rounded-card border border-rule bg-card px-6 py-5 space-y-2">
                <h3 className="font-semibold text-ink">
                  DHL (Versand und Logistik)
                </h3>
                <p className="text-sm">
                  Für den Versand Ihrer Bestellung übermitteln wir Name,
                  Lieferanschrift und ggf. Telefonnummer an Deutsche Post DHL
                  Group, Charles-de-Gaulle-Straße 20, 53113 Bonn. Die
                  Datenschutzerklärung von DHL finden Sie unter{" "}
                  <a
                    href="https://www.dhl.de/de/toolbar/footer/datenschutz.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ink underline underline-offset-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
                  >
                    dhl.de
                  </a>
                  .
                </p>
              </div>

              {/* Cloudflare */}
              <div className="rounded-card border border-rule bg-card px-6 py-5 space-y-2">
                <h3 className="font-semibold text-ink">
                  Cloudflare (CDN und Sicherheit)
                </h3>
                <p className="text-sm">
                  Wir nutzen Dienste der Cloudflare Inc., 101 Townsend St, San
                  Francisco, CA 94107, USA, zur Auslieferung unserer Website
                  sowie zum Schutz vor unberechtigten Zugriffen. Dabei können
                  Verbindungsdaten (IP-Adresse, Browsertyp, Zeitstempel) an
                  Cloudflare übermittelt werden. Die Datenübertragung in die USA
                  erfolgt auf Grundlage geeigneter Garantien (Standardklauseln
                  der EU-Kommission). Weitere Informationen:{" "}
                  <a
                    href="https://www.cloudflare.com/de-de/privacypolicy/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ink underline underline-offset-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
                  >
                    cloudflare.com
                  </a>
                  .
                </p>
              </div>

              {/* Brevo */}
              <div className="rounded-card border border-rule bg-card px-6 py-5 space-y-2">
                <h3 className="font-semibold text-ink">
                  Brevo (E-Mail-Marketing und Transaktionsmails)
                </h3>
                <p className="text-sm">
                  Für den Versand von Bestell- und Versandbestätigungen sowie
                  Newsletter nutzen wir Brevo SAS (ehemals Sendinblue), 7 rue
                  de Madrid, 75008 Paris, Frankreich. Brevo verarbeitet
                  E-Mail-Adressen und Versandmetadaten als Auftragsverarbeiter.
                  Datenschutzerklärung:{" "}
                  <a
                    href="https://www.brevo.com/de/datenschutzrichtlinie/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ink underline underline-offset-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
                  >
                    brevo.com
                  </a>
                  .
                </p>
              </div>

              {/* Chatwoot */}
              <div className="rounded-card border border-rule bg-card px-6 py-5 space-y-2">
                <h3 className="font-semibold text-ink">
                  Chatwoot (Kundenkommunikation)
                </h3>
                <p className="text-sm">
                  Für den Live-Chat und die Kundenkommunikation setzen wir
                  Chatwoot ein, eine Open-Source-Lösung, die wir selbst auf
                  unseren eigenen Servern in Deutschland betreiben (kein Dritter
                  erhält Zugriff auf Chat-Daten). Wenn Sie den Chat nutzen,
                  werden Ihre Nachrichten und ggf. Ihre E-Mail-Adresse
                  verarbeitet, um Ihre Anfrage zu beantworten. Rechtsgrundlage
                  ist Art. 6 Abs. 1 lit. b DSGVO (vorvertragliche Maßnahme).
                </p>
              </div>
            </div>
          </section>
        </Reveal>

        {/* 5. Server-Logs */}
        <Reveal delay={0.1}>
          <section className="mb-12 space-y-4">
            <h2 className="font-display text-2xl font-semibold text-ink">
              5. Server-Logs
            </h2>
            <p>
              Beim Aufruf unserer Website erhebt unser Webserver automatisch
              sogenannte Server-Log-Dateien. Diese enthalten:
            </p>
            <ul className="list-disc list-inside space-y-1 pl-2 text-sm">
              <li>IP-Adresse des anfragenden Geräts (anonymisiert nach 7 Tagen)</li>
              <li>Datum und Uhrzeit des Zugriffs</li>
              <li>Aufgerufene URL und HTTP-Statuscode</li>
              <li>Browsertyp, Betriebssystem und Referrer-URL</li>
              <li>Übertragene Datenmenge</li>
            </ul>
            <p>
              Die Verarbeitung erfolgt auf Grundlage von Art. 6 Abs. 1 lit. f
              DSGVO zum Zweck der Sicherstellung des technischen Betriebs und
              der Abwehr von Angriffen. Eine Zusammenführung mit anderen
              personenbezogenen Daten findet nicht statt. Log-Dateien werden
              nach spätestens 30 Tagen gelöscht, sofern keine
              Sicherheitsvorfälle eine längere Aufbewahrung erfordern.
            </p>
          </section>
        </Reveal>

        {/* 6. Kontaktformular */}
        <Reveal delay={0.1}>
          <section className="mb-12 space-y-4">
            <h2 className="font-display text-2xl font-semibold text-ink">
              6. Kontaktformular und E-Mail-Kontakt
            </h2>
            <p>
              Wenn Sie uns über unser Kontaktformular oder per E-Mail
              kontaktieren, werden die von Ihnen angegebenen Daten (Name,
              E-Mail-Adresse, Nachricht) zur Bearbeitung Ihrer Anfrage
              gespeichert. Die Verarbeitung erfolgt auf Grundlage von Art. 6
              Abs. 1 lit. b DSGVO, sofern Ihre Anfrage im Zusammenhang mit
              einem Vertragsverhältnis steht, andernfalls auf Grundlage von
              Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an der
              Beantwortung von Kundenanfragen).
            </p>
            <p>
              Die Daten werden gelöscht, sobald Ihre Anfrage abschließend
              bearbeitet ist und keine gesetzlichen Aufbewahrungspflichten
              entgegenstehen.
            </p>
          </section>
        </Reveal>

        {/* 7. Aufbewahrungsfristen (GoBD) */}
        <Reveal delay={0.1}>
          <section className="mb-12 space-y-4">
            <h2 className="font-display text-2xl font-semibold text-ink">
              7. Aufbewahrungsfristen und GoBD-Pflichten
            </h2>
            <p>
              Als Handels- und Gewerbebetrieb unterliegen wir den Grundsätzen
              zur ordnungsgemäßen Führung und Aufbewahrung von Büchern,
              Aufzeichnungen und Unterlagen in elektronischer Form (GoBD) sowie
              den steuerrechtlichen Aufbewahrungspflichten gemäß § 147 AO und
              § 257 HGB.
            </p>
            <p>
              Fiskalisch relevante Daten, insbesondere Kassenbons, Rechnungen,
              Buchungsbelege und Geschäftsvorfälle, werden für die gesetzlich
              vorgeschriebene Dauer von{" "}
              <strong className="text-ink">10 Jahren</strong> aufbewahrt.
              Handelsbriefe und sonstige Geschäftskorrespondenz werden für 6
              Jahre aufbewahrt.
            </p>
            <p>
              Die Aufbewahrung erfolgt zum Zweck der Erfüllung gesetzlicher
              Pflichten gemäß Art. 6 Abs. 1 lit. c DSGVO. Nach Ablauf der
              gesetzlichen Fristen werden die Daten gelöscht, sofern kein
              berechtigtes Interesse an einer längeren Speicherung besteht.
            </p>
            <p>
              Im Rahmen der GwG-Pflichten (Geldwäschegesetz) werden
              Identifikationsdaten von Ankaufskunden für die gesetzlich
              vorgeschriebene Dauer von 5 Jahren nach Beendigung der
              Geschäftsbeziehung aufbewahrt (§ 8 Abs. 4 GwG).
            </p>
          </section>
        </Reveal>

        {/* 8. Betroffenenrechte */}
        <Reveal delay={0.1}>
          <section className="mb-12 space-y-4">
            <h2 className="font-display text-2xl font-semibold text-ink">
              8. Ihre Rechte als betroffene Person
            </h2>
            <p>
              Sie haben gegenüber uns folgende Rechte hinsichtlich der Sie
              betreffenden personenbezogenen Daten:
            </p>
            <div className="space-y-4">
              <div className="rounded-card border border-rule bg-card px-6 py-4 space-y-1">
                <h3 className="font-semibold text-ink text-sm">
                  Auskunft (Art. 15 DSGVO)
                </h3>
                <p className="text-sm">
                  Sie können Auskunft über die von uns verarbeiteten Daten,
                  deren Herkunft, Empfänger und den Zweck der Verarbeitung
                  verlangen.
                </p>
              </div>
              <div className="rounded-card border border-rule bg-card px-6 py-4 space-y-1">
                <h3 className="font-semibold text-ink text-sm">
                  Berichtigung (Art. 16 DSGVO)
                </h3>
                <p className="text-sm">
                  Sie können die unverzügliche Berichtigung unrichtiger oder
                  Vervollständigung unvollständiger Daten verlangen.
                </p>
              </div>
              <div className="rounded-card border border-rule bg-card px-6 py-4 space-y-1">
                <h3 className="font-semibold text-ink text-sm">
                  Löschung (Art. 17 DSGVO, „Recht auf Vergessenwerden“)
                </h3>
                <p className="text-sm">
                  Sie können die Löschung Ihrer personenbezogenen Daten
                  verlangen, sofern die Verarbeitung nicht zur Erfüllung einer
                  rechtlichen Verpflichtung oder zur Geltendmachung,
                  Ausübung oder Verteidigung von Rechtsansprüchen erforderlich
                  ist. Fiskalisch und rechtlich aufbewahrungspflichtige Daten
                  können vor Ablauf der gesetzlichen Frist nicht gelöscht
                  werden.
                </p>
              </div>
              <div className="rounded-card border border-rule bg-card px-6 py-4 space-y-1">
                <h3 className="font-semibold text-ink text-sm">
                  Einschränkung der Verarbeitung (Art. 18 DSGVO)
                </h3>
                <p className="text-sm">
                  Sie können die Einschränkung der Verarbeitung Ihrer Daten
                  verlangen, z. B. wenn Sie die Richtigkeit der Daten
                  bestreiten oder der Verarbeitung widersprochen haben.
                </p>
              </div>
              <div className="rounded-card border border-rule bg-card px-6 py-4 space-y-1">
                <h3 className="font-semibold text-ink text-sm">
                  Datenübertragbarkeit (Art. 20 DSGVO)
                </h3>
                <p className="text-sm">
                  Sie haben das Recht, die Sie betreffenden Daten in einem
                  strukturierten, gängigen und maschinenlesbaren Format zu
                  erhalten.
                </p>
              </div>
              <div className="rounded-card border border-rule bg-card px-6 py-4 space-y-1">
                <h3 className="font-semibold text-ink text-sm">
                  Widerspruch (Art. 21 DSGVO)
                </h3>
                <p className="text-sm">
                  Sie können der Verarbeitung Ihrer Daten auf Grundlage von
                  Art. 6 Abs. 1 lit. f DSGVO jederzeit widersprechen, sofern
                  keine zwingenden schutzwürdigen Gründe für die Verarbeitung
                  vorliegen.
                </p>
              </div>
              <div className="rounded-card border border-rule bg-card px-6 py-4 space-y-1">
                <h3 className="font-semibold text-ink text-sm">
                  Beschwerderecht (Art. 77 DSGVO)
                </h3>
                <p className="text-sm">
                  Sie haben das Recht, sich bei der zuständigen
                  Aufsichtsbehörde zu beschweren. Zuständige Behörde für
                  Baden-Württemberg ist der Landesbeauftragte für den
                  Datenschutz und die Informationsfreiheit Baden-Württemberg
                  (LfDI), Lautenschlagerstraße 20, 70173 Stuttgart.
                </p>
              </div>
            </div>
            <p>
              Zur Ausübung Ihrer Rechte wenden Sie sich bitte per E-Mail an{" "}
              <a
                href="mailto:datenschutz@warehouse14.de"
                className="text-ink underline underline-offset-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
              >
                datenschutz@warehouse14.de
              </a>
              .
            </p>
          </section>
        </Reveal>

        {/* 9. Aktualitat */}
        <Reveal delay={0.1}>
          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold text-ink">
              9. Aktualität und Änderungen dieser Erklärung
            </h2>
            <p>
              Diese Datenschutzerklärung ist aktuell gültig und hat den Stand
              Juni 2026. Aufgrund von Weiterentwicklungen unserer Website oder
              geänderten gesetzlichen Anforderungen kann es notwendig werden,
              diese Datenschutzerklärung anzupassen. Die jeweils aktuellste
              Version finden Sie stets auf dieser Seite.
            </p>
          </section>
        </Reveal>
      </article>
    </PageShell>
  );
}
