import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { Reveal } from "@/components/ui/reveal";

export const metadata: Metadata = {
  title: "Widerrufsrecht | warehouse14",
  description:
    "Informationen zum gesetzlichen Widerrufsrecht bei Sammlermünzen und Antiquitäten sowie zum Ausschluss des Widerrufsrechts bei Anlagegold und Edelmetallbarren gemäß Paragraf 312g Abs. 2 Nr. 8 BGB.",
};

export default function WiderrufsrechtPage() {
  return (
    <PageShell>
      <article className="mx-auto max-w-3xl px-5 py-16 md:py-24">
        {/* Platzhalter-Hinweis */}
        <Reveal>
          <div className="mb-10 rounded-card border border-rule bg-card px-6 py-4 text-sm text-ink-faded leading-relaxed">
            <strong className="text-ink">Hinweis:</strong> Vorschau-Platzhalter.
            Die rechtsverbindlichen Texte werden vor dem Livegang anwaltlich
            finalisiert.
          </div>
        </Reveal>

        {/* Seitentitel */}
        <Reveal delay={0.05}>
          <h1 className="font-display text-4xl md:text-5xl font-semibold text-ink mb-4">
            Widerrufsrecht
          </h1>
          <p className="text-ink-faded text-sm mb-12">
            warehouse14 &middot; Musterstraße 14 &middot; 73614 Schorndorf
            &middot; USt-IdNr folgt
          </p>
        </Reveal>

        {/* ----------------------------------------------------------------
            FALL 1: Anlagegold, Barren, Münzen mit Metallwertbezug
        ---------------------------------------------------------------- */}
        <Reveal delay={0.1}>
          <section className="mb-14">
            <h2 className="font-display text-2xl md:text-3xl font-semibold text-ink mb-4">
              Anlagegold, Edelmetallbarren und Münzen mit Marktwertbezug
            </h2>
            <div className="space-y-4 text-ink-aged leading-relaxed">
              <p>
                Bei Waren, deren Preis von Schwankungen auf dem Finanzmarkt
                abhängt, auf die der Unternehmer keinen Einfluss hat und die
                innerhalb der Widerrufsfrist auftreten können, besteht{" "}
                <strong className="text-ink">kein Widerrufsrecht</strong>.
              </p>
              <p>
                Dies gilt insbesondere für Anlagegold (Barren und Anlageprägungen
                mit gesetzlichem Zahlungsmittelcharakter), Silber-, Platin- und
                Palladiumbarren sowie alle weiteren Edelmetallprodukte, deren
                Verkaufspreis sich unmittelbar am Tagesspotpreis orientiert.
              </p>
              <p>
                Rechtsgrundlage: Paragraf 312g Absatz 2 Nummer 8 des
                Bürgerlichen Gesetzbuches (BGB).
              </p>
              <div className="rounded-card border border-rule bg-card px-6 py-4 shadow-card">
                <p className="text-sm text-ink-faded">
                  <strong className="text-ink">Beispiele ohne Widerrufsrecht:</strong>{" "}
                  Goldbarren (1 g bis 1 kg), Krügerrand, Maple Leaf, Wiener
                  Philharmoniker als Anlageprägung, Silberbarren, Platin- und
                  Palladiumbarren aller gängigen Größen.
                </p>
              </div>
            </div>
          </section>
        </Reveal>

        {/* Trennlinie */}
        <Reveal delay={0.12}>
          <hr className="border-rule mb-14" />
        </Reveal>

        {/* ----------------------------------------------------------------
            FALL 2: Sammlermünzen, Antiquitäten, Kunstgegenstände
        ---------------------------------------------------------------- */}
        <Reveal delay={0.15}>
          <section className="mb-14">
            <h2 className="font-display text-2xl md:text-3xl font-semibold text-ink mb-4">
              Sammlermünzen, Antiquitäten und Kunstgegenstände
            </h2>
            <div className="space-y-4 text-ink-aged leading-relaxed">
              <p>
                Für Sammlermünzen (numismatische Prägungen, die über ihren
                Metallwert hinaus einen Sammlerwert tragen), Antiquitäten sowie
                Kunstgegenstände gilt das gesetzliche Widerrufsrecht. Als
                Verbraucher haben Sie das Recht, diesen Vertrag binnen{" "}
                <strong className="text-ink">14 Tagen</strong> ohne Angabe von
                Gründen zu widerrufen.
              </p>
              <p>
                Die Widerrufsfrist beträgt 14 Tage ab dem Tag, an dem Sie oder
                ein von Ihnen benannter Dritter, der nicht der Beförderungsunternehmer
                ist, die Waren in Besitz genommen haben bzw. hat.
              </p>
              <div className="rounded-card border border-rule bg-card px-6 py-4 shadow-card">
                <p className="text-sm text-ink-faded">
                  <strong className="text-ink">Beispiele mit Widerrufsrecht:</strong>{" "}
                  Historische Goldmünzen und Silbermünzen (numismatisch bewertet),
                  antike Taschenuhren, Schmuckstücke aus Vorbesitz, Kunstgegenstände
                  und historische Sammlerobjekte.
                </p>
              </div>
            </div>
          </section>
        </Reveal>

        {/* ----------------------------------------------------------------
            Ausübung des Widerrufsrechts
        ---------------------------------------------------------------- */}
        <Reveal delay={0.18}>
          <section className="mb-14">
            <h2 className="font-display text-2xl md:text-3xl font-semibold text-ink mb-4">
              Widerruf erklären
            </h2>
            <div className="space-y-4 text-ink-aged leading-relaxed">
              <p>
                Um Ihr Widerrufsrecht auszuüben, müssen Sie uns mittels einer
                eindeutigen Erklärung (z. B. ein mit der Post versandter Brief
                oder eine E-Mail) über Ihren Entschluss, diesen Vertrag zu
                widerrufen, informieren.
              </p>
              <p>
                Zur Wahrung der Widerrufsfrist reicht es aus, dass Sie die
                Mitteilung über die Ausübung des Widerrufsrechts vor Ablauf
                der Widerrufsfrist absenden.
              </p>
              <div className="rounded-card border border-rule bg-card px-6 py-4 shadow-card space-y-1 text-sm">
                <p className="font-semibold text-ink">Kontakt für den Widerruf</p>
                <p className="text-ink-aged">warehouse14</p>
                <p className="text-ink-aged">Musterstraße 14, 73614 Schorndorf</p>
                <p className="text-ink-aged">
                  E-Mail: widerruf@warehouse14.de (Platzhalter)
                </p>
              </div>
              <p>
                Wenn Sie dieses Widerrufsrecht nutzen, erstatten wir alle von
                Ihnen geleisteten Zahlungen, einschließlich der Lieferkosten
                (mit Ausnahme der zusätzlichen Kosten, die sich daraus ergeben,
                dass Sie eine andere Art der Lieferung als die von uns angebotene
                günstigste Standardlieferung gewählt haben), unverzüglich und
                spätestens binnen 14 Tagen ab dem Tag, an dem die Mitteilung
                über Ihren Widerruf dieses Vertrags bei uns eingegangen ist.
              </p>
              <p>
                Wir verwenden für diese Rückzahlung dasselbe Zahlungsmittel,
                das Sie bei der ursprünglichen Transaktion eingesetzt haben,
                es sei denn, mit Ihnen wurde ausdrücklich etwas anderes
                vereinbart. In keinem Fall werden Ihnen wegen dieser Rückzahlung
                Entgelte berechnet.
              </p>
              <p>
                Wir können die Rückzahlung verweigern, bis wir die Waren wieder
                zurückerhalten haben oder bis Sie den Nachweis erbracht haben,
                dass Sie die Waren zurückgesandt haben, je nachdem, welches der
                frühere Zeitpunkt ist.
              </p>
              <p>
                Sie haben die Waren unverzüglich und in jedem Fall spätestens
                binnen 14 Tagen ab dem Tag, an dem Sie uns über den Widerruf
                dieses Vertrags unterrichten, an uns zurückzusenden oder zu
                übergeben. Die Frist ist gewahrt, wenn Sie die Waren vor Ablauf
                der Frist von 14 Tagen absenden. Sie tragen die unmittelbaren
                Kosten der Rücksendung der Waren.
              </p>
              <p>
                Sie müssen für einen etwaigen Wertverlust der Waren nur
                aufkommen, wenn dieser Wertverlust auf einen zur Prüfung der
                Beschaffenheit, Eigenschaften und Funktionsweise der Waren nicht
                notwendigen Umgang mit ihnen zurückzuführen ist.
              </p>
            </div>
          </section>
        </Reveal>

        {/* Trennlinie */}
        <Reveal delay={0.2}>
          <hr className="border-rule mb-14" />
        </Reveal>

        {/* ----------------------------------------------------------------
            Muster-Widerrufsformular
        ---------------------------------------------------------------- */}
        <Reveal delay={0.22}>
          <section className="mb-14">
            <h2 className="font-display text-2xl md:text-3xl font-semibold text-ink mb-4">
              Muster-Widerrufsformular
            </h2>
            <p className="text-ink-aged leading-relaxed mb-6">
              Wenn Sie den Vertrag widerrufen möchten, können Sie dieses
              Formular ausfüllen und an uns zurücksenden. Eine formlose
              schriftliche Erklärung ist ebenfalls ausreichend.
            </p>

            <div className="rounded-card border border-rule bg-card shadow-card px-6 py-6 space-y-4 text-sm text-ink-aged leading-relaxed">
              <p className="font-semibold text-ink text-base">
                An: warehouse14, Musterstraße 14, 73614 Schorndorf
                &middot; widerruf@warehouse14.de (Platzhalter)
              </p>

              <p>
                Hiermit widerrufe ich den von mir abgeschlossenen Vertrag über
                den Kauf der folgenden Waren:
              </p>

              <div className="space-y-4">
                <p className="flex flex-wrap items-end gap-x-2 gap-y-2">
                  Bestellt am
                  <span aria-hidden="true" className="inline-block h-4 w-36 border-b border-ink-faded/40" />
                  &middot; erhalten am
                  <span aria-hidden="true" className="inline-block h-4 w-36 border-b border-ink-faded/40" />
                </p>
                <p className="flex flex-wrap items-end gap-x-2">
                  Name des Verbrauchers:
                  <span aria-hidden="true" className="inline-block h-4 min-w-[12rem] flex-1 border-b border-ink-faded/40" />
                </p>
                <p className="flex flex-wrap items-end gap-x-2">
                  Anschrift des Verbrauchers:
                  <span aria-hidden="true" className="inline-block h-4 min-w-[12rem] flex-1 border-b border-ink-faded/40" />
                </p>
                <p className="flex flex-wrap items-end gap-x-2">
                  Zahlungsmittel:
                  <span aria-hidden="true" className="inline-block h-4 min-w-[12rem] flex-1 border-b border-ink-faded/40" />
                </p>
              </div>

              <p className="flex flex-wrap items-end gap-x-8 gap-y-2 pt-2">
                <span aria-hidden="true" className="inline-block h-4 w-44 border-b border-ink-faded/40" />
                <span aria-hidden="true" className="inline-block h-4 w-56 border-b border-ink-faded/40" />
              </p>
              <p className="text-ink-faded text-xs">
                Ort, Datum &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                Unterschrift (nur bei Mitteilung auf Papier)
              </p>
            </div>
          </section>
        </Reveal>

        {/* Abschlussvermerk */}
        <Reveal delay={0.25}>
          <p className="text-xs text-ink-faded leading-relaxed border-t border-rule pt-6">
            Stand: Platzhalter &middot; Letzte Aktualisierung vor Livegang durch
            Rechtsanwalt. Diese Belehrung ersetzt keine anwaltliche Beratung im
            Einzelfall.
          </p>
        </Reveal>
      </article>
    </PageShell>
  );
}
